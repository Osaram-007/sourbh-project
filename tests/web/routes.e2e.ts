import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { Browser } from "playwright";
import { launchBrowser, openPage } from "./helpers/browser";
import { startServer, type TestServer } from "./helpers/server";
import { BANNED_COPY, fetchDoc, loadPage, MARKERS } from "./routes-support";

// WEB-A02: route groups and provider scoping (ADR-0017). Criteria: WL-LAND-1, WL-PERF-2, WL-A11Y-11, WL-SEO-2, WL-SEO-8.
// This file builds with SITE_NOINDEX unset (the fail-closed default). routes-indexable.e2e.ts builds with SITE_NOINDEX=0.
// Run: npx tsx --test --test-concurrency=1 "tests/web/**/*.e2e.ts"   (first run: npx playwright install chromium)

// Contract with tests/web/helpers/server.ts: testEnv() copies SITE_NOINDEX from process.env, so deleting it here means
// `next build` sees it unset. An allowlisting testEnv() must pass SITE_NOINDEX through when set and leave it absent when not.
delete process.env.SITE_NOINDEX;

const T = { timeout: 60_000 };
const BUDGET_BYTES = 150_000; // WL-PERF-2: 150 KB gzipped (decimal KB, the stricter reading)
let server: TestServer;
let browser: Browser;

before(async () => {
  server = await startServer();
  browser = await launchBrowser();
}, { timeout: 12 * 60_000 });

after(async () => {
  await browser?.close();
  await server?.stop();
});

const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), rel), "utf8"));

