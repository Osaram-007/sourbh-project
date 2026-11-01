// T3-09 legal config gate (WL-LEGAL-2): a production build must fail while any legal value is null, blank,
// placeholder text, undefined or an empty section body, or while a section is still draft, and must name what is
// missing. Pure logic, no build.
// Content arrives in stages (founder facts first, counsel texts later), so nothing here may depend on which
// values the shipped config currently holds: logic tests run on a synthetic fixture; the shipped config is only
// checked against itself.
// Run from the repo root: npx tsx --test tests/web/legal.test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  assertLegalReady,
  legal,
  pendingLegalItems,
  type LegalConfig,
  type LegalDocument,
  type LegalSlug,
} from "../../src/content/legal";

const SLUGS: LegalSlug[] = ["privacy", "terms", "disclaimer", "attributions", "delete-account"];

const docOf = (slug: LegalSlug): LegalDocument => ({
  title: "Title",
  description: "Description",
  path: `/legal/${slug}`,
  version: "1.0",
  effectiveDate: "2026-01-01",
  sections: [
    { id: "sec-a", heading: "A", body: ["Approved text."] },
    { id: "sec-b", heading: "B", body: ["More approved text."] },
  ],
});

/** A fully filled config that does not depend on the shipped one. */
function fixture(): LegalConfig {
  return {
    entity: { name: "Acme", registeredAddress: "1 Test Lane" },
    contact: { supportEmail: "help@acme.example" },
    grievanceOfficer: { name: "A. Person", email: "g@acme.example", postalAddress: "2 Test Lane", responseTime: "7 days" },
    documents: Object.fromEntries(SLUGS.map((s) => [s, docOf(s)])) as Record<LegalSlug, LegalDocument>,
  };
}

const change = (mutate: (c: LegalConfig) => void): LegalConfig => {
  const c = fixture();
  mutate(c);
  return c;
};

/** The founder facts, one setter each, in the order the founder might supply them. */
const FACTS: Array<(c: LegalConfig, v: string | null) => void> = [
  (c, v) => (c.entity.name = v),
  (c, v) => (c.entity.registeredAddress = v),
  (c, v) => (c.contact.supportEmail = v),
  (c, v) => (c.grievanceOfficer.name = v),
  (c, v) => (c.grievanceOfficer.email = v),
  (c, v) => (c.grievanceOfficer.postalAddress = v),
  (c, v) => (c.grievanceOfficer.responseTime = v),
];

/** The message of the error the gate throws for `cfg`; fails the test if it does not throw. */
function gateError(cfg: LegalConfig): string {
  try {
    assertLegalReady(cfg);
  } catch (e) {
    return (e as Error).message;
  }
  assert.fail("assertLegalReady did not throw");
}

/** Lower bound for the shipped config: null leaves, blank strings and draft sections, counted independently. */
function countPending(v: unknown): number {
  if (v === null || (typeof v === "string" && v.trim() === "")) return 1;
  if (typeof v !== "object") return 0;
  const own = (v as { draft?: unknown }).draft === true ? 1 : 0;
  return own + Object.values(v).reduce<number>((n, x) => n + countPending(x), 0);
}

