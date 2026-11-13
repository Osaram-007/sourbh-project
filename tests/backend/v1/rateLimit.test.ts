/**
 * T1-02 (ADR-0009, api-v1 1.7): the in-process fixed-window limiter and the client-IP rule.
 * Pure logic, no database, always runs. The clock is injected with setClock().
 *
 *   npx tsx --test tests/backend/v1/rateLimit.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { clientIp, limit, setClock, windowCount } from "@/lib/v1/rateLimit";

let now = 1_000_000;
let seq = 0;
const key = () => `t${++seq}`;
const WIN = 60_000;

beforeEach(() => {
  now = 1_000_000;
  setClock(() => now);
});
afterEach(() => setClock());

describe("limit(): fixed window", () => {
  it("allows exactly `max` hits, then refuses", () => {
    const k = key();
    assert.deepEqual([1, 2, 3].map(() => limit(k, 3, WIN).ok), [true, true, true]);
    assert.equal(limit(k, 3, WIN).ok, false);
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
    assert.equal(limit(k, 1, WIN).ok, true, "exactly at the window end it resets");
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
    // 15,000 new keys: 60,000 in total unless the expired 15,000 were swept. (Not 20,000: windows
    // left by earlier tests are still live here, and exactly 50,000 would leave them no room.)
    for (let i = 0; i < 15_000; i++) limit(`${tag}-new-${i}`, 1, 3_600_000);
    // If the sweep ran, nothing live was dropped; the oldest live key is still counted.
    assert.equal(limit(`${tag}-live-0`, 1, 3_600_000).ok, false, "a live key was evicted: the expired ones were not swept");
    assert.equal(limit(`${tag}-new-14999`, 1, 3_600_000).ok, false);
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

  it("past the cap, eviction goes down to 90% of it (not to just under it); a renewed window counts as new", () => {
    const tag = key();
    now += 1_000 * 3_600_000; // past every window earlier tests left; the first call sweeps them
    limit(`${tag}-renewed`, 1, 1_000);
    for (let i = 0; i < 10_000; i++) limit(`${tag}-a-${i}`, 1, 3_600_000);
    now += 2_000; // `renewed` has expired; under 30 s, so no periodic sweep removed it
    limit(`${tag}-renewed`, 1, 3_600_000); // a new window: it now ranks with the newest keys
    for (let i = 0; i < 40_000; i++) limit(`${tag}-b-${i}`, 1, 3_600_000);
    // 50,001 keys at the last call: one cap sweep, which must stop at 45,000.
    assert.ok(windowCount() <= 45_000, `${windowCount()} windows after a flood past the 50,000 cap`);
    assert.equal(limit(`${tag}-renewed`, 1, 3_600_000).ok, false, "a renewed window was evicted by its first-insertion order");
  });
});

describe("clientIp(): the rightmost X-Forwarded-For entry", () => {
  const ip = (xff?: string) => clientIp(new Request("http://x/", xff === undefined ? {} : { headers: { "x-forwarded-for": xff } }));

  it("a single proxy-set entry", () => {
    assert.equal(ip("203.0.113.9"), "203.0.113.9");
  });

  it("returns the rightmost entry, so a client-prepended spoof is ignored", () => {
    assert.equal(ip("6.6.6.6, 203.0.113.9"), "203.0.113.9");
    assert.equal(ip("6.6.6.6, 7.7.7.7, 8.8.8.8, 203.0.113.9"), "203.0.113.9");
    assert.equal(ip("6.6.6.6,203.0.113.9"), "203.0.113.9");
  });

  it("IPv6 is keyed by its /64: one /64 is one key, whatever the spelling", () => {
    const key64 = "2001:db8:1:2::/64";
    for (const a of ["2001:db8:1:2::1", "2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:0DB8:0001:0002:0000:0000:0000:0001", "6.6.6.6,   2001:db8:1:2::9  "]) {
      assert.equal(ip(a), key64, a);
    }
    assert.notEqual(ip("2001:db8:1:3::1"), key64, "another /64 is another key");
    assert.equal(ip("::1"), "0:0:0:0::/64");
    assert.equal(ip("1::"), "1:0:0:0::/64");
  });

  it("an IPv6 zone id is dropped, so it cannot mint keys (isIP accepts one, even with a dot or ::)", () => {
    for (const a of ["fe80::1%eth0", "fe80::2%a.b", "fe80::3%a::b"]) assert.equal(ip(a), "fe80:0:0:0::/64", a);
  });

  it("IPv4 and IPv4-mapped IPv6 are kept as they are", () => {
    assert.equal(ip("::ffff:1.2.3.4"), "::ffff:1.2.3.4");
  });

  it("missing header gives unknown", () => {
    assert.equal(ip(), "unknown");
    assert.equal(ip(""), "unknown");
    assert.equal(ip(" , ,"), "unknown");
  });

  it("garbage in the rightmost slot gives unknown, even when an earlier entry is a valid IP", () => {
    assert.equal(ip("not-an-ip"), "unknown");
    assert.equal(ip("203.0.113.9, garbage"), "unknown");
    assert.equal(ip("203.0.113.9, 999.1.1.1"), "unknown");
    assert.equal(ip("203.0.113.9, 1.2.3.4:5678"), "unknown");
    assert.equal(ip("1.2.3.4%eth0"), "unknown");
    assert.equal(ip("2001:db8::1::2"), "unknown");
  });

  it("other forwarding headers are not trusted", () => {
    const r = new Request("http://x/", { headers: { "x-real-ip": "1.2.3.4", "cf-connecting-ip": "5.6.7.8", forwarded: "for=9.9.9.9" } });
    assert.equal(clientIp(r), "unknown");
  });
});
