import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startServer, type TestServer } from "./helpers/server";
import { fetchDoc } from "./routes-support";

// WEB-A02, second build: SITE_NOINDEX=0 is the go-live setting (WL-SEO-8). SITE_NOINDEX is read at build time, so the
// indexable case needs its own `next build`, hence its own file (one build per test process; the runner is serial).
// routes.e2e.ts covers the unset (fail-closed) build. Not covered: other values such as "1", "false" or "" (each needs a build).
// Run: npx tsx --test --test-concurrency=1 "tests/web/**/*.e2e.ts"

// Contract with tests/web/helpers/server.ts: the value reaches `next build` only because testEnv() copies it from
// process.env. If testEnv() becomes an allowlist it must pass SITE_NOINDEX through, or the first test below fails.
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
    assert.equal(meta.title, "FullCharge | Find EV charging stations in India");
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
