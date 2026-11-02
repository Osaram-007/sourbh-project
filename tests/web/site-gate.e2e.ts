import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { legal, pendingLegalItems } from "../../src/content/legal";
import { assertNoEnvFiles, testEnv } from "./helpers/server";

// G8 / WL-LEGAL-2 at the build level (WEB-A05): the site footer imports src/content/legal.ts, so `next build` with
// APP_ENV=production must fail for the marketing layout as a whole, not only /legal/*, and the failure must be the
// missing-legal-config error (not a typo or a missing module). Skipped once every legal value is filled, because the
// build then passes by design. site.test.tsx covers the same import chain in a fresh process, without a build.
// This runs a deliberately failing `next build` into the shared .next (the harness runs e2e files one at a time and each
// builds for itself). It needs internet like every build here (next/font/google).
// Run: npx tsx --test --test-concurrency=1 tests/web/site-gate.e2e.ts
const pending = pendingLegalItems(legal);
const runNext = path.join(process.cwd(), "tests", "web", "helpers", "run-next.cjs");
// A finished `next build` writes .next/BUILD_ID last; a blocked one never gets there. `.next` is shared with the other
// e2e files and can hold a BUILD_ID from an earlier successful build, so it is deleted first and the check is about this
// build only. Positive and wording-independent: matching Next's own build-phase log lines went vacuous as soon as it
// renamed a phase, and 16.4 already changed that output (WEB-A05 review 2026-11-02).
const buildId = path.join(process.cwd(), ".next", "BUILD_ID");

test("APP_ENV=production: next build fails with the legal-config error, naming every missing value", { skip: pending.length === 0, timeout: 10 * 60_000 }, async () => {
  assertNoEnvFiles();
  fs.rmSync(buildId, { force: true });
  const env = { ...testEnv("http://127.0.0.1:1"), APP_ENV: "production" };
  const child = spawn(process.execPath, [runNext, "build"], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  let log = "";
  child.stdout!.on("data", (b: Buffer) => (log += b));
  child.stderr!.on("data", (b: Buffer) => (log += b));
  const code = await new Promise<number | null>((resolve) => {
    child.once("error", () => resolve(null));
    child.once("exit", (c) => resolve(c));
  });

  assert.ok(code !== 0 && code !== null, `a production build with null legal values must fail, got exit ${code}`);
  assert.match(log, /Production build blocked/, "the build failed for a reason other than the legal gate:\n" + log.slice(-3000));
  for (const item of pending) assert.ok(log.includes(item), `build output does not name: ${item}`);
  assert.doesNotMatch(log, /Cannot find module|Type error|Failed to fetch `?\w+`? from Google Fonts/i, "unrelated build failure:\n" + log.slice(-3000));
  // Failing on the compile/prerender of marketing code means the whole build is blocked, not a single page.
  assert.ok(!fs.existsSync(buildId), "the build ran to completion: .next/BUILD_ID was written");
});
