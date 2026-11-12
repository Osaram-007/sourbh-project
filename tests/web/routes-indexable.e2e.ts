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
const GO_LIVE_ENV = { APP_ORIGIN: "https://example.test" }; // indexing needs a flag AND an origin (src/lib/indexing.ts)

const T = { timeout: 60_000 };
let server: TestServer;

before(async () => {
  server = await startServer(GO_LIVE_ENV);
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


// WEB-B04: the real go-live build (SITE_NOINDEX=0 AND APP_ORIGIN=https://example.test). Indexing needs both, so this is
// the only e2e build where the site is actually open.
const ORIGIN = GO_LIVE_ENV.APP_ORIGIN;


describe("go-live build: robots.txt, sitemap.xml and absolute metadata (WL-SEO-1, WL-SEO-2)", () => {
  test("robots.txt: allow /, allow /apple-icon, the five disallows, and the Sitemap line", T, async () => {
    const body = await (await fetch(`${server.baseUrl}/robots.txt`)).text();
    assert.match(body, /^Allow: \/\s*$/m);
    assert.match(body, /^Allow: \/apple-icon\s*$/m);
    for (const p of ["/app", "/admin", "/api", "/login", "/account"]) assert.match(body, new RegExp(`^Disallow: ${p}\\s*$`, "m"));
    assert.doesNotMatch(body, /^Disallow: \/\s*$/m, "a blanket Disallow: / is still present");
    assert.ok(body.split(/\r?\n/).includes(`Sitemap: ${ORIGIN}/sitemap.xml`), body);
  });

  test("sitemap.xml is non-empty, absolute, and lists no private path", T, async () => {
    const body = await (await fetch(`${server.baseUrl}/sitemap.xml`)).text();
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.length >= 6, `too few urls: ${locs}`);
    assert.ok(locs.includes(ORIGIN), "the home page is missing");
    for (const p of ["/legal/privacy", "/legal/terms", "/legal/disclaimer", "/legal/attributions", "/legal/delete-account"]) assert.ok(locs.includes(ORIGIN + p), `${p} missing`);
    for (const l of locs) {
      assert.ok(l.startsWith(ORIGIN), `${l} is not on the origin`);
      assert.doesNotMatch(new URL(l).pathname, /^\/(app|admin|api|login|account|station)(\/|$)/);
    }
  });

  test("/ has an absolute canonical and absolute og:image / twitter:image on the origin", T, async () => {
    const { html, meta } = await fetchDoc(server.baseUrl, "/");
    const canon = /<link[^>]*rel="canonical"[^>]*href="([^"]+)"/.exec(html)?.[1] ?? /<link[^>]*href="([^"]+)"[^>]*rel="canonical"/.exec(html)?.[1];
    assert.ok(canon, "no canonical link");
    assert.ok(canon === ORIGIN || canon === `${ORIGIN}/`, canon);
    const get = (k: string) => meta.metas.filter((m) => m.key === k).map((m) => m.content);
    assert.ok((get("og:image")[0] ?? "").startsWith(`${ORIGIN}/opengraph-image`), get("og:image")[0]);
    assert.ok((get("twitter:image")[0] ?? "").startsWith(`${ORIGIN}/opengraph-image`), get("twitter:image")[0]);
  });
});

describe("go-live build: the 404 (WL-SEO-6)", () => {
  // N5: Next adds a plain "noindex" to every 404 by itself; ours is the exact "noindex, nofollow" of not-found.tsx's export.
  test("noindex, nofollow comes from our not-found export", T, async () => {
    const { status, meta } = await fetchDoc(server.baseUrl, "/no-such-page-b04");
    assert.equal(status, 404);
    assert.ok(meta.robots.includes("noindex, nofollow"), `robots: ${meta.robots}`);
  });
});
