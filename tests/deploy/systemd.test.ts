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
  it("has exactly one ExecStart", () => {
    assert.equal(execStarts.length, 1);
  });

  it("runs npm run start on 127.0.0.1:3000 (long or short flags)", () => {
    const cmd = execStarts[0].replace(/^ExecStart\s*=\s*/, "");
    assert.match(cmd, /^\S*npm run start\s+--\s/);
    const args = cmd.split(/\s+/);
    const val = (names: string[]) =>
      args.flatMap((a, i) => (names.includes(a) ? [args[i + 1]] : names.some((n) => n.startsWith("--") && a.startsWith(n + "=")) ? [a.split("=")[1]] : []));
    assert.deepEqual(val(["-H", "--hostname"]), ["127.0.0.1"]);
    assert.deepEqual(val(["-p", "--port"]), ["3000"]);
    assert.doesNotMatch(cmd, /0\.0\.0\.0|::/);
  });

  it("has no HOSTNAME= or PORT= environment override", () => {
    assert.deepEqual(lines.filter((l) => /^Environment(File)?\s*=.*\b(HOSTNAME|PORT)\s*=/.test(l)), []);
  });
});
