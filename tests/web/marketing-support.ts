import fs from "node:fs";
import path from "node:path";

// Shared by marketing.test.ts and marketing.e2e.ts (WEB-B05). Not a *.test.ts or *.e2e.ts file, so the runner skips it.

/**
 * Every marketing and legal route, derived from the filesystem: each page.tsx under `<appDir>/(marketing)`.
 * Route groups "(x)" are not part of the URL. A new page is picked up with no edit here.
 * Dynamic segments ("[id]") are returned as written so the caller can see them (there are none today).
 */
export function discoverRoutes(appDir: string): string[] {
  const root = path.join(appDir, "(marketing)");
  const out: string[] = [];
  const walk = (dir: string, segs: string[]) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), /^\(.+\)$/.test(e.name) || e.name.startsWith("_") ? segs : [...segs, e.name]);
      else if (/^page\.(tsx|ts|jsx|js|mdx)$/.test(e.name)) out.push("/" + segs.join("/"));
    }
  };
  walk(root, []);
  return [...new Set(out)].sort();
}

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;
/** Next file-convention files that produce an icon, share image or manifest. */
export const CONVENTION = /(^|\/)(icon|apple-icon|opengraph-image|twitter-image|favicon|manifest)(\d*)\.[a-z]+$/i;

/** Repo-relative, forward-slash paths of every file the asset register must cover. */
export function listAssetFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(root, p).split(path.sep).join("/"));
    }
  };
  walk(path.join(root, "public")); // every file under public/, whatever it is
  const src: string[] = [];
  const walkSrc = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walkSrc(p);
      else src.push(path.relative(root, p).split(path.sep).join("/"));
    }
  };
  walkSrc(path.join(root, "src"));
  for (const f of src) if (f.startsWith("src/app/") ? CONVENTION.test(f) || IMAGE_EXT.test(f) : IMAGE_EXT.test(f)) out.push(f);
  return out;
}

export interface RegisterRow {
  location: string;
  origin: string;
  owner: string;
  licence: string;
  date: string;
}

/** Rows of the markdown table in asset-register.md, columns found by header name (Location, Origin, Owner, Licence, Date). */
export function parseRegister(md: string): RegisterRow[] {
  const rows: RegisterRow[] = [];
  let col: Record<string, number> | null = null;
  for (const line of md.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const c = line.split("|").slice(1, -1).map((x) => x.trim());
    if (c.includes("Location")) {
      col = Object.fromEntries(c.map((h, i) => [h.toLowerCase(), i]));
      continue;
    }
    if (!col || /^:?-+:?$/.test(c[0])) continue;
    const get = (k: string) => (col![k] === undefined ? "" : (c[col![k]] ?? ""));
    rows.push({ location: get("location"), origin: get("origin"), owner: get("owner"), licence: get("licence"), date: get("date") });
  }
  return rows;
}

/** A path is registered when some row's Location names it as a whole path: not a prefix ("logo.svg.bak") or suffix of another. */
const names = (location: string, file: string) =>
  new RegExp(`(^|[^\\w./-])${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-]|\\.\\w)`).test(location);

const PLACEHOLDER = /^(-|tbd|\?|unknown|n\/a)$/i;

/** Why a row is incomplete, or "" when it is fine. Origin, Owner, Licence and Date are all required. */
export function rowProblem(r: RegisterRow): string {
  for (const k of ["origin", "owner", "licence", "date"] as const) {
    if (!r[k] || PLACEHOLDER.test(r[k])) return `empty or placeholder ${k}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return `date "${r.date}" is not YYYY-MM-DD`;
  return "";
}

/** Problems found: one string per file that has no complete row. Empty means every file is covered. */
export function registerProblems(files: string[], rows: RegisterRow[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const hits = rows.filter((r) => names(r.location, f));
    if (!hits.length) out.push(`${f}: no row in docs/asset-register.md names it in the Location column`);
    else if (!hits.some((r) => !rowProblem(r))) out.push(`${f}: its row is incomplete (${rowProblem(hits[0])})`);
  }
  return out;
}


const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

/**
 * What a visitor can read: scripts, styles and comments dropped, tags removed, entities decoded.
 * React puts <!-- --> between adjacent text nodes, so comments become "" (not a space) or "100<!-- -->%" would read "100 %".
 * `inline` also drops tags to "" so "<b>100</b>%" reads "100%"; scan both versions.
 */
export const visibleText = (html: string, inline = false) =>
  decode(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<head\b[\s\S]*?<\/head>/i, " ")
      .replace(/<[^>]+>/g, inline ? "" : " "),
  )
    .replace(/\s+/g, " ")
    .trim();

/** Text values of alt, title, placeholder and aria-label attributes, plus application/ld+json bodies. */
export function attributeAndJsonLdText(html: string): string[] {
  const out = [...html.matchAll(/\s(?:alt|title|placeholder|aria-label)="([^"]*)"/gi)].map((m) => decode(m[1]));
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) out.push(decode(m[1]));
  return out.filter(Boolean);
}

/** Strip // and block comments so source scans only see what ships. Naive (a "//" inside a string is cut): fine for these files. */
export const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
