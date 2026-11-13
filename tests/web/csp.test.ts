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

/** Pages that are not under (marketing) and not in a nonce group: they would silently get the 'unsafe-inline' static policy. */
export const strayPages = (files: string[], appDir: string) =>
  files
    .map((f) => path.relative(appDir, f).split(path.sep))
    .filter((segs) => /^page\.(tsx|ts|jsx|js|mdx)$/.test(segs[segs.length - 1]))
    .filter((segs) => !["(marketing)", ...NONCE_GROUPS].includes(segs[0]))
    .map((segs) => segs.join("/"));

describe("N6: every page is either marketing or on a nonce surface", () => {
  it("no stray page.tsx outside (marketing), (app), (auth), admin, account", () => {
    assert.deepEqual(strayPages(walk(APP), APP), []);
  });
  it("control: the scan flags a stray page and ignores the allowed groups", () => {
    const f = (p: string) => path.join("/x", p);
    assert.deepEqual(strayPages([f("pricing/page.tsx"), f("(marketing)/a/page.tsx"), f("admin/x/page.tsx"), f("(auth)/login/page.tsx"), f("layout.tsx")], "/x"), ["pricing/page.tsx"]);
  });
  it("control: the real tree has pages in (marketing) and in a nonce group", () => {
    const pages = walk(APP).filter((f) => /page\.tsx$/.test(f)).map((f) => path.relative(APP, f).split(path.sep)[0]);
    assert.ok(pages.includes("(marketing)") && pages.some((g) => NONCE_GROUPS.includes(g)), pages.join());
  });
});

// Links between CSP surfaces must be full page loads (a client-side <Link> navigation keeps the old document and its CSP).
const SURFACE = /href\s*=\s*(?:\{\s*)?["'`]\/(?:app|login|admin|account)(?:[/?#"'`]|$)/;
const linksToSurface = (src: string) => /from\s+["']next\/link["']/.test(stripComments(src)) && SURFACE.test(stripComments(src));

describe("navigation rule: marketing never client-links into /app, /login, /admin or /account", () => {
  const dirs = ["src/app/(marketing)", "src/components/landing", "src/components/contact", "src/components/site"].map((d) => path.join(ROOT, d));
  const files = dirs.flatMap(walk).filter((f) => /\.(tsx|ts|jsx|js)$/.test(f));

  it("scans real files (anti-vacuity)", () => assert.ok(files.length > 10, String(files.length)));
  it("no file imports next/link and links to a CSP surface", () => {
    assert.deepEqual(files.filter((f) => linksToSurface(fs.readFileSync(f, "utf8"))).map(rel), []);
  });
  it("control: the detector flags next/link to /app and /login, ignores plain <a> and comments", () => {
    assert.ok(linksToSurface('import Link from "next/link";\n<Link href="/app">x</Link>'));
    assert.ok(linksToSurface("import Link from 'next/link';\n<Link href='/login?next=/app'>x</Link>"));
    assert.ok(!linksToSurface('<a href="/app">x</a>'));
    assert.ok(!linksToSurface('// import Link from "next/link"\n<a href="/app">x</a>'));
    assert.ok(!linksToSurface('import Link from "next/link";\n<Link href="/about">x</Link>'));
  });
});
