import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startServer, type TestServer } from "./helpers/server";
import { fetchDoc } from "./routes-support";

// WEB-A02, second build: SITE_NOINDEX=0 is the go-live setting (WL-SEO-8). SITE_NOINDEX is read at build time, so the
// indexable case needs its own `next build`, hence its own file (one build per test process; the runner is serial).
// routes.e2e.ts covers the unset (fail-closed) build. Not covered: other values such as "1", "false" or "" (each needs a build).
// Run: npx tsx --test --test-concurrency=1 "tests/web/**/*.e2e.ts"

// Contract with tests/web/helpers/server.ts: the value reaches `next build` only because the testEnv() allowlist passes
// SITE_NOINDEX through from process.env (harness.e2e.ts covers that). If it stopped, the first test below would fail.
process.env.SITE_NOINDEX = "0";

const T = { timeout: 60_000 };
let server: TestServer;

before(async () => {
  server = await startServer();
}, { timeout: 12 * 60_000 });

after(async () => {
  await server?.stop();
});

describe("SITE_NOINDEX=0 (go-live)", () => {
  test("/ has no robots meta and no noindex header, with its metadata intact", T, async () => {
    const { res, status, meta } = await fetchDoc(server.baseUrl, "/");
    assert.equal(status, 200);
    assert.deepEqual(meta.robots, [], "robots meta present although SITE_NOINDEX=0 was set: either the flag is broken, or testEnv() no longer passes SITE_NOINDEX to next build");
    assert.ok(!meta.metas.some((m) => m.key === "googlebot"), "googlebot meta present");
    assert.doesNotMatch(res.headers.get("x-robots-tag") ?? "", /noindex/i);
    assert.equal(meta.lang, "en-IN");
    assert.equal(meta.title, "FullCharge: Find EV chargers in India");
  });

  // The group layouts own these (WL-SEO-2). With the site flag closed they would be noindex anyway, so only this build can tell.
  for (const p of ["/app", "/admin/sessions"]) {
    test(`${p} stays noindex, nofollow even though the site is indexable`, T, async () => {
      const { status, meta } = await fetchDoc(server.baseUrl, p);
      assert.equal(status, 200);
      assert.deepEqual(meta.robots, ["noindex, nofollow"]);
    });
  }
});

// WEB-B04. Indexing is on but the harness gives no APP_ORIGIN, so this build is "open, no origin": still no sitemap URLs.
describe("SITE_NOINDEX=0 without APP_ORIGIN (WL-SEO-2)", () => {
  test("robots.txt allows / and disallows the private areas, with no Sitemap line", T, async () => {
    const body = await (await fetch(`${server.baseUrl}/robots.txt`)).text();
    assert.match(body, /^Allow: \/\s*$/m);
    for (const p of ["/app", "/admin", "/api", "/login", "/account"]) assert.match(body, new RegExp(`^Disallow: ${p}\\s*$`, "m"));
    assert.doesNotMatch(body, /^Sitemap:/im);
  });

  test("sitemap.xml is an empty urlset (never relative URLs)", T, async () => {
    const body = await (await fetch(`${server.baseUrl}/sitemap.xml`)).text();
    assert.match(body, /<urlset[\s>]/);
    assert.ok(!body.includes("<loc>"), body);
  });

  test("/ emits no canonical without an origin", T, async () => {
    const { html } = await fetchDoc(server.baseUrl, "/");
    assert.doesNotMatch(html, /rel="canonical"/);
  });

  // WL-SEO-6: the 404's own metadata must say noindex even when the site is open (the site-wide flag no longer does).
  test("the 404 is still noindex while the site is indexable", T, async () => {
    const { status, meta } = await fetchDoc(server.baseUrl, "/no-such-page-b04");
    assert.equal(status, 404);
    assert.ok(meta.robots.some((r) => /noindex/.test(r)), `robots: ${meta.robots}`);
  });
});
