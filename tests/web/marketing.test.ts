// WEB-B05 unit checks (no build): route discovery, the asset-register matcher and the register itself, and the
// source-level banned-word scan of the generated images. Criteria: WL-LAND-5, WL-SEO-5, WL-LAND-11, WL-LAND-12, G11.
// Run: npx tsx --test tests/web/marketing.test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { BANNED_COPY } from "./routes-support";
import { decode, discoverRoutes, listAssetFiles, parseRegister, registerProblems, stripComments, visibleText } from "./marketing-support";

const ROOT = process.cwd();
const APP = path.join(ROOT, "src/app");

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
  const reg = parseRegister(
    [
      "| Task | Asset | Location | Origin | Licence | Notes |",
      "|---|---|---|---|---|---|",
      "| T1 | Logo | `public/logo.svg`, `src/app/icon.tsx` | Drawn here | Project-owned | n |",
      "| T2 | Photo | `public/photo.jpg` | Stock site | | missing licence |",
      "| T3 | Blank origin | `public/blank.png` | | MIT | n |",
    ].join("\n"),
  );

  it("parses the rows", () => assert.equal(reg.length, 3));
  it("a registered file passes", () => assert.deepEqual(registerProblems(["public/logo.svg", "src/app/icon.tsx"], reg), []));
  it("an unregistered file fails", () => {
    const p = registerProblems(["public/other.svg"], reg);
    assert.equal(p.length, 1);
    assert.match(p[0], /no row/);
  });
  it("a row with an empty licence fails", () => assert.match(registerProblems(["public/photo.jpg"], reg)[0], /empty Origin or Licence/));
  it("a row with an empty origin fails", () => assert.match(registerProblems(["public/blank.png"], reg)[0], /empty Origin or Licence/));
  it("a longer path does not register a shorter one, and a path in the Notes column does not count", () => {
    assert.equal(registerProblems(["public/logo.sv"], reg).length, 1);
    assert.equal(registerProblems(["logo.svg"], reg).length, 1);
    const noted = parseRegister("| T | A | `x` | o | l | mentions public/ghost.png |");
    assert.equal(registerProblems(["public/ghost.png"], noted).length, 1);
  });
});

describe("WL-LAND-11 / WL-LAND-12 / G11: every asset file in the repo has a complete register row", () => {
  const rows = parseRegister(fs.readFileSync(path.join(ROOT, "docs/asset-register.md"), "utf8"));
  const files = listAssetFiles(ROOT);

  it("control: the register parses, and the real icon files are in the file list", () => {
    assert.ok(rows.length >= 3, "register has too few rows, so the parser may be broken");
    for (const f of ["src/app/icon.tsx", "src/app/apple-icon.tsx", "src/app/opengraph-image.tsx", "src/app/manifest.ts"]) assert.ok(files.includes(f), `${f} not listed`);
  });
  it("no leftover Create Next App favicon or logo files", () => {
    assert.ok(!files.some((f) => /favicon\.ico$|(^|\/)(next|vercel|file|globe|window)\.svg$/.test(f)), files.join(", "));
  });
  it("every file under public/, every icon/OG/manifest file under src/app, and every image under src/ is registered", () => {
    assert.deepEqual(registerProblems(files, rows), []);
  });
});

describe("WL-LAND-5 / WL-SEO-5: generated image and manifest sources carry no banned wording", () => {
  for (const f of ["icon.tsx", "apple-icon.tsx", "opengraph-image.tsx", "manifest.ts"]) {
    it(f, () => {
      const code = stripComments(fs.readFileSync(path.join(APP, f), "utf8"));
      // Only words a person or crawler can read: JSX text, string literals that are not CSS or colours, and the alt export.
      // (Scanning raw code would trip on style values such as width: "100%".)
      const texts = [...code.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]).concat([...code.matchAll(/"([^"]{3,})"/g)].map((m) => m[1]).filter((t) => /s|[a-z]{4}/i.test(t) && !/^[#%w.:/-]+$/.test(t) || /s/.test(t)));
      assert.ok(texts.length > 0, "no text found, so the scan would pass vacuously");
      for (const t of texts) for (const b of BANNED_COPY) assert.doesNotMatch(t, b, `${f}: "${t}" matches ${b}`);
    });
  }
});

describe("text helpers", () => {
  it("visibleText drops scripts, styles, head and tags, and decodes entities", () => {
    const t = visibleText("<html><head><title>T</title></head><body><script>real-time</script><style>.a{}</style><p>Tom &amp; Jerry&#x27;s &#39;x&#39;</p></body></html>");
    assert.equal(t, "Tom & Jerry's 'x'");
  });
  it("decode handles numeric and named entities", () => assert.equal(decode("&lt;a&gt; &quot;q&quot; &#8377;"), '<a> "q" ₹'));
  it("BANNED_COPY catches the spec list", () => {
    for (const w of ["real-time", "Real time", "reliable", "trip planner", "plan a trip", "highway", "guaranteed", "100%", "all major networks"]) {
      assert.ok(BANNED_COPY.some((r) => r.test(w)), w);
    }
  });
});
