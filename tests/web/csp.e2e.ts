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
    test(`${p}: nonce policy, not the static one`, T, async () => {
      const res = await get(server.baseUrl, p);
      assert.equal(res.headers.get(ENFORCING), null);
      const raw = res.headers.get(REPORT_ONLY);
      assert.ok(raw, `${p}: no CSP at all (status ${res.status})`);
      assert.equal(raw.split("default-src").length, 2, `${p}: exactly one policy expected, got: ${raw}`);
      const script = parseCsp(raw).get("script-src")!;
      assert.ok(script.includes("'strict-dynamic'") && nonceOf(raw), `${p}: not the nonce policy: ${raw}`);
      assert.ok(!script.includes("'unsafe-inline'"), `${p} got the static script-src: ${raw}`);
    });
  }

  // S1: the static policy is the floor everywhere except /api/ and /_next/. The proxy matcher is case-sensitive, so
  // case variants fall through to the floor; encoded / extension variants reach the proxy.
  for (const p of ["/APP", "/Login", "/ADMIN/analytics", "/Account"]) {
    test(`${p} (404, proxy does not match): static floor`, T, async () => {
      const raw = (await get(server.baseUrl, p)).headers.get(REPORT_ONLY);
      assert.ok(raw, `${p}: no CSP`);
      assert.ok(parseCsp(raw).get("script-src")!.includes("'unsafe-inline'") && !nonceOf(raw), raw);
    });
  }
  for (const p of ["/%61pp", "/app.rsc"]) {
    test(`${p}: reaches the proxy, nonce policy`, T, async () => {
      const raw = (await get(server.baseUrl, p)).headers.get(REPORT_ONLY);
      assert.ok(raw && nonceOf(raw), `${p}: ${raw}`);
    });
  }
  test("no path outside /api/ and /_next/ is ever without a CSP", T, async () => {
    // Trailing-slash 308s (/legal/, /app/) are skipped on purpose: a redirect has no document, so Next sends it without route headers.
    const extra = ["/APP", "/Login", "/a/b/c", "/legal", "/manifest.webmanifest", "/opengraph-image", "/apple-icon", "/favicon.ico", "/%61pp", "/app.rsc", "/.well-known/x"];
    for (const p of [...HEADER_PATHS, ...PROXY_PATHS, ...extra]) {
      const res = await get(server.baseUrl, p);
      assert.ok(res.headers.get(REPORT_ONLY), `${p} (${res.status}) has no CSP`);
    }
  });
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
      // Maps needs it (Google's CSP guide); nothing else may have it.
      assert.equal(script.includes("'unsafe-eval'"), p === "/app", `${p}: unsafe-eval presence: ${raw}`);
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

  test("router prefetch (next-router-prefetch) skips the proxy: gets the static floor, no nonce", T, async () => {
    for (const p of ["/app", "/login"]) {
      const res = await get(server.baseUrl, p, { "next-router-prefetch": "1" });
      const raw = res.headers.get(REPORT_ONLY);
      assert.ok(raw, `${p}: prefetch must still get the floor`);
      assert.ok(!nonceOf(raw) && parseCsp(raw).get("script-src")!.includes("'unsafe-inline'"), `${p}: ${raw}`);
      assert.equal(res.headers.get(ENFORCING), null);
      assert.equal(res.headers.get("x-frame-options"), "DENY");
    }
  });

  test("purpose: prefetch is no longer special: the proxy still runs", T, async () => {
    for (const p of ["/app", "/login"]) {
      const raw = (await get(server.baseUrl, p, { purpose: "prefetch" })).headers.get(REPORT_ONLY);
      assert.ok(raw && nonceOf(raw), `${p}: ${raw}`);
    }
  });

  test("N3: a client-sent CSP request header cannot replace the proxy's policy", T, async () => {
    const res = await get(server.baseUrl, "/app", { "content-security-policy-report-only": "default-src *", "content-security-policy": "default-src *" });
    const raw = res.headers.get(REPORT_ONLY);
    assert.ok(raw && nonceOf(raw) && !raw.includes("default-src *"), raw ?? "none");
    assert.equal(res.headers.get(ENFORCING), null);
  });

  test("/app follows Google's Maps CSP guide, narrowly", T, async () => {
    const csp = parseCsp((await get(server.baseUrl, "/app")).headers.get(REPORT_ONLY));
    const has = (d: string, ...v: string[]) => v.forEach((x) => assert.ok(csp.get(d)?.includes(x), `${d} lacks ${x}: ${csp.get(d)}`));
    has("script-src", "'unsafe-eval'", "blob:", "https://maps.googleapis.com");
    has("connect-src", "https://maps.googleapis.com", "https://*.google.com", "https://*.gstatic.com", "data:", "blob:");
    assert.ok(!csp.get("connect-src")!.includes("https://*.googleapis.com"), "connect-src must not wildcard googleapis");
    has("img-src", "https://*.google.com");
    has("frame-src", "https://*.google.com");
    has("style-src", "https://fonts.googleapis.com");
    has("font-src", "https://fonts.gstatic.com");
  });
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
      // S4: the click goes to /app on success and on error, so it cannot catch a Permissions-Policy block. This can.
      const lat = await page.evaluate(
        () => new Promise((res, rej) => navigator.geolocation.getCurrentPosition((p) => res(p.coords.latitude), (e) => rej(e.code))),
      );
      assert.equal(lat, 18.52, "geolocation must be allowed by Permissions-Policy geolocation=(self)");
      await Promise.all([page.waitForURL("**/app", { waitUntil: "commit" }), page.locator("#fc-locate").click()]);
      assert.equal(new URL(page.url()).pathname, "/app");
    } finally {
      await close();
    }
  });
});

describe("positive control: violation capture works", () => {
  test("/: an injected foreign script is reported as script-src-elem, disposition report", T, async () => {
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
      assert.equal(v[0].disposition, "report");
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
      assert.ok(captured.cspViolations.length > 0, "the known gap is no longer observable; if /app is now clean, drop the todo on the gate guard in csp-enforce.e2e.ts");
      assert.ok(captured.cspViolations.every((v) => v.disposition === "report"), "report-only must never enforce");
    } finally {
      await close();
    }
  });
});
