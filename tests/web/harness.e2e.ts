import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser } from "playwright";
import { launchBrowser, openPage, VIEWPORTS, type ViewportName } from "./helpers/browser";
import { startServer, type TestServer } from "./helpers/server";

// Proves the harness itself (server lifecycle, viewports, capture), not any app feature.
// Run: npx tsx --test "tests/web/**/*.e2e.ts"   (first run needs: npx playwright install chromium)

const T = { timeout: 30_000 };
let server: TestServer;
let browser: Browser;

before(async () => {
  server = await startServer();
  browser = await launchBrowser();
}, { timeout: 12 * 60_000 }); // covers the build; the helper has its own, shorter, build/start timeouts

after(async () => {
  await browser?.close();
  await server?.stop();
});

describe("viewports", () => {
  for (const name of Object.keys(VIEWPORTS) as ViewportName[]) {
    test(`${name}: / loads at ${VIEWPORTS[name].width}px wide`, T, async () => {
      const { page, close } = await openPage(browser, name);
      try {
        const res = await page.goto(server.baseUrl + "/", { waitUntil: "domcontentloaded" });
        assert.equal(res?.status(), 200);
        assert.equal(await page.evaluate(() => window.innerWidth), VIEWPORTS[name].width);
      } finally {
        await close();
      }
    });
  }
});

describe("capture", () => {
  // Probe pages are fulfilled from the test, so these hold whatever the app serves.
  async function probe(headers: Record<string, string>, body: string) {
    const o = await openPage(browser, "desktop");
    await o.page.route("**/__e2e/probe", (r) => r.fulfill({ status: 200, contentType: "text/html", headers, body }));
    await o.page.goto(server.baseUrl + "/__e2e/probe");
    await o.flush();
    return o;
  }
  const INLINE = "<!doctype html><title>p</title><script>window.ran = true</script>";

  test("console.error and uncaught exceptions are captured", T, async () => {
    const { page, captured, flush, close } = await openPage(browser, "mobile");
    try {
      await page.goto(server.baseUrl + "/__e2e/none"); // 404 page: its own "Failed to load resource" is also an error
      captured.consoleErrors.length = 0;
      await page.evaluate(() => {
        console.error("probe-console-error");
        setTimeout(() => { throw new Error("probe-page-error"); }, 0);
      });
      await page.waitForTimeout(100);
      await flush();
      assert.equal(captured.consoleErrors.length, 1);
      assert.match(captured.consoleErrors[0], /probe-console-error/);
      assert.deepEqual(captured.pageErrors, ["probe-page-error"]);
    } finally {
      await close();
    }
  });

  test("CSP violation (enforced) is captured", T, async () => {
    const { page, captured, close } = await probe({ "content-security-policy": "default-src 'none'" }, INLINE);
    try {
      assert.equal(await page.evaluate(() => (window as { ran?: boolean }).ran), undefined, "inline script must be blocked");
      assert.equal(captured.cspViolations.length, 1);
      assert.equal(captured.cspViolations[0].directive, "script-src-elem");
      assert.equal(captured.cspViolations[0].disposition, "enforce");
      assert.equal(captured.cspViolations[0].blockedUri, "inline");
    } finally {
      await close();
    }
  });

  test("CSP violation (report-only) is captured and does not block", T, async () => {
    const { page, captured, close } = await probe({ "content-security-policy-report-only": "script-src 'none'" }, INLINE);
    try {
      assert.equal(await page.evaluate(() => (window as { ran?: boolean }).ran), true, "report-only must not block");
      assert.equal(captured.cspViolations.length, 1);
      assert.equal(captured.cspViolations[0].disposition, "report");
    } finally {
      await close();
    }
  });

  test("no CSP header means no violations (no false positives)", T, async () => {
    const { captured, close } = await probe({}, INLINE);
    try {
      assert.deepEqual(captured.cspViolations, []);
    } finally {
      await close();
    }
  });
});

describe("server lifecycle", () => {
  test("stop() is idempotent and frees the port", { timeout: 90_000 }, async () => {
    const second = await startServer(); // reuses this process's build
    assert.equal((await fetch(second.baseUrl)).status, 200);
    await second.stop();
    await second.stop();
    await assert.rejects(fetch(second.baseUrl, { signal: AbortSignal.timeout(3_000) }), "port must refuse connections");
  });
});
