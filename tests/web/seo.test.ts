// WEB-B04 unit checks: robots.ts and sitemap.ts in the open and closed states, error pages, and the error-page import guard.
// Criteria: WL-SEO-2, WL-SEO-6, WL-SEO-7, WL-SEO-8, WL-PERF-2.
// Run: npx tsx --test tests/web/seo.test.ts  (error pages are called as functions, no DOM)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const APP = join(ROOT, "src/app");

/** Import robots.ts and sitemap.ts in a child with only `env` set, so the build-time env reads see exactly that. */
function load(env: { SITE_NOINDEX?: string; APP_ORIGIN?: string }) {
  const childEnv: Record<string, string | undefined> = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, HOME: process.env.HOME, ...env };
  const imp = (f: string) => `(async()=>{const m=await import(${JSON.stringify(pathToFileURL(join(APP, f)).href)});return typeof m.default==="function"?m.default:m.default.default;})()`;
  const code = `const r=await ${imp("robots.ts")};const s=await ${imp("sitemap.ts")};process.stdout.write(JSON.stringify({robots:r(),sitemap:s()}));`;
  const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: ROOT, env: childEnv as NodeJS.ProcessEnv, encoding: "utf8", timeout: 90_000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as {
    robots: { rules: { userAgent: string; allow?: string; disallow: string | string[] }; sitemap?: string };
    sitemap: { url: string }[];
  };
}

const ORIGIN = "https://example.test";
const PRIVATE = ["/app", "/admin", "/api", "/login", "/account"];
const EXPECTED_PATHS = ["/", "/for-businesses", "/for-operators", "/about", "/legal/privacy", "/legal/terms", "/legal/disclaimer", "/legal/attributions", "/legal/delete-account"];

describe("WL-SEO-2 / WL-SEO-8: open state (SITE_NOINDEX=0 and APP_ORIGIN set)", () => {
  const { robots, sitemap } = load({ SITE_NOINDEX: "0", APP_ORIGIN: `${ORIGIN}/some/path?x=1` });

  it("robots allows / and disallows exactly the private areas", () => {
    assert.equal(robots.rules.userAgent, "*");
    assert.equal(robots.rules.allow, "/");
    assert.deepEqual(robots.rules.disallow, PRIVATE);
  });

  it("robots names the sitemap at the origin only", () => {
    assert.equal(robots.sitemap, `${ORIGIN}/sitemap.xml`);
  });

  it("sitemap lists exactly the marketing and legal routes, absolute, on the origin", () => {
    assert.deepEqual(sitemap.map((e) => e.url), EXPECTED_PATHS.map((p) => (p === "/" ? ORIGIN : ORIGIN + p)));
  });

  it("sitemap has no private, API or station path", () => {
    for (const { url } of sitemap) {
      const p = new URL(url).pathname;
      for (const bad of [...PRIVATE, "/station"]) assert.ok(p !== bad && !p.startsWith(bad + "/"), `${url} is not indexable (WL-SEO-2, WL-SEO-7)`);
    }
  });

  // The B03 pages (/for-businesses, /for-operators, /about) merge from a parallel branch. Until then they may be missing.
  // ponytail: after integration, empty PENDING_B03 so this becomes strict.
  const PENDING_B03 = new Set(["/for-businesses", "/for-operators", "/about"]);
  it("every sitemap path is a page that exists in src/app", () => {
    const groups = readdirSync(APP, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\(.+\)$/.test(e.name)).map((e) => e.name);
    for (const { url } of sitemap) {
      const p = new URL(url).pathname;
      if (PENDING_B03.has(p)) continue;
      const rel = p === "/" ? "" : p;
      const found = ["", ...groups].some((g) => ["page.tsx", "page.ts", "page.jsx", "page.js"].some((f) => existsSync(join(APP, g, rel, f))));
      assert.ok(found, `sitemap lists ${p} but no page file exists for it`);
    }
  });
});

describe("WL-SEO-8: states that must stay closed", () => {
  const closed = (env: { SITE_NOINDEX?: string; APP_ORIGIN?: string }) => {
    const { robots, sitemap } = load(env);
    assert.deepEqual(robots.rules, { userAgent: "*", disallow: "/" });
    assert.equal(robots.sitemap, undefined);
    assert.deepEqual(sitemap, []);
  };
  it("flag unset, origin set", () => closed({ APP_ORIGIN: ORIGIN }));
  it("flag '1', origin set", () => closed({ SITE_NOINDEX: "1", APP_ORIGIN: ORIGIN }));
  it("flag unset, origin unset", () => closed({}));
  for (const v of ["", "false", "off"]) it(`flag '${v}' is not an opt-in (only '0' opens)`, () => closed({ SITE_NOINDEX: v, APP_ORIGIN: ORIGIN }));
});

