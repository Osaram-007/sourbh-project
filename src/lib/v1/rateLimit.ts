import { isIP } from "node:net";

// In-process fixed-window limiter (ADR-0009). One Node process = one counter set, so limits are
// per instance and reset on restart. ponytail: move to Redis (already a dependency) if the web tier
// ever runs more than one instance.

export type LimitResult = { ok: boolean; retryAfterSec: number };

const MAX_KEYS = 50_000;
const LOW_WATER = MAX_KEYS * 0.9;
const SWEEP_EVERY_MS = 30_000;
const windows = new Map<string, { count: number; resetAt: number }>();
let lastSweep = 0;
let clock = () => Date.now();
/** ADR-0009: tests inject the clock. Pass nothing to restore the real one. */
export function setClock(fn?: () => number) {
  clock = fn ?? (() => Date.now());
  lastSweep = 0;
}
/** Number of windows held (tests check the memory bound). */
export const windowCount = () => windows.size;

function sweep(now: number) {
  const full = windows.size > MAX_KEYS;
  lastSweep = now;
  for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  // Over the cap (a flood of distinct keys inside one window): drop the oldest windows down to 90% of
  // the cap, so the next 5,000 new keys do not each pay for another full pass.
  if (full) {
    for (const k of windows.keys()) {
      if (windows.size <= LOW_WATER) break;
      windows.delete(k);
    }
  }
}

/** Count one hit against `key`; `max` hits are allowed per `windowMs`. */
export function limit(key: string, max: number, windowMs: number): LimitResult {
  const now = clock();
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.delete(key); // re-insert, so eviction order follows window age, not first sight of the key
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count += 1;
  if (now - lastSweep >= SWEEP_EVERY_MS || windows.size > MAX_KEYS) sweep(now);
  return { ok: w.count <= max, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
}

/**
 * Rate-limit key for the client address. A Next route handler has no socket address, so this is the
 * RIGHTMOST X-Forwarded-For entry. There is no CDN (ADR-0018/0021), and Caddy (2.5+, no
 * `trusted_proxies`, ADR-0009) replaces any client-sent X-Forwarded-For with the address it saw.
 * Safe ONLY while Next listens on 127.0.0.1 behind Caddy: Next fills X-Forwarded-For only when it is
 * absent, so a client that reaches Next directly chooses its own IP.
 * IPv6 is keyed by its /64, because one host usually holds a whole /64. A missing or invalid entry
 * gives the shared "unknown" bucket.
 */
export function clientIp(req: Request): string {
  const parts = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  let ip = parts.at(-1);
  if (!ip || !isIP(ip)) return "unknown";
  ip = ip.replace(/%.*/, ""); // isIP accepts a zone id ("fe80::1%eth0", even "%a.b"); it is not part of the address
  if (isIP(ip) === 4 || ip.includes(".")) return ip; // IPv4, or IPv4-mapped IPv6
  const [h, t = ""] = ip.split("::");
  const head = h ? h.split(":") : [];
  const tail = t ? t.split(":") : [];
  const g = [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
  return `${g.slice(0, 4).map((x) => parseInt(x, 16).toString(16)).join(":")}::/64`;
}
