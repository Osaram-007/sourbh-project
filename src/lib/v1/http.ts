import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { clientIp, limit } from "@/lib/v1/rateLimit";

// Handler wrapper for every /api/v1 route (docs/api-v1.md section 1):
//
//   export const GET = route({ auth: "none" }, async ({ req, params, user, body }) => NextResponse.json(...));
//
// Order: IP rate limit, CSRF, auth, user rate limits, body read, handler. Any throw becomes a generic 500.

export type AuthMode = "none" | "user" | "admin";
export type V1User = { id: string; email: string | null };

const MAX_BODY = 16 * 1024;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const MESSAGES: Record<string, string> = {
  validation_failed: "The request is not valid.",
  auth_missing: "Sign in required.",
  forbidden: "Not allowed.",
  payload_too_large: "Request body is too large.",
  unsupported_media_type: "Content-Type must be application/json.",
  rate_limited: "Too many requests.",
  internal: "Something went wrong.",
};

/** Standard error envelope. `message` is always a fixed string, never derived from an error. */
export function fail(status: number, code: string, details?: Record<string, unknown>, headers?: HeadersInit): NextResponse {
  return NextResponse.json(
    { error: { code, message: MESSAGES[code] ?? MESSAGES.internal, ...(details ? { details } : {}) } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

type Parsed<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

function check<T>(schema: ZodType<T>, input: unknown, status: number): Parsed<T> {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const fields: Record<string, string> = {};
  for (const i of r.error.issues) fields[i.path.join(".") || "_"] ??= i.message;
  return { ok: false, response: fail(status, "validation_failed", { fields }) };
}

/** Validate query/path input: 400 on failure. Pass `Object.fromEntries(req.nextUrl.searchParams)` or `params`. */
export const parseQuery = <T>(schema: ZodType<T>, input: unknown) => check(schema, input, 400);

/** Validate a parsed JSON body: 422 on failure (api-v1 1.3). */
export const parseBody = <T>(schema: ZodType<T>, input: unknown) => check(schema, input, 422);

function csrfOk(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  const origin = req.headers.get("origin");
  let app: string;
  try {
    app = new URL(process.env.APP_ORIGIN ?? "").origin;
  } catch {
    return false; // APP_ORIGIN unset or invalid: fail closed
  }
  return origin !== null && origin === app;
}

/** Read the body up to MAX_BODY bytes. Returns null when the cap is exceeded. */
async function readCapped(req: NextRequest): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length"));
  if (declared > MAX_BODY) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const num = (name: string, dflt: number) => Number(process.env[name]) || dflt;

export type RouteCtx<A extends AuthMode, P> = {
  req: NextRequest;
  params: P;
  user: A extends "none" ? null : V1User;
  /** Parsed JSON body of a mutating request; undefined when the request has no body. Validate with parseBody. */
  body: unknown;
};

export function route<A extends AuthMode, P = Record<string, never>>(
  opts: { auth: A },
  handler: (ctx: RouteCtx<A, P>) => Promise<Response> | Response,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      const retry = (r: { retryAfterSec: number }) => fail(429, "rate_limited", undefined, { "Retry-After": String(r.retryAfterSec) });
      const mutating = MUTATING.has(req.method);

      const ipHit = limit(`ip:${clientIp(req)}`, num("RATE_LIMIT_IP_PER_MIN", 120), 60_000);
      if (!ipHit.ok) return retry(ipHit);

      // Exempt only a Bearer request with no cookie on a user/admin route (no ambient credential).
      const bearer = /^Bearer\s+\S/i.test(req.headers.get("authorization") ?? "");
      const exempt = opts.auth !== "none" && bearer && !req.headers.has("cookie");
      if (mutating && !exempt && !csrfOk(req)) return fail(403, "forbidden");

      let user: V1User | null = null;
      if (opts.auth !== "none") {
        const g = opts.auth === "admin" ? await requireAdmin() : await requireUser();
        if (!g.ok) return g.response.status === 403 ? fail(403, "forbidden") : fail(401, "auth_missing");
        user = g.user;
        const u = limit(`user:${user.id}`, num("RATE_LIMIT_USER_PER_MIN", 120), 60_000);
        if (!u.ok) return retry(u);
        if (mutating) {
          const w = limit(`userw:${user.id}`, num("RATE_LIMIT_USER_WRITE_PER_MIN", 20), 60_000);
          if (!w.ok) return retry(w);
        }
      }

      let body: unknown;
      if (mutating) {
        const raw = await readCapped(req);
        if (raw === null) return fail(413, "payload_too_large");
        if (raw.byteLength > 0) {
          if (!/^application\/json\s*(;|$)/i.test(req.headers.get("content-type") ?? "")) return fail(415, "unsupported_media_type");
          try {
            body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
          } catch {
            return fail(400, "validation_failed");
          }
        }
      }

      return await handler({ req, params: (await ctx?.params) as P, user: user as RouteCtx<A, P>["user"], body });
    } catch (err) {
      console.error("[v1] unhandled error", req.method, req.nextUrl.pathname, err);
      return fail(500, "internal");
    }
  };
}
