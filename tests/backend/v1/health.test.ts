/**
 * T1-02 (api-v1 3.7, 1.9, ADR-0008 amendment 'GET /health 503'): GET /api/v1/health.
 *
 *   npx tsx --test tests/backend/v1/health.test.ts
 *
 * Database: a fake Prisma client, the same precedent as the T0-04 route tests (ADR-0011 prefers a
 * real test DB, but Docker is not available here and this route only needs `SELECT 1` to succeed,
 * fail or hang). src/lib/db.ts reuses globalThis.prisma when set. fakeDb.ts (T0-04) cannot be
 * reused: it models `db.<model>.<method>()` and not the tagged-template `db.$queryRaw`. What this
 * leaves unproven: a real Postgres connection failure's error text. The tests use a driver-style
 * message carrying a host and a password as the canary instead.
 *
 * The 2 s timeout is driven with node:test's mock timers, so the test does not wait.
 */
import { describe, it, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

process.env.DATABASE_URL = "postgresql://x:x@127.0.0.1:1/x";
const LEAK = "connect ECONNREFUSED db.internal.example:5432 password=hunter2-CANARY";

let impl: (strings: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> = async () => [{ "?column?": 1 }];
const queryRaw = mock.fn((strings: TemplateStringsArray, ...v: unknown[]) => impl(strings, ...v));
(globalThis as unknown as { prisma: object }).prisma = { $queryRaw: queryRaw };

let health: typeof import("@/app/api/v1/health/route");
const version = (JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8")) as { version: string }).version;

let n = 0;
const get = (ip = `10.2.0.${++n % 250}`) =>
  health.GET(new NextRequest("http://localhost/api/v1/health", { headers: { "x-forwarded-for": ip } }), { params: Promise.resolve({}) });

before(async () => {
  mock.method(console, "error", () => {});
  health = await import("@/app/api/v1/health/route");
});
after(() => mock.restoreAll());
beforeEach(() => {
  queryRaw.mock.resetCalls();
  impl = async () => [{ "?column?": 1 }];
  delete process.env.RATE_LIMIT_IP_PER_MIN;
});

const DEGRADED = { status: "degraded", db: "down", version };

async function assertDegraded(res: Response) {
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), DEGRADED, "exactly status, db and version");
  for (const s of [LEAK, "ECONNREFUSED", "db.internal", "hunter2", "5432", "127.0.0.1", "timeout", "Error"]) {
    assert.ok(!text.includes(s), `the 503 body leaks ${JSON.stringify(s)}: ${text}`);
  }
}

describe("GET /api/v1/health", () => {
  it("is 200 { status: ok, db: ok, version } with the package version", async () => {
    const res = await get();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok", db: "ok", version });
    assert.match(version, /^\d+\.\d+\.\d+/);
  });

  it("is no-store and JSON on success", async () => {
    const res = await get();
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  });

  it("checks the database with SELECT 1, once", async () => {
    await get();
    assert.equal(queryRaw.mock.callCount(), 1);
    assert.match(queryRaw.mock.calls[0].arguments[0].join(""), /^\s*SELECT 1\s*$/i);
  });

  it("needs no credential and ignores one", async () => {
    const res = await health.GET(
      new NextRequest("http://localhost/api/v1/health", { headers: { "x-forwarded-for": "10.2.1.1", cookie: "fc_session=junk", authorization: "Bearer junk" } }),
      { params: Promise.resolve({}) },
    );
    assert.equal(res.status, 200);
  });

  it("exports GET only", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal((health as Record<string, unknown>)[m], undefined, m);
  });
});

describe("database down", () => {
  it("a rejected query is 503 degraded, with no error text, host or password", async () => {
    impl = async () => {
      throw new Error(LEAK);
    };
    await assertDegraded(await get());
  });

  it("a non-Error rejection is the same", async () => {
    for (const thrown of [LEAK, { message: LEAK }, undefined, null]) {
      impl = () => Promise.reject(thrown);
      await assertDegraded(await get());
    }
  });

  it("a synchronous throw from the client is the same", async () => {
    impl = () => {
      throw new Error(LEAK);
    };
    await assertDegraded(await get());
  });

  it("the failure is logged server-side, not returned", async () => {
    const spy = console.error as unknown as ReturnType<typeof mock.method>;
    const before = spy.mock.callCount();
    impl = async () => {
      throw new Error(LEAK);
    };
    await get();
    assert.ok(spy.mock.callCount() > before);
  });

  it("recovers: the next request after a failure is 200 again (nothing is cached)", async () => {
    impl = async () => {
      throw new Error(LEAK);
    };
    assert.equal((await get()).status, 503);
    impl = async () => [{ "?column?": 1 }];
    assert.equal((await get()).status, 200);
  });
});

describe("slow database (2 s timeout)", () => {
  const tick = () => new Promise((r) => setImmediate(r));

  it("a query that never answers gives 503 once 2 s have passed, and not before", { timeout: 5_000 }, async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      impl = () => new Promise(() => {}); // hangs
      const pending = get();
      await tick();
      mock.timers.tick(1_999);
      const early = await Promise.race([pending.then(() => "answered"), tick().then(() => "waiting")]);
      assert.equal(early, "waiting", "answered before the 2 s timeout");
      mock.timers.tick(1);
      await assertDegraded(await pending);
    } finally {
      mock.timers.reset();
    }
  });

  it("a query that answers in time is still 200", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      let answer!: (v: unknown) => void;
      impl = () => new Promise((r) => (answer = r));
      const pending = get();
      await tick();
      mock.timers.tick(1_500);
      answer([{ "?column?": 1 }]);
      const res = await pending;
      assert.equal(res.status, 200);
    } finally {
      mock.timers.reset();
    }
  });
});

describe("rate limit", () => {
  it("health is behind the IP bucket: over the limit is 429 rate_limited, no-store", async () => {
    process.env.RATE_LIMIT_IP_PER_MIN = "2";
    const ip = "10.2.2.2";
    await get(ip);
    await get(ip);
    const res = await get(ip);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(res.headers.get("retry-after") ?? "", /^\d+$/);
    assert.equal((await res.json()).error.code, "rate_limited");
    assert.equal(queryRaw.mock.callCount(), 2, "a limited request must not reach the database");
  });
});
