/**
 * T1-03: a small NextRequest builder. Defaults pass the T1-02 CSRF check (Sec-Fetch-Site: same-origin
 * and Origin = TEST_APP_ORIGIN). Importing this sets APP_ORIGIN to TEST_APP_ORIGIN unconditionally
 * (each test file runs in its own process, so it cannot leak).
 */
import { NextRequest } from "next/server";

export const TEST_APP_ORIGIN = "https://app.example.com";
process.env.APP_ORIGIN = TEST_APP_ORIGIN;

export interface RequestOpts {
  method?: string;
  /** Path plus optional query, e.g. "/api/v1/stations?limit=5". */
  path?: string;
  /** Serialised as JSON (content-type set) unless it is a string. */
  body?: unknown;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  /** Sent as X-Forwarded-For. Default: a fresh address per request, so rate-limit buckets do not collide. */
  ip?: string;
  /** Pass false to omit Sec-Fetch-Site/Origin entirely, or a Sec-Fetch-Site value such as "cross-site". */
  secFetchSite?: string | false;
}

let ipSeq = 0;
const nextIp = () => `10.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

export function makeRequest(o: RequestOpts = {}): NextRequest {
  const headers: Record<string, string> = { "x-forwarded-for": o.ip ?? nextIp() };
  if (o.secFetchSite !== false) {
    headers["sec-fetch-site"] = o.secFetchSite ?? "same-origin";
    headers["origin"] = TEST_APP_ORIGIN;
  }
  if (o.cookies && Object.keys(o.cookies).length) {
    headers["cookie"] = Object.entries(o.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  }
  let body: string | undefined;
  if (o.body !== undefined) {
    body = typeof o.body === "string" ? o.body : JSON.stringify(o.body);
    if (typeof o.body !== "string") headers["content-type"] = "application/json";
  }
  for (const [k, v] of Object.entries(o.headers ?? {})) headers[k.toLowerCase()] = v;
  return new NextRequest(new URL(o.path ?? "/", TEST_APP_ORIGIN), { method: o.method ?? "GET", headers, body });
}

/** Second argument for a route handler: `handler(req, routeCtx({ id: "s1" }))`. */
export const routeCtx = <P extends object = Record<string, never>>(params = {} as P) => ({
  params: Promise.resolve(params),
});
