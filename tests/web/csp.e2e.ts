import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { Browser } from "playwright";
import { launchBrowser, openPage } from "./helpers/browser";
import { startServer, type TestServer } from "./helpers/server";
import { discoverRoutes } from "./marketing-support";
import { ENFORCING, get, HEADER_PATHS, nonceOf, parseCsp, PROXY_PATHS, REPORT_ONLY, SECURITY_HEADERS, STATIC_PATHS } from "./csp-support";

// WEB-S05 / WL-SEC-4 / ADR-0016, default (report-only) build. The CSP_ENFORCE=1 build is csp-enforce.e2e.ts.
// Run: npx tsx --test --test-concurrency=1 tests/web/csp.e2e.ts
const T = { timeout: 60_000 };
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

describe("security headers on every route class", () => {
  for (const p of HEADER_PATHS) {
    test(`${p}`, T, async () => {
      const res = await get(server.baseUrl, p);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(k), v, `${p}: ${k}`);
    });
  }
});

describe("static CSP (marketing, legal, 404, metadata)", () => {
  for (const p of STATIC_PATHS) {
    test(`${p}: static policy, report-only name only`, T, async () => {
      const res = await get(server.baseUrl, p);
      assert.equal(res.headers.get(ENFORCING), null, "must not enforce in a default build");
      const raw = res.headers.get(REPORT_ONLY);
      assert.ok(raw, `${p}: no report-only CSP`);
      const csp = parseCsp(raw);
      assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
      assert.deepEqual(csp.get("object-src"), ["'none'"]);
      assert.deepEqual(csp.get("base-uri"), ["'self'"]);
      assert.deepEqual(csp.get("form-action"), ["'self'"]);
      assert.deepEqual(csp.get("connect-src"), ["'self'"]);
      assert.deepEqual(csp.get("default-src"), ["'self'"]);
      assert.ok(!raw.includes("nonce-"), "static policy has no nonce");
    });
  }

  for (const p of PROXY_PATHS) {
    test(`${p}: does not get the static policy`, T, async () => {
      const res = await get(server.baseUrl, p);
      assert.equal(res.headers.get(ENFORCING), null);
      const raw = res.headers.get(REPORT_ONLY);
      // Either the proxy's nonce policy or nothing; never the static 'unsafe-inline' script policy.
      if (raw) assert.ok(!parseCsp(raw).get("script-src")!.includes("'unsafe-inline'"), `${p} got the static script-src: ${raw}`);
    });
  }
});

