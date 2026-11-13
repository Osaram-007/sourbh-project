/**
 * T0-04 (AH-7, WL-SEC-11, spec 7.3 last row): POST /api/sync is the machine route, authenticated by
 * the x-sync-secret header against SYNC_SECRET_KEY. Intended behaviour:
 *  - Anything but the exact secret is 401: header missing or empty, wrong secret of the same
 *    length, wrong length (shorter, longer, huge), different case, secret sent some other way.
 *  - SYNC_SECRET_KEY unset or empty means nobody is let in, whatever the header says (fail closed).
 *  - A refused request never starts a sync and never throws (a length mismatch must be a clean
 *    401, not a 500 from timingSafeEqual).
 *  - The comparison goes through crypto.timingSafeEqual with equal-length inputs.
 *  - A failure inside the handler returns a generic 500, never error.message.
 *
 * No database and no secrets needed; always runs. Run:
 *   npx tsx --test tests/backend/syncSecret.test.ts
 *
 * The right-secret case runs the real runSync(). Its DATABASE_URL points at a closed local port, so
 * the sync lock is refused and nothing is scraped or saved (same approach as syncSkipStatus.test.ts).
 * Backstops: net.Socket.connect is counted (a sync always starts by connecting for its lock) and
 * global fetch throws, so "a refused request started nothing" is checked, not assumed.
 */
