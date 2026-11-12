import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { Browser } from "playwright";
import { launchBrowser } from "./helpers/browser";
import { startServer, type TestServer } from "./helpers/server";
import { discoverRoutes, visibleText } from "./marketing-support";
import { BANNED_COPY, fetchDoc } from "./routes-support";

// WEB-B05: uniform sweeps over every marketing and legal route (found on disk, so new pages are covered) plus the 404.
// Criteria: WL-LAND-1 / WL-SEO-4 (one h1), WL-LAND-5 / WL-SEO-5 (banned words), WL-LAND-1 (static), WL-A11Y-9 (reflow).
// One build, default closed env (no SITE_NOINDEX, no APP_ORIGIN). The per-page tests elsewhere stay; this is the floor.
// Run: npx tsx --test --test-concurrency=1 tests/web/marketing.e2e.ts
delete process.env.SITE_NOINDEX;

const T = { timeout: 120_000 };
const ROUTES = discoverRoutes(path.join(process.cwd(), "src/app"));
const NOT_FOUND = "/no-such-page-b05";
const ALL = [...ROUTES, NOT_FOUND];
let server: TestServer;
let browser: Browser;
const docs: Record<string, Awaited<ReturnType<typeof fetchDoc>>> = {};

before(async () => {
  server = await startServer();
  browser = await launchBrowser();
  for (const p of ALL) docs[p] = await fetchDoc(server.baseUrl, p);
}, { timeout: 12 * 60_000 });

after(async () => {
  await browser?.close();
  await server?.stop();
});

test("control: discovery found the known routes and the 404 really is a 404", T, () => {
  for (const r of ["/", "/for-businesses", "/for-operators", "/about", "/legal/privacy", "/legal/terms", "/legal/disclaimer", "/legal/attributions", "/legal/delete-account"]) {
    assert.ok(ROUTES.includes(r), `${r} not discovered`);
  }
  assert.equal(docs[NOT_FOUND].status, 404);
  for (const r of ROUTES) assert.equal(docs[r].status, 200, r);
});

describe("WL-LAND-1 / WL-SEO-4: exactly one <h1> on every page", () => {
  for (const p of ALL) {
    test(p === NOT_FOUND ? "404" : p, T, () => {
      const h1s = [...docs[p].html.matchAll(/<h1[\s>]/g)];
      assert.equal(h1s.length, 1, `${p} has ${h1s.length} <h1>`);
      assert.ok(visibleText(/<h1\b[\s\S]*?<\/h1>/.exec(docs[p].html)![0]).length > 0, "empty h1");
    });
  }
});

describe("WL-LAND-5 / WL-SEO-5: no banned wording anywhere a visitor or crawler reads", () => {
  const sets = (p: string) => {
    const { html, meta } = docs[p];
    const textMetas = meta.metas.filter((m) => /^(og|twitter):/.test(m.key) && !/(:url|:image(:(type|width|height))?|:card|:type|:locale)$/.test(m.key));
    return {
      "visible text": [visibleText(html)],
      title: [meta.title ?? ""],
      description: meta.description,
      "og/twitter text": textMetas.map((m) => m.content),
    };
  };
  for (const p of ALL) {
    test(p === NOT_FOUND ? "404" : p, T, () => {
      const s = sets(p);
      assert.ok(s["visible text"][0].length > 100, `${p}: almost no visible text, so the scan would pass vacuously`);
      // Banned words in legal text are reported, not allow-listed: a failure here goes to the legal/copy owner.
      for (const [where, texts] of Object.entries(s)) {
        for (const t of texts) for (const b of BANNED_COPY) {
          const m = b.exec(t);
          assert.ok(!m, `${p} ${where}: "${m?.[0]}" matches ${b} in: ...${t.slice(Math.max(0, (m?.index ?? 0) - 40), (m?.index ?? 0) + 60)}...`);
        }
      }
    });
  }

  test("control: the scan sees metadata on / (title, description, og and twitter text)", T, () => {
    const s = sets("/");
    assert.ok(s.title[0] && s.description.length === 1 && s["og/twitter text"].length >= 3);
  });

  test("/manifest.webmanifest string values", T, async () => {
    const m = JSON.parse(await (await fetch(`${server.baseUrl}/manifest.webmanifest`)).text()) as Record<string, unknown>;
    const strings = Object.entries(m).filter(([k, v]) => typeof v === "string" && !/color|display|start_url/.test(k)).map(([, v]) => v as string);
    assert.ok(strings.length >= 2, "manifest has no text");
    for (const t of strings) for (const b of BANNED_COPY) assert.doesNotMatch(t, b);
  });
});

describe("WL-LAND-1: every marketing and legal route is prerendered (build output)", () => {
  const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), rel), "utf8"));
  const html = (route: string) => path.join(process.cwd(), ".next/server/app", route === "/" ? "index.html" : `${route.slice(1)}.html`);

  for (const r of ROUTES) {
    test(r, T, () => {
      const manifest = read(".next/prerender-manifest.json");
      const entry = manifest.routes[r];
      assert.ok(entry, `${r} is not in prerender-manifest routes`);
      assert.equal(entry.initialRevalidateSeconds, false, `${r} revalidates, so it is not purely static`);
      assert.ok(!(r in manifest.dynamicRoutes));
      assert.ok(fs.existsSync(html(r)), `${html(r)} missing`);
    });
  }

  test("the 404 is prerendered too", T, () => {
    assert.ok(fs.existsSync(path.join(process.cwd(), ".next/server/app/_not-found.html")), "no _not-found.html");
  });

  // Metadata routes: static when generated at build time (no request data), served as files from the build.
  for (const [route, type] of [["/robots.txt", /text\/plain/], ["/sitemap.xml", /xml/], ["/manifest.webmanifest", /json/], ["/icon", /image\/png/], ["/apple-icon", /image\/png/], ["/opengraph-image", /image\/png/]] as const) {
    test(`${route} is static`, T, async () => {
      const manifest = read(".next/prerender-manifest.json");
      const key = Object.keys(manifest.routes).find((k) => k === route || k === route + "/route" || k.startsWith(route + "?"));
      assert.ok(key, `${route} is not in prerender-manifest routes (it would be rendered per request); have: ${Object.keys(manifest.routes).join(", ")}`);
      assert.equal(manifest.routes[key].initialRevalidateSeconds, false);
      assert.equal(manifest.routes[key].compute, "static", "built at build time, not computed per request");
      const res = await fetch(server.baseUrl + route);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", type);
    });
  }
});

describe("WL-A11Y-9: no horizontal overflow", () => {
  for (const width of [320, 360, 768, 1280]) {
    test(`${width}px wide, every route and the 404`, T, async () => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const origin = new URL(server.baseUrl).origin;
      await page.route((u) => u.protocol.startsWith("http") && u.origin !== origin, (r) => r.abort());
      const bad: string[] = [];
      try {
        for (const p of ALL) {
          await page.goto(server.baseUrl + p, { waitUntil: "load" });
          const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
          assert.equal(m.iw, width, "viewport not applied");
          if (m.sw > m.iw) bad.push(`${p}: scrollWidth ${m.sw} > ${m.iw}`);
        }
      } finally {
        await context.close();
      }
      assert.deepEqual(bad, []);
    });
  }
});
