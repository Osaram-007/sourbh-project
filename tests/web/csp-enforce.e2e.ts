import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { Browser } from "playwright";
import { launchBrowser, openPage } from "./helpers/browser";
import { startServer, type TestServer } from "./helpers/server";
import { discoverRoutes } from "./marketing-support";
import { ENFORCING, get, nonceOf, REPORT_ONLY } from "./csp-support";

// WEB-S05 / ADR-0016 in a CSP_ENFORCE=1 build (its own file: the harness builds once per process).
// Run: npx tsx --test --test-concurrency=1 tests/web/csp-enforce.e2e.ts
const T = { timeout: 60_000 };
let server: TestServer;
let browser: Browser;

before(async () => {
  server = await startServer({ CSP_ENFORCE: "1" });
  browser = await launchBrowser();
}, { timeout: 12 * 60_000 });
after(async () => {
  await browser?.close();
  await server?.stop();
});

describe("CSP_ENFORCE=1: both halves enforce", () => {
  for (const p of ["/", "/about", "/legal/privacy", "/robots.txt", "/__csp/unknown", "/app", "/login", "/admin/analytics", "/account"]) {
    test(`${p}: Content-Security-Policy, never Report-Only`, T, async () => {
      const res = await get(server.baseUrl, p);
      assert.ok(res.headers.get(ENFORCING), `${p}: no enforcing CSP`);
      assert.equal(res.headers.get(REPORT_ONLY), null, `${p}: still sends Report-Only`);
    });
  }

  test("marketing, legal and the 404 still show 0 violations (enforced)", T, async () => {
    for (const r of [...discoverRoutes(path.join(process.cwd(), "src", "app")), "/__csp/unknown"]) {
      const { page, captured, flush, close } = await openPage(browser, "desktop");
      try {
        await page.goto(server.baseUrl + r, { waitUntil: "load" });
        await page.waitForLoadState("networkidle");
        await flush();
        assert.deepEqual(captured.cspViolations, [], r);
      } finally {
        await close();
      }
    }
  });
});

describe("positive control: enforcement really blocks", () => {
  test("/: an injected foreign script is reported as script-src-elem, disposition enforce", T, async () => {
    const { page, captured, flush, close } = await openPage(browser, "desktop");
    try {
      await page.goto(server.baseUrl + "/", { waitUntil: "load" });
      await page.evaluate(() => {
        const s = document.createElement("script");
        s.src = "https://example.invalid/x.js";
        document.head.appendChild(s);
      });
      for (let i = 0; i < 20 && !captured.cspViolations.length; i++) {
        await page.waitForTimeout(100);
        await flush();
      }
      const v = captured.cspViolations.filter((x) => x.directive === "script-src-elem");
      assert.ok(v.length >= 1, JSON.stringify(captured.cspViolations));
      assert.equal(v[0].disposition, "enforce");
    } finally {
      await close();
    }
  });
});

describe("the CSP_ENFORCE=1 gate (ADR-0016, DEPLOY.md WEB-S05)", () => {
  // Enforcing is only safe once every nonce surface renders per request. A prerendered page has no nonce on its
  // scripts, so the browser would block them. Owners: T0-01 (remove next-auth, dynamic layouts), WEB-B07, WEB-B19.
  // `todo`: runs and reports, but a failure does not fail the suite. Remove `todo` when /app and /admin/* go dynamic.
  const todo = "GATE: /app and /admin/* are still prerendered. Becomes passing with T0-01 / WEB-B07 / WEB-B19.";
  const manifest = () => JSON.parse(fs.readFileSync(path.join(process.cwd(), ".next", "prerender-manifest.json"), "utf8")) as { routes: Record<string, unknown> };

  test("no route under /app, /admin, /account or /login is prerendered", { todo, timeout: 30_000 }, () => {
    const bad = Object.keys(manifest().routes).filter((r) => /^\/(app|admin|account|login)(\/|$)/.test(r));
    assert.deepEqual(bad, [], `prerendered nonce surfaces: ${bad.join(", ")}`);
  });

  test("served /app HTML: every script carries the request's nonce", { todo, timeout: 30_000 }, async () => {
    const res = await get(server.baseUrl, "/app");
    const nonce = nonceOf(res.headers.get(ENFORCING));
    assert.ok(nonce);
    const scripts = [...(await res.text()).matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(scripts.length > 0);
    const missing = scripts.filter((s) => !s.includes(`nonce="${nonce}"`));
    assert.deepEqual(missing, [], `${missing.length} of ${scripts.length} scripts have no matching nonce`);
  });
});
