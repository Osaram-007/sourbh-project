// WEB-B05 unit checks (no build): route discovery, the asset-register matcher and the register itself, the BANNED_COPY
// patterns, the text helpers, and the source-level banned-word scan of the generated images.
// Criteria: WL-LAND-5, WL-SEO-5, WL-LAND-11, G11.
// Run: npx tsx --test tests/web/marketing.test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { BANNED_COPY } from "./routes-support";
import { attributeAndJsonLdText, decode, discoverRoutes, listAssetFiles, parseRegister, registerProblems, stripComments, visibleText } from "./marketing-support";

const ROOT = process.cwd();
const APP = path.join(ROOT, "src/app");
const banned = (t: string) => BANNED_COPY.filter((b) => b.test(t));

/** Banned words in an image/manifest source file: whole file, comments stripped, minus the one known CSS false positive. */
const sourceHits = (src: string) => banned(stripComments(src).replace(/:\s*"100%"/g, ""));

describe("route discovery (filesystem)", () => {
  it("finds every marketing and legal page in the real tree (anti-vacuity)", () => {
    const routes = discoverRoutes(APP);
    for (const r of ["/", "/for-businesses", "/for-operators", "/about", "/legal/privacy", "/legal/terms", "/legal/disclaimer", "/legal/attributions", "/legal/delete-account"]) {
      assert.ok(routes.includes(r), `${r} not discovered; got ${routes}`);
    }
    for (const r of routes) assert.ok(!/^\/(app|admin|api|login|account)(\/|$)/.test(r), `${r} is not a marketing route`);
  });

  it("picks up a new page, ignores route groups and private folders, with no list to edit", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b05-"));
    try {
      for (const f of ["(marketing)/page.tsx", "(marketing)/pricing/page.tsx", "(marketing)/legal/x/page.tsx", "(marketing)/_components/page.tsx", "(marketing)/pricing/Card.tsx", "(app)/app/page.tsx"]) {
        fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
        fs.writeFileSync(path.join(tmp, f), "");
      }
      assert.deepEqual(discoverRoutes(tmp), ["/", "/legal/x", "/pricing"]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("asset-register matcher (synthetic)", () => {
  const head = ["| Task | Asset | Location | Origin | Owner | Licence | Date | Notes |", "|---|---|---|---|---|---|---|---|"];
  const reg = (...rows: string[]) => parseRegister([...head, ...rows].join("\n"));
  const good = reg("| T1 | Logo | `public/logo.svg`, `src/app/icon.tsx` | Drawn here | FullCharge | Project-owned | 2026-11-13 | n |");

  it("parses columns by header name, whatever their order", () => {
    const r = parseRegister("| Date | Licence | Owner | Origin | Location | Asset | Task |\n|---|---|---|---|---|---|---|\n| 2026-01-02 | MIT | Me | Here | `public/a.png` | A | T |");
    assert.deepEqual(r[0], { location: "`public/a.png`", origin: "Here", owner: "Me", licence: "MIT", date: "2026-01-02" });
    assert.deepEqual(registerProblems(["public/a.png"], r), []);
  });
  it("a registered, complete file passes", () => assert.deepEqual(registerProblems(["public/logo.svg", "src/app/icon.tsx"], good), []));
  it("an unregistered file fails", () => assert.match(registerProblems(["public/other.svg"], good)[0], /no row/));
  it("an empty licence fails", () => assert.match(registerProblems(["public/p.jpg"], reg("| T | P | `public/p.jpg` | Stock | Me | | 2026-01-01 | n |"))[0], /licence/));
  it("an empty origin fails", () => assert.match(registerProblems(["public/p.jpg"], reg("| T | P | `public/p.jpg` | | Me | MIT | 2026-01-01 | n |"))[0], /origin/));
  it("a missing owner fails", () => assert.match(registerProblems(["public/p.jpg"], reg("| T | P | `public/p.jpg` | Stock | | MIT | 2026-01-01 | n |"))[0], /owner/));
  it("a TBD licence fails (also -, ?, unknown, n/a)", () => {
    for (const v of ["TBD", "tbd", "-", "?", "Unknown", "N/A"]) {
      assert.match(registerProblems(["public/p.jpg"], reg(`| T | P | \`public/p.jpg\` | Stock | Me | ${v} | 2026-01-01 | n |`))[0], /licence/, v);
    }
  });
  it("a bad date fails", () => {
    for (const d of ["", "TBD", "13/11/2026", "2026-1-1", "2026-11-13T00:00"]) {
      assert.equal(registerProblems(["public/p.jpg"], reg(`| T | P | \`public/p.jpg\` | Stock | Me | MIT | ${d} | n |`)).length, 1, d);
    }
  });
  it("a longer or shorter path does not register another, and the Notes column does not count", () => {
    assert.equal(registerProblems(["public/logo.sv"], good).length, 1);
    assert.equal(registerProblems(["logo.svg"], good).length, 1);
    assert.equal(registerProblems(["public/ghost.png"], reg("| T | A | `x` | o | m | l | 2026-01-01 | mentions public/ghost.png |")).length, 1);
  });
  it("a row naming public/logo.svg.bak does not register public/logo.svg", () => {
    const bak = reg("| T | A | `public/logo.svg.bak` | o | m | l | 2026-01-01 | n |");
    assert.equal(registerProblems(["public/logo.svg"], bak).length, 1);
    assert.deepEqual(registerProblems(["public/logo.svg.bak"], bak), []);
    // a sentence-ending full stop after the path is still a match
    assert.deepEqual(registerProblems(["public/logo.svg"], reg("| T | A | See public/logo.svg. | o | m | l | 2026-01-01 | n |")), []);
  });
});

describe("WL-LAND-11 / G11: every asset file in the repo has a complete register row", () => {
  const rows = parseRegister(fs.readFileSync(path.join(ROOT, "docs/asset-register.md"), "utf8"));
  const files = listAssetFiles(ROOT);

  it("control: the register parses, and the real icon files are in the file list", () => {
    assert.ok(rows.length >= 3, "register has too few rows, so the parser may be broken");
    assert.ok(rows.every((r) => r.owner !== undefined && r.date !== undefined && r.location));
    for (const f of ["src/app/icon.tsx", "src/app/apple-icon.tsx", "src/app/opengraph-image.tsx", "src/app/manifest.ts"]) assert.ok(files.includes(f), `${f} not listed`);
  });
  it("every file under public/, every icon/OG/manifest file under src/app, and every image under src/ is registered", () => {
    assert.deepEqual(registerProblems(files, rows), []);
  });
});

describe("WL-LAND-5 / WL-SEO-5: generated image and manifest sources carry no banned wording", () => {
  for (const f of ["icon.tsx", "apple-icon.tsx", "opengraph-image.tsx", "manifest.ts"]) {
    it(f, () => {
      const src = fs.readFileSync(path.join(APP, f), "utf8");
      assert.ok(stripComments(src).length > 50);
      assert.deepEqual(sourceHits(src).map(String), []);
    });
  }

  // The scan must catch each of these (reviewer probes), and must ignore comments and the CSS width.
  for (const [name, code] of [
    ["JSX text with a brace expression", "x = <div>Real-time status at {n} chargers</div>;"],
    ["single-quoted alt", "export const alt = 'Reliable charger data';"],
    ["template literal", "export const alt = `Guaranteed ${x}`;"],
    ["double-quoted 100%", 'const t = "100% EV";'],
    ["100 percent", 'const t = "100 percent";'],
  ] as const) it(`catches: ${name}`, () => assert.ok(sourceHits(code).length > 0, code));
  it("ignores comments and the CSS width", () => assert.deepEqual(sourceHits('// real-time\n/* reliable */\nconst s = { width: "100%", height: "100%" };'), []));
});

describe("BANNED_COPY patterns", () => {
  it("catches the spec list", () => {
    for (const w of ["real-time", "Real time", "realtime", "reliable", "trip planner", "plan a trip", "highway", "guaranteed", "100%", "all major networks"]) assert.ok(banned(w).length, w);
  });
  it("catches other hyphens and spacing: en dash, non-breaking hyphen, soft hyphen, 100 %, 100 percent", () => {
    for (const w of ["real–time", "real‑time", "real­time", "real—time", "100 %", "100 percent", "100 %"]) assert.ok(banned(w).length, JSON.stringify(w));
  });
  it("does not match innocent words", () => {
    for (const w of ["a small majority of chargers", "overall majority", "1000 chargers", "100 km"]) assert.deepEqual(banned(w).map(String), [], w);
  });
});

describe("text helpers", () => {
  it("visibleText drops scripts, styles, head and tags, and decodes entities", () => {
    const t = visibleText("<html><head><title>T</title></head><body><script>real-time</script><style>.a{}</style><p>Tom &amp; Jerry&#x27;s &#39;x&#39;</p></body></html>");
    assert.equal(t, "Tom & Jerry's 'x'");
  });
  it("React's <!-- --> between text nodes does not split a word or a number", () => {
    assert.ok(banned(visibleText("<p>100<!-- -->% of chargers</p>")).length, "100<!-- -->%");
    assert.ok(banned(visibleText("<p>real<!-- -->-time</p>")).length, "real<!-- -->-time");
  });
  it("inline tags do not hide a banned word when scanned with inline=true", () => {
    const html = "<p><b>100</b>% of chargers</p>";
    assert.ok(banned(visibleText(html, true)).length);
    assert.ok(banned(visibleText("<p>Re<em>liable</em> data</p>", true)).length);
    assert.equal(visibleText("<p>a</p><p>b</p>", true), "ab", "inline mode joins block text: that is why the spaced version is scanned too");
    assert.equal(visibleText("<p>a</p><p>b</p>"), "a b");
  });
  it("attributeAndJsonLdText returns alt, title, placeholder, aria-label values and JSON-LD bodies", () => {
    const html = '<img alt="A &amp; B"><input placeholder="Search city" aria-label="Find"><a title="T">x</a><script type="application/ld+json">{"description":"real-time"}</script><script>other</script>';
    assert.deepEqual(attributeAndJsonLdText(html), ["A & B", "Search city", "Find", "T", '{"description":"real-time"}']);
  });
  it("decode handles numeric and named entities", () => assert.equal(decode("&lt;a&gt; &quot;q&quot; &#8377;"), '<a> "q" ₹'));
});
