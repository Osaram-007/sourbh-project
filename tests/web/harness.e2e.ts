import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import type { Browser } from "playwright";
import { launchBrowser, openPage, VIEWPORTS, type ViewportName } from "./helpers/browser";
import { assertNoEnvFiles, startServer, testEnv, type TestServer } from "./helpers/server";

// Proves the harness itself (server lifecycle, viewports, capture), not any app feature.
// Run: npx tsx --test --test-concurrency=1 "tests/web/**/*.e2e.ts"   (first run needs: npx playwright install chromium)

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

describe("server isolation", () => {
  // Sync on purpose: the process.env mutation window never overlaps another test.
  function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
    const set = (v: Record<string, string | undefined>) => {
      for (const [k, x] of Object.entries(v)) {
        if (x === undefined) delete process.env[k];
        else process.env[k] = x;
      }
    };
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    set(vars);
    try {
      return fn();
    } finally {
      set(saved);
    }
  }
  const inTmpDir = (files: string[], fn: (dir: string) => void) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-e2e-guard-"));
    try {
      for (const f of files) fs.writeFileSync(path.join(dir, f), ""); // empty: the guard must never need the contents
      fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  test("inherited secrets never reach the server's environment", T, () => {
    const leaked = {
      E2E_LEAK_PROBE_TOKEN: "leak-token", // arbitrary var
      AWS_SECRET_ACCESS_KEY: "leak-aws", // typical secret never forced by the helper
      NODE_OPTIONS: "--max-old-space-size=512", // not on the allowlist either
      DATABASE_URL: "postgresql://real:leak-db@prod.example/db", // forced: must be replaced by the dummy
      NEXTAUTH_SECRET: "leak-nextauth", // forced
      REDIS_URL: "redis://leak-redis", // formerly forced to "", now simply absent
    };
    withEnv(leaked, () => {
      const env = testEnv("http://127.0.0.1:1");
      assert.doesNotMatch(JSON.stringify(env), /leak/);
      assert.equal(env.NODE_OPTIONS, undefined);
      assert.match(env.DATABASE_URL!, /e2e-no-database/);
      // and what a real child process sees is exactly that
      const child = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.env))"], { env, encoding: "utf8" });
      assert.doesNotMatch(child.stdout, /leak/);
      assert.ok(!("NODE_OPTIONS" in JSON.parse(child.stdout)));
    });
  });

  test("SITE_NOINDEX is passed through when set and left out entirely when unset", T, () => {
    withEnv({ SITE_NOINDEX: "1" }, () => assert.equal(testEnv("http://127.0.0.1:1").SITE_NOINDEX, "1"));
    withEnv({ SITE_NOINDEX: undefined }, () => assert.ok(!("SITE_NOINDEX" in testEnv("http://127.0.0.1:1")), "key must be absent, not empty"));
  });

  test("assertNoEnvFiles refuses .env and .env.* but allows .env.example", T, () => {
    for (const f of [".env", ".env.local", ".env.production"]) {
      inTmpDir([f], (dir) => assert.throws(() => assertNoEnvFiles(dir), new RegExp(`Refusing to start.*${f.replace(".", "\\.")}`)));
    }
    inTmpDir([".env.example", "README.md"], (dir) => assert.doesNotThrow(() => assertNoEnvFiles(dir)));
    inTmpDir([], (dir) => assert.doesNotThrow(() => assertNoEnvFiles(dir)));
  });

  test("startServer() itself refuses to run next to a .env file", T, () => {
    inTmpDir([".env"], (dir) => {
      // startServer resolves its directory from cwd at import time, so run it in a child whose cwd is the throwaway dir.
      const serverUrl = pathToFileURL(path.join(process.cwd(), "tests", "web", "helpers", "server.ts")).href;
      fs.writeFileSync(
        path.join(dir, "probe.ts"),
        `import(${JSON.stringify(serverUrl)}).then((m) => m.startServer()).then(() => console.log("STARTED"), (e) => console.log("ERR:" + e.message));`,
      );
      const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
      const r = spawnSync(process.execPath, [tsx, "probe.ts"], { cwd: dir, encoding: "utf8" });
      assert.match(r.stdout, /ERR:Refusing to start the e2e server: \.env found/, r.stdout + r.stderr);
    });
  });
});

describe("server lifecycle", () => {
  test("stop() is idempotent and frees the port", { timeout: 90_000 }, async () => {
    const second = await startServer(); // reuses this process's build
    try {
      assert.equal((await fetch(second.baseUrl)).status, 200);
    } finally {
      await second.stop(); // always runs, or a failed assertion leaves a server running and hangs the process
    }
    await second.stop(); // idempotent
    await assert.rejects(fetch(second.baseUrl, { signal: AbortSignal.timeout(3_000) }), "port must refuse connections");
  });
});
