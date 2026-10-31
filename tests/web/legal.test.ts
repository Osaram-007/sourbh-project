// T3-09 legal config gate (WL-LEGAL-2): a production build must fail while any legal value is null/blank
// or any section is still draft, and must name what is missing. Pure logic, no build.
// Run from the repo root: npx tsx --test tests/web/legal.test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { assertLegalReady, legal, pendingLegalItems, type LegalConfig } from "../../src/content/legal";

/** A fully filled copy of the shipped config: every null set, every draft flag removed. */
function filled(): LegalConfig {
  const walk = (v: unknown, key = ""): unknown => {
    if (v === null) return key === "body" ? ["Approved text."] : "filled";
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (typeof v !== "object") return v;
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => k !== "draft")
        .map(([k, x]) => [k, walk(x, k)]),
    );
  };
  return walk(legal) as LegalConfig;
}

/** Independent count of what the gate must flag: null leaves, blank strings, draft sections. */
function countPending(v: unknown): number {
  if (v === null || (typeof v === "string" && v.trim() === "")) return 1;
  if (typeof v !== "object") return 0;
  const own = (v as { draft?: unknown }).draft === true ? 1 : 0;
  return own + Object.values(v).reduce<number>((n, x) => n + countPending(x), 0);
}

describe("pendingLegalItems / assertLegalReady", () => {
  it("a fully filled config has nothing pending and passes", () => {
    const cfg = filled();
    assert.deepEqual(pendingLegalItems(cfg), []);
    assert.doesNotThrow(() => assertLegalReady(cfg));
  });

  it("shipped skeleton: lists every null and draft, and the gate throws naming all of them", () => {
    const expected = countPending(legal);
    const items = pendingLegalItems(legal);
    assert.equal(items.length, expected);
    if (expected === 0) return assert.doesNotThrow(() => assertLegalReady(legal)); // founder has filled everything
    // the two drafted sections the skeleton ships with, and a founder fact
    assert.ok(items.some((i) => i.includes("documents.disclaimer.sections.charger-information") && /draft/.test(i)));
    assert.ok(items.some((i) => i.includes("documents.attributions.sections.public-data") && /draft/.test(i)));
    assert.ok(items.some((i) => i.includes("entity.name")));
    assert.throws(
      () => assertLegalReady(legal),
      (e: Error) => {
        assert.match(e.message, new RegExp(`${expected} legal value`));
        for (const item of items) assert.ok(e.message.includes(item), `message does not name: ${item}`);
        return true;
      },
    );
  });

  it("one remaining null fails and is the only item named", () => {
    const cfg = filled();
    cfg.entity.name = null;
    const items = pendingLegalItems(cfg);
    assert.equal(items.length, 1);
    assert.match(items[0], /entity\.name/);
    assert.throws(() => assertLegalReady(cfg), /entity\.name/);
  });

  it("one remaining draft fails and names the section", () => {
    const cfg = filled();
    cfg.documents.terms.sections[0].draft = true;
    const items = pendingLegalItems(cfg);
    assert.equal(items.length, 1);
    assert.match(items[0], /terms\.sections\.using-fullcharge.*draft/);
    assert.throws(() => assertLegalReady(cfg), /terms\.sections\.using-fullcharge/);
  });

  it("null version, null date and null section body each fail", () => {
    for (const mutate of [
      (c: LegalConfig) => (c.documents.privacy.version = null),
      (c: LegalConfig) => (c.documents.privacy.effectiveDate = null),
      (c: LegalConfig) => (c.documents.privacy.sections[0].body = null),
    ]) {
      const cfg = filled();
      mutate(cfg);
      assert.equal(pendingLegalItems(cfg).length, 1);
      assert.throws(() => assertLegalReady(cfg), /privacy/);
    }
  });

  it("a blank or whitespace-only string counts as missing", () => {
    const cfg = filled();
    cfg.contact.supportEmail = "   ";
    assert.throws(() => assertLegalReady(cfg), /contact\.supportEmail/);
  });

  // Edge implied by WL-LEGAL-2 "no placeholders live": a section with a heading and no paragraphs is an empty page body.
  it("a section with an empty body array is not live-ready", () => {
    const cfg = filled();
    cfg.documents.privacy.sections[0].body = [];
    assert.throws(() => assertLegalReady(cfg));
  });
});

describe("module load gate (APP_ENV)", () => {
  const load = (appEnv?: string) => {
    const env = { ...process.env };
    delete env.APP_ENV;
    if (appEnv) env.APP_ENV = appEnv;
    return spawnSync(process.execPath, ["--import", "tsx", "-e", 'import("./src/content/legal.ts")'], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    });
  };

  it("importing with APP_ENV unset does not throw", () => {
    const r = load(); // fresh process: the static import above is cached, so it cannot show this
    assert.equal(r.status, 0, r.stderr);
  });

  it("importing with APP_ENV=production throws while the skeleton has nulls", { skip: countPending(legal) === 0 }, () => {
    const r = load("production");
    assert.notEqual(r.status, 0, "a production import must fail");
    assert.match(r.stderr, /Production build blocked/);
    assert.match(r.stderr, /entity\.name/);
  });
});