describe("WL-LAND-1: / is a static page that does not need the database", () => {
  test("build output lists / as prerendered static and in the marketing group", T, () => {
    const manifest = readJson(".next/prerender-manifest.json");
    const route = manifest.routes["/"];
    assert.ok(route, "/ is missing from prerender-manifest routes, so it is not prerendered");
    assert.equal(route.initialRevalidateSeconds, false, "prerendered but revalidating, so not purely static");
    assert.equal(route.srcRoute, "/");
    assert.ok(!("/" in manifest.dynamicRoutes), "/ must not be a dynamic route");
    assert.ok(fs.existsSync(path.join(process.cwd(), ".next/server/app/index.html")), "no prerendered index.html");
    assert.equal(readJson(".next/app-path-routes-manifest.json")["/(marketing)/page"], "/");
  });

  test("/ is served as a prerendered response at runtime", T, async () => {
    const { res, status } = await fetchDoc(server.baseUrl, "/");
    assert.equal(status, 200);
    // Next 16.2.9 sends the header twice ("1, 1"); either way every value must be 1.
    assert.match(res.headers.get("x-nextjs-prerender") ?? "", /^1(, 1)*$/, "Next marks fully prerendered responses with this header");
    assert.match(res.headers.get("cache-control") ?? "", /s-maxage=\d{6,}/, "static pages are cacheable by a CDN for a long time");
  });

  test("/ returns 200 while the database is down (control: a DB-backed API fails)", T, async () => {
    // The harness points DATABASE_URL at a closed port. Prove that, so a 200 on / means something.
    const api = await fetch(`${server.baseUrl}/api/stations?north=20&south=19&east=73&west=72`, {
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(api.status >= 500, `control failed: /api/stations answered ${api.status}, so the DB is not down`);

    const { status, html } = await fetchDoc(server.baseUrl, "/");
    assert.equal(status, 200);
    assert.match(html, /<h1[^>]*>FullCharge<\/h1>/);
  });

  test("/ does not vary with session cookies (anonymous and 'signed-in' get the same page)", T, async () => {
    const anon = await fetchDoc(server.baseUrl, "/");
    const cookie = "next-auth.session-token=not-a-real-token; __Secure-next-auth.session-token=x; __Host-fc_session=x; fc_hint=1";
    const withCookies = await fetchDoc(server.baseUrl, "/", { cookie });
    assert.equal(withCookies.status, 200);
    assert.equal(withCookies.html, anon.html);
  });
});

describe("WL-SEO-5 / WL-A11Y-11: / metadata", () => {
  test("lang is en-IN, with the new title and description", T, async () => {
    const { meta } = await fetchDoc(server.baseUrl, "/");
    assert.equal(meta.lang, "en-IN");
    assert.equal(meta.title, "FullCharge | Find EV charging stations in India");
    assert.deepEqual(meta.description, ["Find EV charging stations in India, with connector types and prices where they are available."]);
  });

  test("no banned claim in the title, description or any other meta tag", T, async () => {
    const { meta } = await fetchDoc(server.baseUrl, "/");
    const copy = [meta.title ?? "", ...meta.metas.map((m) => m.content)];
    assert.ok(copy.join("").length > 40, "no metadata found, so the check would pass vacuously");
    for (const text of copy) {
      for (const banned of BANNED_COPY) assert.doesNotMatch(text, banned, `metadata "${text}" contains ${banned}`);
    }
    // The two phrases named in the task, spelled out so a regex change cannot silently drop them.
    const all = copy.join("\n").toLowerCase();
    assert.ok(!all.includes("real-time") && !all.includes("all major"));
  });

  test("the root layout sets the viewport", T, async () => {
    const { meta } = await fetchDoc(server.baseUrl, "/");
    assert.deepEqual(meta.metas.filter((m) => m.key === "viewport").map((m) => m.content), ["width=device-width, initial-scale=1"]);
  });
});

/** Fail if any forbidden library's code is in `load`, or the page called Google or its own API. */
function assertNoAppCode(load: Awaited<ReturnType<typeof loadPage>>, hint = "") {
  assert.equal(load.status, 200);
  assert.ok(load.scripts.length >= 3, "the load recorded almost no scripts, so the search would pass vacuously");
  for (const [lib, marker] of Object.entries(MARKERS)) {
    const hit = load.scripts.find((s) => s.text.includes(marker));
    assert.ok(!hit, `${lib} code (${JSON.stringify(marker)}) is in ${hit?.url} loaded by /${hint}`);
  }
  for (const u of load.requests) {
    const p = new URL(u);
    assert.ok(!/googleapis\.com|gstatic\.com|google\.com/.test(p.host), `/ contacted ${u}`);
    assert.ok(!p.pathname.startsWith("/api/"), `/ called ${p.pathname}`);
  }
}

describe("WL-PERF-2: first load of /", () => {
  // Link prefetch is blocked here so these tests see only the JS the landing page needs for itself;
  // the prefetch is covered separately below.
  test("control: the markers are found in the /app bundle, one per forbidden library", T, async () => {
    const app = await loadPage(browser, server.baseUrl, "/app");
    assert.equal(app.status, 200);
    assert.ok(app.scripts.length > 3, "the /app load recorded almost no scripts");
    for (const [lib, marker] of Object.entries(MARKERS)) {
      assert.ok(
        app.scripts.some((s) => s.text.includes(marker)),
        `marker for ${lib} (${JSON.stringify(marker)}) not found in any script /app loaded, so the search on / proves nothing`,
      );
    }
    // The page-load side of the same control: the providers really do run on /app.
    assert.ok(app.requests.some((u) => new URL(u).pathname === "/api/auth/session"), "SessionProvider did not call /api/auth/session on /app");
  });

  test("no NextAuth, React Query, Zustand, Google Maps or vaul code in the scripts / loads", T, async () => {
    assertNoAppCode(await loadPage(browser, server.baseUrl, "/", { blockPrefetch: true }));
  });

  test("no chunk that carries app-only code on /app is loaded by /", T, async () => {
    const app = await loadPage(browser, server.baseUrl, "/app");
    const home = await loadPage(browser, server.baseUrl, "/", { blockPrefetch: true });
    const appOnly = new Set(
      app.scripts.filter((s) => Object.values(MARKERS).some((m) => s.text.includes(m))).map((s) => new URL(s.url).pathname),
    );
    assert.ok(appOnly.size >= 3, `expected the provider, map and drawer code in several /app chunks, found ${appOnly.size}`);
    const shared = home.scripts.map((s) => new URL(s.url).pathname).filter((p) => appOnly.has(p));
    assert.deepEqual(shared, []);
  });

  test(`first-load JS is at most ${BUDGET_BYTES} bytes gzipped, noModule polyfill excluded`, T, async () => {
    const app = await loadPage(browser, server.baseUrl, "/app");
    const home = await loadPage(browser, server.baseUrl, "/", { blockPrefetch: true });
    const total = (l: typeof home) => l.scripts.reduce((n, s) => n + s.gzipBytes, 0);

    // The polyfill is <script noModule>; Chromium must not have fetched it, or it would be counted.
    assert.ok(home.noModuleSrcs.length > 0, "expected Next's noModule polyfill in the document; has the build changed?");
    for (const src of home.noModuleSrcs) {
      assert.ok(!home.scripts.some((s) => s.url === src), `noModule script ${src} was counted`);
    }

    const bytes = total(home);
    console.log(`/ first-load JS: ${bytes} bytes gzipped in ${home.scripts.length} files; /app: ${total(app)} bytes in ${app.scripts.length} files`);
    assert.ok(bytes > 60_000, `only ${bytes} bytes measured: React + Next alone are larger, so the measurement is broken`);
    assert.ok(total(app) > bytes, "control: /app (providers, map, drawer) must be heavier than /");
    assert.ok(bytes <= BUDGET_BYTES, `/ first-load JS is ${bytes} bytes gzipped, over the ${BUDGET_BYTES} budget`);
  });
});

describe("ADR-0017 / WL-PERF-2: visiting / as a real visitor", () => {
  // Same scan, but with Next's Link prefetch left on. The landing links to /app, and prefetching a static route makes
  // Next download that route's chunks after load, so the provider code reaches the landing visitor anyway.
  test("link prefetch of /app does not pull NextAuth, React Query, Zustand or vaul code into /", T, async () => {
    const home = await loadPage(browser, server.baseUrl, "/");
    const prefetches = home.requests.filter((u) => new URL(u).searchParams.has("_rsc")).length;
    assertNoAppCode(home, ` (after ${prefetches} Link prefetch requests for other routes; try prefetch={false} on links to /app)`);
  });
});

describe("/app is the map page; the legacy pages stay out of search", () => {
  test("/app renders the map page, which is no longer at /", T, async () => {
    const { page, flush, captured, close } = await openPage(browser, "desktop");
    try {
      await page.route((u) => u.origin !== new URL(server.baseUrl).origin && u.protocol.startsWith("http"), (r) => r.abort());
      const res = await page.goto(server.baseUrl + "/app", { waitUntil: "load" });
      assert.equal(res?.status(), 200);
      assert.equal(await page.evaluate(() => document.documentElement.lang), "en-IN");
      await page.getByTitle("Go to my location").waitFor({ timeout: 20_000 }); // the map page's GPS button
      await page.getByPlaceholder("Search stations, cities, operators...").first().waitFor({ state: "attached" });
      await flush();
      assert.deepEqual(captured.pageErrors, []);

      // The landing placeholder is not the map.
      const home = await page.goto(server.baseUrl + "/", { waitUntil: "load" });
      assert.equal(home?.status(), 200);
      assert.equal(await page.getByTitle("Go to my location").count(), 0, "/ still renders the map page");
    } finally {
      await close();
    }
  });

  test('"Open the map" on / leads to the working map page at /app', T, async () => {
    const { page, close } = await openPage(browser, "mobile");
    try {
      await page.route((u) => u.origin !== new URL(server.baseUrl).origin && u.protocol.startsWith("http"), (r) => r.abort());
      await page.goto(server.baseUrl + "/", { waitUntil: "load" });
      const link = page.getByRole("link", { name: "Open the map" });
      assert.equal(await link.getAttribute("href"), "/app");
      await link.click();
      await page.waitForURL("**/app", { timeout: 20_000 });
      await page.getByTitle("Go to my location").waitFor({ timeout: 20_000 });
    } finally {
      await close();
    }
  });

  test("/app and /admin/sessions carry noindex, nofollow", T, async () => {
    for (const p of ["/app", "/admin/sessions"]) {
      const { status, meta } = await fetchDoc(server.baseUrl, p);
      assert.equal(status, 200, p);
      assert.deepEqual(meta.robots, ["noindex, nofollow"], p);
      assert.equal(meta.lang, "en-IN", p);
    }
  });
});

describe("WL-SEO-8: SITE_NOINDEX fails closed", () => {
  // The build env comes from process.env (see the top of this file), where SITE_NOINDEX was deleted.
  test("with SITE_NOINDEX unset, / is noindex, nofollow", T, async () => {
    assert.equal(process.env.SITE_NOINDEX, undefined);
    const { status, meta } = await fetchDoc(server.baseUrl, "/");
    assert.equal(status, 200);
    assert.deepEqual(meta.robots, ["noindex, nofollow"]);
  });
});