import { describe, it, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import net from "node:net";
import { NextRequest } from "next/server";

// Before any app module loads (db.ts reads it at import); the app modules are imported in before().
process.env.DATABASE_URL = "postgresql://x:x@127.0.0.1:1/x";

const SECRET = "correct-horse-battery-staple";
const CANARY = "CANARY-sync-internal-detail-must-never-reach-a-client";

let route: typeof import("@/app/api/sync/route");
let fetchSpy: ReturnType<typeof mock.method>;
let tse: ReturnType<typeof mock.method>;
const connects = { count: 0 };

const call = (headers?: Record<string, string>, url = "http://localhost/api/sync") =>
  route.POST(new NextRequest(url, { method: "POST", headers }));

async function assertRefused(res: Response) {
  assert.equal(res.status, 401);
  const text = await res.text();
  assert.ok(!text.includes(SECRET), "the 401 body reveals the secret");
  assert.deepEqual(Object.keys(JSON.parse(text)), ["error"]);
  assert.equal(connects.count, 0, "a refused request started a sync (it tried to take the sync lock)");
  assert.equal(fetchSpy.mock.callCount(), 0, "a refused request used the network");
}

before(async () => {
  fetchSpy = mock.method(globalThis, "fetch", async () => {
    throw new Error("network access is forbidden in this test");
  });
  const realConnect = net.Socket.prototype.connect;
  mock.method(net.Socket.prototype, "connect", function (this: net.Socket, ...args: unknown[]) {
    connects.count++;
    return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  });
  tse = mock.method(crypto, "timingSafeEqual", crypto.timingSafeEqual); // pass-through spy
  mock.method(console, "error", () => {}); // the refused sync lock and the forced failure are logged on purpose
  mock.method(console, "log", () => {});
  route = await import("@/app/api/sync/route");
});
after(() => mock.restoreAll());
beforeEach(() => {
  process.env.SYNC_SECRET_KEY = SECRET;
  connects.count = 0;
  fetchSpy.mock.resetCalls();
  tse.mock.resetCalls();
});

describe("POST /api/sync with SYNC_SECRET_KEY set", () => {
  const refused: Array<[string, Record<string, string> | undefined]> = [
    ["no header at all", undefined],
    ["an empty header", { "x-sync-secret": "" }],
    ["a wrong secret of the same length (last char)", { "x-sync-secret": SECRET.slice(0, -1) + "X" }],
    ["a wrong secret of the same length (first char)", { "x-sync-secret": "X" + SECRET.slice(1) }],
    ["a wrong secret of the same length (nothing in common)", { "x-sync-secret": "z".repeat(SECRET.length) }],
    ["the secret in different case", { "x-sync-secret": SECRET.toUpperCase() }],
    ["a prefix of the secret (shorter)", { "x-sync-secret": SECRET.slice(0, -1) }],
    ["one character", { "x-sync-secret": "c" }],
    ["the secret plus a character (longer)", { "x-sync-secret": SECRET + "x" }],
    ["a huge value", { "x-sync-secret": "a".repeat(100_000) }],
    ["the secret under another header name", { "x-sync-key": SECRET }],
    ["the secret as a Bearer token", { authorization: `Bearer ${SECRET}` }],
    ["the secret as a cookie", { cookie: `x-sync-secret=${SECRET}` }],
  ];
  for (const [label, headers] of refused) {
    it(`401 for ${label}`, async () => {
      await assertRefused(await call(headers));
    });
  }

  it("401 when the secret is only in the query string", async () => {
    await assertRefused(await call(undefined, `http://localhost/api/sync?x-sync-secret=${SECRET}&secret=${SECRET}`));
  });

  it("a wrong length is a clean 401, not a 500 (timingSafeEqual throws on unequal lengths if fed raw)", async () => {
    for (const len of [0, 1, SECRET.length - 1, SECRET.length + 1, 4096]) {
      const res = await call({ "x-sync-secret": "k".repeat(len) });
      assert.equal(res.status, 401, `length ${len}`);
    }
  });

  it("the right secret passes: it is not refused and the sync is actually started", async () => {
    const res = await call({ "x-sync-secret": SECRET });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok("result" in body);
    assert.ok(connects.count >= 1, "the sync never started (no attempt to take its lock)");
    assert.equal(fetchSpy.mock.callCount(), 0, "no scraper may run in this test");
  });

  it("the header name is case-insensitive", async () => {
    const res = await call({ "X-Sync-Secret": SECRET });
    assert.equal(res.status, 200);
  });

  it("a refused call does not poison the next one: the right secret still passes afterwards", async () => {
    assert.equal((await call({ "x-sync-secret": "nope" })).status, 401);
    assert.equal((await call({ "x-sync-secret": SECRET })).status, 200);
  });
});

describe("POST /api/sync with SYNC_SECRET_KEY unset or empty fails closed", () => {
  const headers: Array<[string, Record<string, string> | undefined]> = [
    ["no header", undefined],
    ["an empty header", { "x-sync-secret": "" }],
    ["the header 'undefined'", { "x-sync-secret": "undefined" }],
    ["the header 'null'", { "x-sync-secret": "null" }],
    ["an arbitrary header", { "x-sync-secret": SECRET }],
  ];
  for (const [label, h] of headers) {
    it(`unset: 401 for ${label}`, async () => {
      delete process.env.SYNC_SECRET_KEY;
      await assertRefused(await call(h));
    });
    it(`empty string: 401 for ${label}`, async () => {
      process.env.SYNC_SECRET_KEY = "";
      await assertRefused(await call(h));
    });
  }
});

describe("constant-time comparison (WL-SEC-11)", () => {
  const inputs: Array<[string, string]> = [
    ["the right secret", SECRET],
    ["a wrong secret of the same length", SECRET.slice(0, -1) + "X"],
    ["a shorter value", "short"],
    ["a longer value", SECRET + "-and-more"],
    ["a huge value", "a".repeat(100_000)],
  ];
  for (const [label, value] of inputs) {
    it(`compares ${label} with crypto.timingSafeEqual on equal-length buffers`, async () => {
      await call({ "x-sync-secret": value });
      assert.ok(tse.mock.callCount() >= 1, "the secret was not compared with timingSafeEqual");
      for (const c of tse.mock.calls) {
        const [a, b] = c.arguments as unknown as [Uint8Array, Uint8Array];
        assert.equal(a.byteLength, b.byteLength, "inputs must have equal length, or length leaks");
        assert.equal(c.error, undefined, "timingSafeEqual threw");
      }
    });
  }
});

describe("failures", () => {
  it("a failure inside the handler returns a generic 500 and never the error message", async () => {
    const exploding = {
      headers: {
        get() {
          throw new Error(CANARY);
        },
      },
    } as unknown as NextRequest;

    const res = await route.POST(exploding);

    assert.equal(res.status, 500);
    const text = await res.text();
    assert.ok(!text.includes(CANARY), `error detail reached the client: ${text}`);
    assert.deepEqual(Object.keys(JSON.parse(text)), ["error"]);
  });
});
