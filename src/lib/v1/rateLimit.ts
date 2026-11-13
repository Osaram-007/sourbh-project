import { isIP } from "node:net";

// In-process fixed-window limiter (ADR-0009). One Node process = one counter set, so limits are
// per instance and reset on restart. ponytail: move to Redis (already a dependency) if the web tier
// ever runs more than one instance.

export type LimitResult = { ok: boolean; limit: number; remaining: number; retryAfterSec: number };

const MAX_KEYS = 50_000;
const SWEEP_EVERY_MS = 30_000;
const windows = new Map<string, { count: number; resetAt: number }>();
let lastSweep = 0;

function sweep(now: number) {
  lastSweep = now;
  for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  // Still over the cap (a flood of distinct keys inside one window): drop the oldest-inserted keys.
  for (const k of windows.keys()) {
    if (windows.size <= MAX_KEYS) break;
    windows.delete(k);
  }
}

/** Count one hit against `key`; `max` hits are allowed per `windowMs`. */
export function limit(key: string, max: number, windowMs: number): LimitResult {
  const now = Date.now();
  if (now - lastSweep >= SWEEP_EVERY_MS || windows.size > MAX_KEYS) sweep(now);

  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count += 1;
  return {
    ok: w.count <= max,
    limit: max,
    remaining: Math.max(0, max - w.count),
    retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
  };
}

/**
 * Client IP. A Next route handler has no socket address, so it comes from X-Forwarded-For as set by
 * our own reverse proxy: the entry `TRUSTED_PROXY_HOPS` (default 1) places from the RIGHT, which is
 * the address that proxy actually saw. Anything a client prepends to the header sits to the left and
 * is ignored. If the header is missing or not an IP, everything shares the "unknown" bucket.
 * Set TRUSTED_PROXY_HOPS=2 behind two proxies (e.g. CDN + nginx).
 */
export function clientIp(req: Request): string {
  const hops = Math.max(1, Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10) || 1);
  const parts = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = parts[parts.length - hops];
  return ip && isIP(ip) ? ip : "unknown";
}