describe("pendingLegalItems / assertLegalReady", () => {
  it("a fully filled config has nothing pending and passes", () => {
    const cfg = fixture();
    assert.deepEqual(pendingLegalItems(cfg), []);
    assert.doesNotThrow(() => assertLegalReady(cfg));
  });

  it("shipped config: lists every null and draft, and the gate throws naming all of them", () => {
    const items = pendingLegalItems(legal);
    assert.ok(items.length >= countPending(legal), "an independently counted null, blank or draft was not listed");
    if (items.length === 0) return assert.doesNotThrow(() => assertLegalReady(legal)); // everything is filled
    const message = gateError(legal);
    assert.match(message, new RegExp(`${items.length} legal value`));
    for (const item of items) assert.ok(message.includes(item), `message does not name: ${item}`);
  });

  it("one remaining null fails and is the only item named", () => {
    const cfg = change((c) => (c.entity.name = null));
    const items = pendingLegalItems(cfg);
    assert.equal(items.length, 1);
    assert.match(items[0], /entity\.name/);
    assert.match(gateError(cfg), /1 legal value[\s\S]*entity\.name/);
  });

  it("one remaining draft fails and names the section", () => {
    const cfg = change((c) => (c.documents.terms.sections[0].draft = true));
    const items = pendingLegalItems(cfg);
    assert.equal(items.length, 1);
    assert.match(items[0], /terms\.sections\.sec-a.*draft/);
    assert.match(gateError(cfg), /terms\.sections\.sec-a/);
  });

  it("null version, null date and null section body each fail", () => {
    for (const mutate of [
      (c: LegalConfig) => (c.documents.privacy.version = null),
      (c: LegalConfig) => (c.documents.privacy.effectiveDate = null),
      (c: LegalConfig) => (c.documents.privacy.sections[0].body = null),
    ]) {
      const cfg = change(mutate);
      assert.equal(pendingLegalItems(cfg).length, 1);
      assert.match(gateError(cfg), /privacy/);
    }
  });

  it("a blank or whitespace-only string counts as missing", () => {
    for (const blank of ["", "   ", "\n\t"]) {
      const cfg = change((c) => (c.contact.supportEmail = blank));
      assert.match(gateError(cfg), /contact\.supportEmail/);
    }
  });

  it("an explicit undefined counts as missing", () => {
    for (const [path, mutate] of [
      ["entity.name", (c: LegalConfig) => ((c.entity as { name: unknown }).name = undefined)],
      ["privacy.version", (c: LegalConfig) => ((c.documents.privacy as { version: unknown }).version = undefined)],
      ["sec-a.body", (c: LegalConfig) => ((c.documents.terms.sections[0] as { body: unknown }).body = undefined)],
    ] as const) {
      const cfg = change(mutate);
      assert.equal(pendingLegalItems(cfg).length, 1, path);
      assert.ok(gateError(cfg).includes(path), path);
    }
  });

  it("a section with an empty or all-blank body array is not live-ready", () => {
    for (const body of [[], ["", "  "]]) {
      const cfg = change((c) => (c.documents.privacy.sections[0].body = body));
      assert.match(gateError(cfg), /privacy\.sections\.sec-a/);
    }
  });

  describe("placeholder text counts as missing", () => {
    const PLACEHOLDERS = [
      "[FOUNDER: legal name]",
      "[founder: legal name]",
      "[verify: address]",
      "[VERIFY]",
      "To be confirmed",
      "TO BE CONFIRMED",
      "response within 7 days, to be confirmed by counsel",
      "TBD",
      "tbd",
      "TBC",
      "tbc.",
      "Address: TBD",
    ];

    it("in a founder fact", () => {
      for (const text of PLACEHOLDERS) {
        const cfg = change((c) => (c.entity.name = text));
        const items = pendingLegalItems(cfg);
        assert.equal(items.length, 1, text);
        assert.match(items[0], /entity\.name/, text);
        assert.match(gateError(cfg), /entity\.name/, text);
      }
    });

    it("inside a body array, next to clean paragraphs", () => {
      for (const text of PLACEHOLDERS) {
        const cfg = change((c) => (c.documents.terms.sections[1].body = ["Clean paragraph.", `Text. ${text}`, "Another."]));
        const items = pendingLegalItems(cfg);
        assert.equal(items.length, 1, text);
        assert.match(items[0], /terms\.sections\.sec-b\.body/, text);
      }
    });

    it("but similar-looking clean values pass", () => {
      for (const text of ["tbdx", "atbd", "tbcx", "Founder Street, Pune", "Verify Labs", "Founders Lane", "confirmed"]) {
        const cfg = change((c) => {
          c.entity.name = text;
          c.documents.terms.sections[0].body = [text];
        });
        assert.deepEqual(pendingLegalItems(cfg), [], text);
      }
    });
  });

  it("the error never tells the reader to build without APP_ENV=production", () => {
    const broken = [
      legal,
      change((c) => (c.entity.name = null)),
      change((c) => (c.documents.terms.sections[0].draft = true)),
      change((c) => (c.entity.name = "TBD")),
    ];
    for (const cfg of broken) {
      if (pendingLegalItems(cfg).length) assert.doesNotMatch(gateError(cfg), /build without/i);
    }
  });

  it("stage by stage: each founder fact filled removes exactly its own item", () => {
    const cfg = fixture();
    for (const set of FACTS) set(cfg, null);
    assert.equal(pendingLegalItems(cfg).length, FACTS.length);
    FACTS[0](cfg, "Acme"); // only entity.name filled
    let items = pendingLegalItems(cfg);
    assert.equal(items.length, FACTS.length - 1);
    assert.ok(!items.some((i) => i.includes("entity.name")));
    assert.doesNotMatch(gateError(cfg), /entity\.name/);
    for (let i = 1; i < FACTS.length; i++) {
      FACTS[i](cfg, "filled");
      items = pendingLegalItems(cfg);
      assert.equal(items.length, FACTS.length - 1 - i);
    }
    assert.doesNotThrow(() => assertLegalReady(cfg));
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

  it("importing with APP_ENV=production throws and names what is missing", { skip: pendingLegalItems(legal).length === 0 }, () => {
    const r = load("production");
    assert.notEqual(r.status, 0, "a production import must fail");
    assert.match(r.stderr, /Production build blocked/);
    for (const item of pendingLegalItems(legal)) assert.ok(r.stderr.includes(item), `stderr does not name: ${item}`);
    assert.doesNotMatch(r.stderr, /build without/i);
  });
});
