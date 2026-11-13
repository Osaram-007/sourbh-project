// T3-02: the web unit must bind Next.js to loopback only (reverse proxy fronts it). Source guard, no build.
// Run from the repo root: npx tsx --test tests/deploy/systemd.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const unit = readFileSync(resolve(process.cwd(), "deploy/systemd/full-charge-web.service"), "utf8");
const lines = unit.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith(";"));
const execStarts = lines.filter((l) => /^ExecStart\s*=/.test(l));

describe("full-charge-web.service bind (T3-02)", () => {
  it("has exactly one ExecStart (no empty reset line)", () => {
    assert.equal(execStarts.length, 1);
    assert.notEqual(execStarts[0].replace(/^ExecStart\s*=\s*/, ""), "");
  });

  it("package.json start script is exactly next start, so the flags reach it", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
    assert.equal(pkg.scripts.start, "next start");
  });

  it("runs npm run start -- -H 127.0.0.1 -p 3000", () => {
    const cmd = execStarts[0].replace(/^ExecStart\s*=\s*/, "");
    assert.match(cmd, /^\S*npm run start\s+--\s/);
    const a = cmd.split(/\s+/);
    assert.ok(a.includes("--"));
    assert.deepEqual(a.slice(a.indexOf("--") + 1), ["-H", "127.0.0.1", "-p", "3000"]);
  });

  // Only matters if someone switches to the standalone server.js, which reads HOSTNAME.
  // `next start` ignores HOSTNAME, and -p beats PORT.
  it("has no HOSTNAME= or PORT= environment override", () => {
    assert.deepEqual(lines.filter((l) => /^Environment\s*=.*\b(HOSTNAME|PORT)\s*=/.test(l)), []);
  });
});
