/**
 * T1-02 (ADR-0009, api-v1 1.7): the in-process fixed-window limiter and the client-IP rule.
 * Pure logic, no database, always runs. The clock is injected with setClock().
 *
 *   npx tsx --test tests/backend/v1/rateLimit.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { clientIp, limit, setClock } from "@/lib/v1/rateLimit";

let now = 1_000_000;
let seq = 0;
const key = () => `t${++seq}`;
const WIN = 60_000;

beforeEach(() => {
  now = 1_000_000;
  setClock(() => now);
  delete process.env.TRUSTED_PROXY_HOPS;
});
afterEach(() => setClock());

describe("limit(): fixed window", () => {
  it("allows exactly `max` hits, then refuses, with remaining counting down", () => {
    const k = key();
    assert.deepEqual(
      [1, 2, 3].map(() => limit(k, 3, WIN)).map((r) => [r.ok, r.remaining, r.limit]),
      [[true, 2, 3], [true, 1, 3], [true, 0, 3]],
    );
    const over = limit(k, 3, WIN);
    assert.equal(over.ok, false);
    assert.equal(over.remaining, 0);
    assert.equal(limit(k, 3, WIN).ok, false, "stays refused");
  });

  it("keys are independent", () => {
    const [a, b] = [key(), key()];
    limit(a, 1, WIN);
    assert.equal(limit(a, 1, WIN).ok, false);
    assert.equal(limit(b, 1, WIN).ok, true);
  });

  it("the window is fixed: the last millisecond is still refused, the boundary starts a new window", () => {
    const k = key();
    limit(k, 1, WIN);
    assert.equal(limit(k, 1, WIN).ok, false);
    now += WIN - 1;
    assert.equal(limit(k, 1, WIN).ok, false, "1 ms before the window ends");
    now += 1;
    const fresh = limit(k, 1, WIN);
    assert.equal(fresh.ok, true, "exactly at the window end it resets");
    assert.equal(fresh.remaining, 0);
    assert.equal(limit(k, 1, WIN).ok, false);
  });

  it("refused hits do not extend the window", () => {
    const k = key();
    limit(k, 1, WIN);
    for (let i = 0; i < 5; i++) {
      now += 10_000;
      limit(k, 1, WIN);
    }
    now += 10_000; // 60 s after the first hit
    assert.equal(limit(k, 1, WIN).ok, true);
  });

  it("reset after a long gap", () => {
    const k = key();
    limit(k, 1, WIN);
    now += 10 * WIN;
    assert.equal(limit(k, 1, WIN).ok, true);
  });

  it("max 0 refuses everything", () => {
    assert.equal(limit(key(), 0, WIN).ok, false);
  });
});

describe("limit(): Retry-After seconds", () => {
  it("is the whole seconds to the end of the window, rounded up", () => {
    const k = key();
    assert.equal(limit(k, 1, WIN).retryAfterSec, 60);
    now += 500;
    assert.equal(limit(k, 1, WIN).retryAfterSec, 60); // 59.5 s left
    now += 500;
    assert.equal(limit(k, 1, WIN).retryAfterSec, 59);
    now += 30_000;
    assert.equal(limit(k, 1, WIN).retryAfterSec, 29);
    now += 28_001; // 999 ms left
    assert.equal(limit(k, 1, WIN).retryAfterSec, 1);
  });

  it("is never below 1, even with less than a second left", () => {
    const k = key();
    limit(k, 1, WIN);
    now += WIN - 1;
    assert.equal(limit(k, 1, WIN).retryAfterSec, 1);
  });

  it("follows the window length given", () => {
    assert.equal(limit(key(), 1, 3_600_000).retryAfterSec, 3600);
  });
});

describe("limit(): memory bound (ADR-0009 'expired windows are swept')", () => {
  it("a sweep (every 30 s) evicts expired keys, so they do not count against the cap", () => {
    const tag = key();
    // 30,000 long-lived keys, then 15,000 that expire after 1 s: 45,000, under the 50,000 cap.
    for (let i = 0; i < 30_000; i++) limit(`${tag}-live-${i}`, 1, 3_600_000);
    for (let i = 0; i < 15_000; i++) limit(`${tag}-short-${i}`, 1, 1_000);
    now += 31_000;
    // 20,000 new keys: 65,000 in total unless the expired 15,000 were swept.
    for (let i = 0; i < 20_000; i++) limit(`${tag}-new-${i}`, 1, 3_600_000);
    // If the sweep ran, nothing live was dropped; the oldest live key is still counted.
    assert.equal(limit(`${tag}-live-0`, 1, 3_600_000).ok, false, "a live key was evicted: the expired ones were not swept");
    assert.equal(limit(`${tag}-new-19999`, 1, 3_600_000).ok, false);
  });

  it("the 50,000-key cap holds: a flood of distinct keys drops the oldest, keeps the newest", () => {
    const tag = key();
    const N = 50_500;
    now += 7_200_000; // expire whatever earlier tests left in the shared map; the first call sweeps it
    for (let i = 0; i < N; i++) assert.equal(limit(`${tag}-${i}`, 1, 3_600_000).ok, true);
    // Probe newest first: probing re-inserts evicted keys and would itself evict others.
    assert.equal(limit(`${tag}-${N - 1}`, 1, 3_600_000).ok, false, "newest key must still be counted");
    assert.equal(limit(`${tag}-${N - 400}`, 1, 3_600_000).ok, false, "a key inside the newest 50,000 must be kept");
    assert.equal(limit(`${tag}-0`, 1, 3_600_000).ok, true, "oldest key must have been evicted to hold the cap");
  });
});

describe("clientIp(): X-Forwarded-For, Nth from the right", () => {
  const ip = (xff?: string) => clientIp(new Request("http://x/", xff === undefined ? {} : { headers: { "x-forwarded-for": xff } }));

  it("a single proxy-appended entry", () => {
    assert.equal(ip("203.0.113.9"), "203.0.113.9");
  });

  it("returns the rightmost entry, so a client-prepended spoof is ignored", () => {
    assert.equal(ip("6.6.6.6, 203.0.113.9"), "203.0.113.9");
    assert.equal(ip("6.6.6.6, 7.7.7.7, 8.8.8.8, 203.0.113.9"), "203.0.113.9");
    assert.equal(ip("6.6.6.6,203.0.113.9"), "203.0.113.9");
  });

  it("TRUSTED_PROXY_HOPS=2 takes the second from the right", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    assert.equal(ip("6.6.6.6, 198.51.100.1, 203.0.113.9"), "198.51.100.1");
  });

  it("more hops than entries gives unknown (never falls back to the spoofable left)", () => {
    process.env.TRUSTED_PROXY_HOPS = "3";
    assert.equal(ip("198.51.100.1, 203.0.113.9"), "unknown");
  });

  it("an unusable TRUSTED_PROXY_HOPS falls back to 1", () => {
    for (const v of ["", "abc", "0", "-2"]) {
      process.env.TRUSTED_PROXY_HOPS = v;
      assert.equal(ip("6.6.6.6, 203.0.113.9"), "203.0.113.9", `TRUSTED_PROXY_HOPS=${JSON.stringify(v)}`);
    }
  });

  it("IPv6 and surrounding whitespace", () => {
    assert.equal(ip("6.6.6.6,   2001:db8::1  "), "2001:db8::1");
  });

  it("missing header gives unknown", () => {
    assert.equal(ip(), "unknown");
    assert.equal(ip(""), "unknown");
    assert.equal(ip(" , ,"), "unknown");
  });

  it("garbage in the trusted slot gives unknown, even when an earlier entry is a valid IP", () => {
    assert.equal(ip("not-an-ip"), "unknown");
    assert.equal(ip("203.0.113.9, garbage"), "unknown");
    assert.equal(ip("203.0.113.9, 999.1.1.1"), "unknown");
    assert.equal(ip("203.0.113.9, 1.2.3.4:5678"), "unknown");
  });

  it("other forwarding headers are not trusted", () => {
    const r = new Request("http://x/", { headers: { "x-real-ip": "1.2.3.4", "cf-connecting-ip": "5.6.7.8", forwarded: "for=9.9.9.9" } });
    assert.equal(clientIp(r), "unknown");
  });
});