describe("WL-SEO-2: indexing on but no origin", () => {
  const { robots, sitemap } = load({ SITE_NOINDEX: "0" });
  it("sitemap is empty (no relative URLs)", () => assert.deepEqual(sitemap, []));
  it("robots still protects the private areas and has no Sitemap line", () => {
    assert.deepEqual(robots.rules.disallow, PRIVATE);
    assert.equal(robots.sitemap, undefined);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// WL-SEO-6: error boundaries. Called as plain functions (no DOM): the result is an element tree we can walk.
type El = { type: unknown; props: { children?: unknown; [k: string]: unknown } };
const isEl = (n: unknown): n is El => typeof n === "object" && n !== null && "props" in n;
function find(n: unknown, pred: (e: El) => boolean, out: El[] = []): El[] {
  if (Array.isArray(n)) n.forEach((c) => find(c, pred, out));
  else if (isEl(n)) {
    if (pred(n)) out.push(n);
    find(n.props.children, pred, out);
  }
  return out;
}
const text = (n: unknown): string => (Array.isArray(n) ? n.map(text).join("") : isEl(n) ? text(n.props.children) : typeof n === "string" ? n : "");

describe("WL-SEO-6: error.tsx and global-error.tsx", () => {
  for (const file of ["error", "global-error"]) {
    describe(file, () => {
      it("has noindex, a Try again button wired to retry, and plain anchors to / and /app", async () => {
        // Next 16.4 passes `retry` (docs: file-conventions/error); `reset` is the older, discouraged prop.
        const mod = await import(pathToFileURL(join(APP, `${file}.tsx`)).href);
        const Comp = typeof mod.default === "function" ? mod.default : mod.default.default;
        let calls = 0;
        const tree = Comp({ error: new Error("x"), retry: () => calls++, reset: () => calls++ });

        assert.ok(find(tree, (e) => e.type === "meta" && e.props.name === "robots" && /noindex/.test(String(e.props.content))).length === 1, "no robots noindex <meta>");
        const [btn] = find(tree, (e) => e.type === "button");
        assert.ok(btn, "no button");
        assert.equal(text(btn), "Try again");
        assert.equal(typeof btn.props.onClick, "function");
        (btn.props.onClick as () => void)();
        assert.equal(calls, 1, "the button must call retry (or reset) exactly once");

        const hrefs = find(tree, (e) => e.type === "a").map((e) => e.props.href);
        assert.deepEqual(hrefs, ["/", "/app"]);
        assert.equal(find(tree, (e) => typeof e.type !== "string" && "href" in e.props).length, 0, "uses a component link (next/link) instead of <a>");
        assert.equal(find(tree, (e) => e.type === "h1").length, 1);
      });
    });
  }

  it("global-error renders its own <html lang=en-IN> and <body>; error does not", async () => {
    const load = async (f: string) => {
      const m = await import(pathToFileURL(join(APP, `${f}.tsx`)).href);
      return (typeof m.default === "function" ? m.default : m.default.default)({ error: new Error("x"), retry() {} });
    };
    const g = await load("global-error");
    assert.equal(g.type, "html");
    assert.equal(g.props.lang, "en-IN");
    assert.equal(find(g, (e) => e.type === "body").length, 1);
    const e = await load("error");
    assert.equal(find(e, (x) => x.type === "html" || x.type === "body").length, 0, "error.tsx must not render a document");
  });
});

describe("WL-SEO-6: not-found.tsx", () => {
  it("exports noindex metadata and a plain-anchor, client-JS-free page", async () => {
    const mod = await import(pathToFileURL(join(APP, "not-found.tsx")).href);
    const NF = typeof mod.default === "function" ? mod.default : mod.default.default;
    const meta = mod.metadata ?? mod.default?.metadata;
    assert.deepEqual(meta.robots, { index: false, follow: false });
    const tree = NF();
    assert.deepEqual(find(tree, (e) => e.type === "a").map((e) => e.props.href), ["/", "/app"]);
    assert.equal(find(tree, (e) => e.type === "h1").length, 1);
    assert.ok(!/^\s*["']use client["']/m.test(readFileSync(join(APP, "not-found.tsx"), "utf8")));
  });
});

// WL-PERF-2: error.tsx wraps every route, so it ships on every page. It must stay free of heavy modules.
// The two files have no imports today; any import at all must be react, and never a banned library.
describe("WL-PERF-2: error pages import nothing heavy", () => {
  const BANNED = /lucide|react-query|@tanstack|zustand|vaul|firebase|@react-google-maps|googlemaps|google-maps|next-auth|@\/store|\/store\/|@\/components|\.\.\/components|framer/i;
  for (const file of ["error.tsx", "global-error.tsx"]) {
    it(`${file}: no banned import, and only react (or nothing) is imported`, () => {
      const src = readFileSync(resolve(APP, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      const specs = [...src.matchAll(/(?:from\s*|import\s*\(\s*|import\s+|require\(\s*)["']([^"']+)["']/g)].map((m) => m[1]);
      for (const s of specs) {
        assert.doesNotMatch(s, BANNED, `${file} imports ${s}`);
        assert.match(s, /^react(\/|$)/, `${file} imports ${s}: keep the error pages dependency-free`);
      }
      assert.match(src, /^\s*["']use client["']/m, `${file} must be a client component`);
    });
  }
});
