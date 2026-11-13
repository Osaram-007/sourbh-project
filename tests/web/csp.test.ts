// WEB-S05 / ADR-0016 source guards (no build). Run: npx tsx --test tests/web/csp.test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { stripComments } from "./marketing-support";

const ROOT = process.cwd();
const APP = path.join(ROOT, "src/app");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

/** Top-level folders under src/app whose pages the proxy covers with a nonce CSP. */
export const NONCE_GROUPS = ["(app)", "(auth)", "admin", "account"];

/** URL of a page file: route groups "(x)" are not part of the URL. */
const urlOf = (segs: string[]) => "/" + segs.slice(0, -1).filter((x) => !/^\(.+\)$/.test(x)).join("/");
const PROXY_URL = /^\/(app|login|admin|account)(\/|$)/;

/**
 * Pages whose URL the proxy does not cover and that are not marketing: they would silently get the 'unsafe-inline' static
 * policy. Decided by URL, not folder, so (app)/foo/page.tsx (serves /foo) is caught.
 */
export const strayPages = (files: string[], appDir: string) =>
  files
    .map((f) => path.relative(appDir, f).split(path.sep))
    .filter((segs) => /^page\.(tsx|ts|jsx|js|mdx)$/.test(segs[segs.length - 1]))
    .filter((segs) => segs[0] !== "(marketing)" && !PROXY_URL.test(urlOf(segs)))
    .map((segs) => segs.join("/"));

describe("N6: every page is either marketing or on a nonce surface", () => {
  it("no stray page.tsx outside (marketing), (app), (auth), admin, account", () => {
    assert.deepEqual(strayPages(walk(APP), APP), []);
  });
  it("control: the scan flags a stray page and ignores the allowed groups", () => {
    const f = (p: string) => path.join("/x", p);
    const ok = [f("(marketing)/a/page.tsx"), f("admin/x/page.tsx"), f("(auth)/login/page.tsx"), f("(app)/app/page.tsx"), f("(app)/app/x/page.tsx"), f("account/page.tsx"), f("layout.tsx")];
    assert.deepEqual(strayPages([f("pricing/page.tsx"), ...ok], "/x"), ["pricing/page.tsx"]);
    // The folder is allowed but the URL (/foo) is not covered by the proxy.
    assert.deepEqual(strayPages([f("(app)/foo/page.tsx"), f("(auth)/signup/page.tsx"), f("admin2/page.tsx"), ...ok], "/x"), ["(app)/foo/page.tsx", "(auth)/signup/page.tsx", "admin2/page.tsx"]);
  });
  it("control: the real tree has pages in (marketing) and in a nonce group", () => {
    const pages = walk(APP).filter((f) => /page\.tsx$/.test(f)).map((f) => path.relative(APP, f).split(path.sep)[0]);
    assert.ok(pages.includes("(marketing)") && pages.some((g) => NONCE_GROUPS.includes(g)), pages.join());
  });
});

// Links between CSP surfaces must be full page loads (a client-side <Link> navigation keeps the old document and its CSP).
const surfaceOfUrl = (u: string) => /^\/(app|login|admin|account)(\/|$)/.exec(u)?.[1] ?? "marketing";
const surfaceOfFile = (f: string) => (f.startsWith("src/app/(app)/") ? "app" : f.startsWith("src/app/(auth)/") ? "login" : f.startsWith("src/app/admin/") ? "admin" : "marketing");
/** "file -> target" for every <Link href="/..."> in a next/link-importing file whose target is on another CSP surface. */
export const crossSurfaceLinks = (file: string, raw: string) => {
  const src = stripComments(raw);
  if (!/from\s+["']next\/link["']/.test(src)) return [];
  const from = surfaceOfFile(file);
  return [...src.matchAll(/<Link\b[^>]*?\bhref\s*=\s*(?:\{\s*)?["'`](\/[^"'`?#]*)/g)]
    .map((m) => m[1])
    .filter((t) => surfaceOfUrl(t) !== from)
    .map((t) => `${file} -> ${t}`);
};
// Known cross-surface Links, by file plus target. Anything else fails.
const ALLOWED = new Set([
  "src/app/(app)/app/page.tsx -> /admin/sessions", // WEB-B13 (rework of /app) removes it or turns it into <a>
  "src/app/admin/analytics/page.tsx -> /", // WEB-B19 (admin rework)
  "src/app/admin/sessions/page.tsx -> /", // WEB-B19 (admin rework)
]);

describe("navigation rule: no client-side <Link> across CSP surfaces", () => {
  const dirs = ["src/app", "src/components/landing", "src/components/contact", "src/components/site", "src/components/ui"].map((d) => path.join(ROOT, d));
  const files = dirs.flatMap(walk).filter((f) => /\.(tsx|ts|jsx|js)$/.test(f));
  const found = [...new Set(files.flatMap((f) => crossSurfaceLinks(rel(f), fs.readFileSync(f, "utf8"))))];

  it("scans real files (anti-vacuity)", () => assert.ok(files.length > 30, String(files.length)));
  it("only the allowlisted file/target pairs exist", () => assert.deepEqual(found.filter((x) => !ALLOWED.has(x)), []));
  it("the allowlist has no stale entries (remove a line when its Link goes)", () => assert.deepEqual([...ALLOWED].filter((x) => !found.includes(x)), []));
  it("control: the detector flags cross-surface Links and ignores same-surface, plain <a> and comments", () => {
    const imp = 'import Link from "next/link";\n';
    assert.deepEqual(crossSurfaceLinks("src/app/(marketing)/x.tsx", imp + '<Link href="/app">x</Link>'), ["src/app/(marketing)/x.tsx -> /app"]);
    assert.deepEqual(crossSurfaceLinks("src/components/site/x.tsx", imp + "<Link\n  prefetch={false}\n  href='/login?next=/app'>x</Link>"), ["src/components/site/x.tsx -> /login"]);
    assert.deepEqual(crossSurfaceLinks("src/app/admin/a/page.tsx", imp + '<Link href="/">x</Link>'), ["src/app/admin/a/page.tsx -> /"]);
    assert.deepEqual(crossSurfaceLinks("src/app/(app)/app/page.tsx", imp + '<Link href="/app/x">x</Link>'), []);
    assert.deepEqual(crossSurfaceLinks("src/app/admin/a/page.tsx", imp + '<Link href="/admin/b">x</Link>'), []);
    assert.deepEqual(crossSurfaceLinks("src/app/(marketing)/x.tsx", '<a href="/app">x</a>'), []);
    assert.deepEqual(crossSurfaceLinks("src/app/(marketing)/x.tsx", '// import Link from "next/link"\n<a href="/app">x</a>'), []);
  });
});
