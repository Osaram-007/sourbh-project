import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { Browser } from "playwright";
import { launchBrowser } from "./helpers/browser";
import { startServer, type TestServer } from "./helpers/server";
import { attributeAndJsonLdText, discoverRoutes, visibleText } from "./marketing-support";
import { BANNED_COPY, fetchDoc } from "./routes-support";

// WEB-B05: uniform sweeps over every marketing and legal route (found on disk, so new pages are covered) plus the 404.
// Criteria: WL-LAND-1 / WL-SEO-4 (one h1, static), WL-LAND-5 / WL-SEO-5 (banned words, h1 quantifier), WL-SEO-2 (noindex while closed),
// WL-LAND-12 / WL-A11Y-9 (reflow).
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
      const h1Text = visibleText(/<h1\b[\s\S]*?<\/h1>/.exec(docs[p].html)![0]);
      assert.ok(h1Text.length > 0, "empty h1");
      // WL-LAND-5: no universal quantifier in the H1 unless the founder signs it off (Q-W13).
      assert.doesNotMatch(h1Text, /\b(all|every\w*)\b/i, "quantifier in h1 needs Q-W13 sign-off");
    });
  }
});

describe("WL-SEO-2: every marketing and legal page and the 404 is noindex while the site is closed", () => {
  for (const p of ALL) {
    test(p === NOT_FOUND ? "404" : p, T, () => {
      assert.ok(docs[p].meta.robots.some((r) => /noindex/.test(r)), `${p} robots meta: ${JSON.stringify(docs[p].meta.robots)}`);
    });
  }
});

describe("WL-LAND-5 / WL-SEO-5: no banned wording anywhere a visitor or crawler reads", () => {
  const sets = (p: string) => {
    const { html, meta } = docs[p];
    const textMetas = meta.metas.filter((m) => /^(og|twitter):/.test(m.key) && !/(:url|:image(:(type|width|height))?|:card|:type|:locale)$/.test(m.key));
    return {
      "visible text": [visibleText(html), visibleText(html, true)], // second: inline tags and comments joined, so "<b>100</b>%" reads 100%
      "attributes and JSON-LD": attributeAndJsonLdText(html),
      title: [meta.title ?? ""],
      description: meta.description,
      "og/twitter text": textMetas.map((m) => m.content),
    };
  };
  for (const p of ALL) {
    test(p === NOT_FOUND ? "404" : p, T, () => {
      const s = sets(p);
      // The header and footer alone exceed any length guard, so require the page's own <h1> text inside <main>.
      const main = visibleText(/<main\b[\s\S]*?<\/main>/.exec(docs[p].html)?.[0] ?? "");
      const h1 = visibleText(/<h1\b[\s\S]*?<\/h1>/.exec(docs[p].html)![0]);
      assert.ok(h1.length > 0 && main.includes(h1), `${p}: the h1 text is not in <main>, so the scan may be reading the wrong thing`);
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

  test("control: the attribute scan sees the hero placeholder on /", T, () => {
    const ph = /<input[^>]*placeholder="([^"]+)"/.exec(docs["/"].html)?.[1];
    assert.ok(ph, "no input placeholder on /");
    assert.ok(sets("/")["attributes and JSON-LD"].includes(ph), `placeholder "${ph}" is not among the scanned strings`);
    assert.ok(sets("/")["attributes and JSON-LD"].some((t) => t.includes("schema.org")), "JSON-LD is not scanned");
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
      assert.equal(entry.compute, "static", `${r} is computed per request`);
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

describe("WL-LAND-12 / WL-A11Y-9: no horizontal overflow", () => {
  /** Visit `paths` at `width`; `tweak` runs in the page after load (used by the positive control). Returns the offenders. */
  async function overflowing(width: number, paths: string[], tweak?: () => void) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const origin = new URL(server.baseUrl).origin;
    await page.route((u) => u.protocol.startsWith("http") && u.origin !== origin, (r) => r.abort());
    const bad: string[] = [];
    try {
      for (const p of paths) {
        await page.goto(server.baseUrl + p, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready.then(() => undefined)); // font swap can change widths
        if (tweak) await page.evaluate(tweak);
        const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, iw: window.innerWidth }));
        assert.equal(m.iw, width, "viewport not applied");
        if (m.doc > m.iw || m.body > m.iw) bad.push(`${p}: documentElement ${m.doc}, body ${m.body}, viewport ${m.iw}`);
      }
    } finally {
      await context.close();
    }
    return bad;
  }

  test("control: the check catches a 2000px-wide element", T, async () => {
    const bad = await overflowing(360, ["/about"], () => {
      const d = document.createElement("div");
      d.style.cssText = "width:2000px;height:10px";
      document.body.appendChild(d);
    });
    assert.equal(bad.length, 1, "an injected 2000px element was not detected, so a pass below proves nothing");
  });

  for (const width of [320, 360, 768, 1280]) {
    test(`${width}px wide, every route and the 404`, T, async () => {
      assert.deepEqual(await overflowing(width, ALL), []);
    });
  }
});
