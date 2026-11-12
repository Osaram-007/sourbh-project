import { gzipSync } from "node:zlib";
import type { Browser, Response } from "playwright";
import { openPage } from "./helpers/browser";

// Shared by routes.e2e.ts and routes-indexable.e2e.ts (WEB-A02). Not an *.e2e.ts file, so the runner skips it.

/** The server-rendered document, i.e. what a crawler sees (no JS run). */
export async function fetchDoc(baseUrl: string, path: string, headers?: Record<string, string>) {
  const res = await fetch(baseUrl + path, { headers, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  const html = await res.text();
  return { res, status: res.status, html, meta: parseHead(html) };
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1].toLowerCase()] = m[2];
  return out;
}

/** Just enough HTML parsing for Next's head output: <html lang>, <title> and <meta name|property content>. */
export function parseHead(html: string) {
  const metas = [...html.matchAll(/<meta\s[^>]*>/g)]
    .map((m) => attrs(m[0]))
    .filter((a) => (a.name || a.property) && a.content !== undefined)
    .map((a) => ({ key: (a.name || a.property).toLowerCase(), content: a.content }));
  const get = (key: string) => metas.filter((m) => m.key === key).map((m) => m.content);
  return {
    lang: /<html\s[^>]*\blang="([^"]*)"/.exec(html)?.[1] ?? null,
    title: /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null,
    metas,
    /** content of every <meta name="robots">, in document order */
    robots: get("robots"),
    description: get("description"),
  };
}

export interface Script {
  url: string;
  text: string;
  gzipBytes: number;
}

export interface Loaded {
  status: number;
  /** every URL the browser requested, including aborted off-origin ones */
  requests: string[];
  /** every JS file the browser actually fetched, from the network (so no noModule polyfill in Chromium) */
  scripts: Script[];
  /** src of every <script noModule> in the document */
  noModuleSrcs: string[];
  /** the document body as the server sent it */
  html: string;
}

/**
 * Open `path` in headless Chromium and record the JS it really fetches until the network is idle.
 * Off-origin requests are aborted (the test never calls Google, even with the dummy key) but still listed
 * in `requests`, so "this page contacts Google Maps" stays observable.
 * By default Link prefetching runs as it does for a visitor; `blockPrefetch` isolates the page's own first load.
 */
export async function loadPage(
  browser: Browser,
  baseUrl: string,
  path: string,
  opts: { blockPrefetch?: boolean } = {},
): Promise<Loaded> {
  const origin = new URL(baseUrl).origin;
  const { page, close } = await openPage(browser, "desktop");
  try {
    const requests: string[] = [];
    const jsResponses: Response[] = [];
    await page.route(
      (u) => u.protocol.startsWith("http") && u.origin !== origin,
      (r) => r.abort(),
    );
    // Next's <Link> prefetch (`?_rsc=` fetches after load) makes it download the *target* route's chunks.
    // blockPrefetch drops those, leaving only the JS the page itself needs.
    if (opts.blockPrefetch) await page.route((u) => u.searchParams.has("_rsc"), (r) => r.abort());
    page.on("request", (r) => requests.push(r.url()));
    page.on("response", (r) => {
      if (r.request().resourceType() === "script" || /\.js(\?|$)/.test(r.url())) jsResponses.push(r);
    });

    const nav = await page.goto(baseUrl + path, { waitUntil: "load" });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }); // lazy chunks (next/dynamic) land after load
    const html = await nav!.text();
    const noModuleSrcs = await page.evaluate(() =>
      [...document.querySelectorAll("script")].filter((s) => s.noModule).map((s) => s.src),
    );

    const scripts: Script[] = [];
    for (const r of jsResponses) {
      if (!r.ok()) continue;
      const body = await r.body();
      scripts.push({ url: r.url(), text: body.toString("utf8"), gzipBytes: gzipSync(body).length });
    }
    return { status: nav!.status(), requests, scripts, noModuleSrcs, html };
  } finally {
    await close();
  }
}

/**
 * One distinctive string per forbidden dependency, taken from the minified production chunks.
 * They are only trusted because routes.e2e.ts first finds every one of them in the /app bundle (positive control).
 * Zustand has no string literal of its own, so its marker is an action name from src/store/useStore.ts.
 */
export const MARKERS: Record<string, string> = {
  "NextAuth (next-auth/react)": "CLIENT_FETCH_ERROR",
  "React Query": "No QueryClient set",
  "Zustand store (src/store/useStore.ts)": "setMapCenter",
  "Google Maps loader": "maps.googleapis.com",
  vaul: "data-vaul-drawer",
};

/** WL-LAND-5 banned phrases; applied to metadata here (WL-SEO-5). Case-insensitive, hyphen/space/none equivalent. */
export const BANNED_COPY: RegExp[] = [
  /real[\s\u00ad\u2010-\u2015-]?time/i,
  /reliab/i,
  /trip planner/i,
  /plan a trip/i,
  /highway/i,
  /guarantee/i,
  /100\s?%|100 percent/i,
  /\ball major/i,
];
