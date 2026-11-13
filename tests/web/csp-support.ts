// Shared by csp.e2e.ts and csp-enforce.e2e.ts (WEB-S05). Not a *.e2e.ts file, so the runner skips it.

export const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(self), camera=(), microphone=(), payment=()",
  "x-frame-options": "DENY",
};
export const REPORT_ONLY = "content-security-policy-report-only";
export const ENFORCING = "content-security-policy";

/** One path per route class: marketing, legal, metadata (text + generated image), the 404, and the proxy surfaces. */
export const HEADER_PATHS = ["/", "/about", "/legal/privacy", "/robots.txt", "/icon", "/__csp/unknown", "/app", "/login"];
/** Paths the static policy must NOT cover (the proxy owns them). */
export const PROXY_PATHS = ["/app", "/app/anything", "/login", "/admin", "/admin/analytics", "/account"];
export const STATIC_PATHS = ["/", "/about", "/legal/privacy", "/robots.txt", "/sitemap.xml", "/icon", "/__csp/unknown"];

export async function get(base: string, path: string, headers: Record<string, string> = {}) {
  return fetch(base + path, { redirect: "manual", headers });
}

/** The policy as a directive -> sources map. */
export function parseCsp(v: string | null): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const part of (v ?? "").split(";")) {
    const [name, ...src] = part.trim().split(/\s+/);
    if (name) m.set(name, src);
  }
  return m;
}

export const nonceOf = (csp: string | null) => /'nonce-([^']+)'/.exec(csp ?? "")?.[1];
