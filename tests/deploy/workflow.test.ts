// T3-04: the deploy workflow must keep main-only push, docs/mobile path ignores, Postgres-backed tests before build, and a gated self-hosted deploy. Source guard, no GitHub needed.
// Run from the repo root: npx tsx --test tests/deploy/workflow.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
// js-yaml is only a transitive dependency (via eslint); fine for a test, no new dependency added.
// @ts-expect-error no bundled types and @types/js-yaml is not installed
import yaml from "js-yaml";

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Job = {
  needs?: string | string[];
  if?: string;
  "runs-on"?: string | string[];
  "timeout-minutes"?: number;
  concurrency?: string | { group?: string; "cancel-in-progress"?: unknown };
  services?: Record<string, { image?: string; env?: Record<string, string> }>;
  steps: Step[];
};
type Wf = {
  on: { push: { branches?: string[]; paths?: string[] }; workflow_dispatch?: unknown };
  permissions?: { contents?: string };
  concurrency?: Job["concurrency"];
  jobs: { build: Job; deploy: Job };
};

const raw = readFileSync(resolve(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
const wf = yaml.load(raw) as Wf;
const { build, deploy } = wf.jobs;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const idx = (re: RegExp) => build.steps.findIndex((s) => re.test(s.run ?? ""));

describe("deploy workflow (T3-04)", () => {
  it("pushes on main only, excluding mobile/** and docs/** except the two docs tests read, with manual dispatch", () => {
    assert.deepEqual(wf.on.push.branches, ["main"]);
    // Order matters: a later positive pattern re-includes a file excluded earlier.
    assert.deepEqual(wf.on.push.paths, ["**", "!mobile/**", "!docs/**", "docs/api-v1.md", "docs/asset-register.md"]);
    assert.ok("workflow_dispatch" in wf.on);
  });

  it("gates the deploy job on main, after build, on a self-hosted runner", () => {
    assert.ok(list(deploy.needs).includes("build"));
    assert.equal(deploy.if, "github.ref == 'refs/heads/main'");
    assert.ok(list(deploy["runs-on"]).includes("self-hosted"));
  });

  it("never cancels an in-progress deploy, wherever concurrency lives", () => {
    const c = deploy.concurrency ?? wf.concurrency;
    assert.ok(c, "deploy must be covered by a concurrency group");
    const cancel = typeof c === "string" ? undefined : c["cancel-in-progress"];
    assert.ok(cancel === undefined || cancel === false, `cancel-in-progress=${String(cancel)}`);
  });

  it("gives main its own concurrency group, separate from every other ref", () => {
    const c = wf.concurrency;
    assert.ok(c && typeof c !== "string");
    assert.equal(
      c.group,
      "${{ github.ref == 'refs/heads/main' && 'production-deploy' || format('ci-{0}', github.ref) }}",
    );
    assert.equal(c["cancel-in-progress"], false);
    assert.equal(deploy.concurrency, undefined, "job-level concurrency would let older commits deploy late");
  });

  it("has job timeouts of 60 minutes or less and read-only token permissions", () => {
    for (const j of [build, deploy]) {
      const t = j["timeout-minutes"];
      assert.ok(typeof t === "number" && t > 0 && t <= 60, `timeout-minutes=${String(t)}`);
    }
    assert.equal(wf.permissions?.contents, "read");
  });

  it("runs a Postgres 13+ service whose DB name carries a test token", () => {
    const pg = build.services?.postgres;
    const m = /^postgres:(\d+)/.exec(pg?.image ?? "");
    assert.ok(m, `image ${pg?.image}`);
    assert.ok(Number(m[1]) >= 13, "DROP DATABASE ... WITH (FORCE) needs PG 13+");
    assert.match(pg?.env?.POSTGRES_DB ?? "", /(^|[_-])test([_-]|$)/i);
  });

  it("migrates, tests, then builds, with TEST_DATABASE_URL pointing at POSTGRES_DB", () => {
    const migrate = idx(/prisma migrate deploy/);
    const test = idx(/\bnpm test\b/);
    const buildIdx = idx(/\bnpm run build\b/);
    assert.ok(migrate >= 0, "migrate step missing");
    assert.ok(test >= 0, "npm test step missing");
    assert.ok(buildIdx >= 0, "npm run build step missing");
    assert.ok(migrate < test, "migrate must precede npm test");
    assert.ok(test < buildIdx, "npm test must precede npm run build");
    assert.ok(idx(/tsc --noEmit/) >= 0, "tsc --noEmit missing");
    const url = build.steps[test].env?.TEST_DATABASE_URL ?? "";
    const db = build.services?.postgres?.env?.POSTGRES_DB;
    assert.ok(db, "POSTGRES_DB missing");
    assert.equal(new URL(url).pathname, `/${db}`);
  });

  it("uses no secrets and no non-loopback IPv4 literals in the build job", () => {
    const text = JSON.stringify(build);
    assert.doesNotMatch(text, /secrets\./);
    for (const ip of text.match(/\b\d{1,3}(\.\d{1,3}){3}\b/g) ?? []) assert.equal(ip, "127.0.0.1");
  });
});