describe("nonce CSP (proxy)", () => {
  for (const p of ["/app", "/login", "/admin/analytics", "/account"]) {
    test(`${p}: nonce + strict-dynamic, report-only, hardening directives`, T, async () => {
      const res = await get(server.baseUrl, p);
      const raw = res.headers.get(REPORT_ONLY);
      assert.ok(raw, `${p}: no CSP header (status ${res.status})`);
      assert.equal(res.headers.get(ENFORCING), null);
      const csp = parseCsp(raw);
      const script = csp.get("script-src")!;
      assert.ok(script.includes("'strict-dynamic'"), raw);
      assert.ok(script.some((s) => /^'nonce-[A-Za-z0-9+/=]{16,}'$/.test(s)), raw);
      assert.ok(!script.includes("'unsafe-eval'"), "no unsafe-eval in a production build");
      assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
      assert.deepEqual(csp.get("object-src"), ["'none'"]);
      assert.deepEqual(csp.get("base-uri"), ["'self'"]);
    });
  }

  test("the nonce differs between requests", T, async () => {
    const a = nonceOf((await get(server.baseUrl, "/app")).headers.get(REPORT_ONLY));
    const b = nonceOf((await get(server.baseUrl, "/app")).headers.get(REPORT_ONLY));
    assert.ok(a && b);
    assert.notEqual(a, b);
  });

  test("Maps origins on /app only", T, async () => {
    assert.ok((await get(server.baseUrl, "/app")).headers.get(REPORT_ONLY)!.includes("https://maps.googleapis.com"));
    for (const p of ["/login", "/admin/analytics", "/account", "/", "/about"]) {
      const h = (await get(server.baseUrl, p)).headers.get(REPORT_ONLY) ?? "";
      assert.doesNotMatch(h, /maps\.googleapis|maps\.gstatic|\*\.ggpht|googleusercontent|\*\.googleapis|\*\.gstatic/, `${p} leaks a Maps origin: ${h}`);
    }
  });

  test("Firebase origins on /login only", T, async () => {
    const fb = /identitytoolkit|securetoken|apis\.google\.com|firebaseapp|recaptcha/;
    assert.match((await get(server.baseUrl, "/login")).headers.get(REPORT_ONLY)!, fb);
    for (const p of ["/app", "/admin/analytics", "/account", "/", "/about"]) {
      const h = (await get(server.baseUrl, p)).headers.get(REPORT_ONLY) ?? "";
      assert.doesNotMatch(h, fb, `${p} leaks a Firebase origin`);
    }
  });

  test("/admin and /account have no third-party origin at all", T, async () => {
    for (const p of ["/admin/analytics", "/account"]) {
      const h = (await get(server.baseUrl, p)).headers.get(REPORT_ONLY);
      assert.ok(h, `${p}: no CSP`);
      assert.doesNotMatch(h, /https?:\/\//, `${p}: ${h}`);
    }
  });

  test("COOP same-origin-allow-popups on /login only", T, async () => {
    assert.equal((await get(server.baseUrl, "/login")).headers.get("cross-origin-opener-policy"), "same-origin-allow-popups");
    for (const p of ["/", "/app", "/about", "/admin/analytics", "/account"]) {
      assert.equal((await get(server.baseUrl, p)).headers.get("cross-origin-opener-policy"), null, p);
    }
  });

  for (const h of [{ "next-router-prefetch": "1" }, { purpose: "prefetch" }] as Record<string, string>[]) {
    test(`prefetch (${Object.keys(h)[0]}) gets no proxy CSP`, T, async () => {
      for (const p of ["/app", "/login"]) {
        const res = await get(server.baseUrl, p, h);
        assert.equal(res.headers.get(REPORT_ONLY), null, `${p} prefetch got a CSP`);
        assert.equal(res.headers.get(ENFORCING), null);
        assert.equal(res.headers.get("x-frame-options"), "DENY", "base headers still apply");
      }
    });
  }
});

describe("real browser: zero securitypolicyviolation on marketing, legal and the 404", () => {
  const routes = [...discoverRoutes(path.join(process.cwd(), "src", "app")), "/__csp/unknown"];

  test("discoverRoutes finds the marketing pages", () => assert.ok(routes.length > 3, routes.join(",")));

  for (const r of routes) {
    test(`${r}`, T, async () => {
      const { page, captured, flush, close } = await openPage(browser, "desktop");
      try {
        await page.goto(server.baseUrl + r, { waitUntil: "load" });
        await page.waitForLoadState("networkidle");
        await flush();
        assert.deepEqual(captured.cspViolations, []);
      } finally {
        await close();
      }
    });
  }

  test("/: 'Use my location' (geolocation granted) still navigates to /app, no violations on /", T, async () => {
    const { page, captured, flush, close } = await openPage(browser, "desktop");
    try {
      await page.context().grantPermissions(["geolocation"], { origin: server.baseUrl });
      await page.context().setGeolocation({ latitude: 18.52, longitude: 73.85 });
      await page.goto(server.baseUrl + "/", { waitUntil: "load" });
      await page.waitForLoadState("networkidle");
      await flush();
      assert.deepEqual(captured.cspViolations, [], "violations on / before the click");
      await Promise.all([page.waitForURL("**/app", { waitUntil: "commit" }), page.locator("#fc-locate").click()]);
      assert.equal(new URL(page.url()).pathname, "/app");
    } finally {
      await close();
    }
  });
});

describe("/app known gap (recorded, not asserted clean)", () => {
  // Today /app is prerendered, so its scripts carry no nonce and report-only logs violations (16 when written).
  // The enforceability guard lives in csp-enforce.e2e.ts. This only records today's count and that nothing is blocked.
  test("/app violations are report-only (nothing is blocked) and are logged", T, async () => {
    const { page, captured, flush, close } = await openPage(browser, "desktop");
    try {
      await page.goto(server.baseUrl + "/app", { waitUntil: "load" });
      await page.waitForTimeout(1500);
      await flush();
      console.log(`# /app CSP violations today: ${captured.cspViolations.length}`);
      assert.ok(captured.cspViolations.every((v) => v.disposition === "report"), "report-only must never enforce");
    } finally {
      await close();
    }
  });
});
