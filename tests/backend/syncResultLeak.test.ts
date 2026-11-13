/**
 * T0-04 follow-up (AH-6, WL-SEC-1: "no error.message reaches a client"): sync results as sent to
 * clients. A failed scraper's status (`Failed: ${err.message}`) and a failed save's `error` carry
 * upstream error text (URLs, DB errors, header values), so publicSyncResult() in
 * src/app/api/admin/syncView.ts lets only fixed text out, and GET and POST /api/admin/sync and
 * POST /api/sync all send results through it, including the `lastSync` in the 409 body.
 *
 * No database and no secrets needed; always runs. Run:
 *   npx tsx --test tests/backend/syncResultLeak.test.ts
 *
 * The route cases run the REAL runSync(). Only its edges are replaced: the sync lock's pg.Client
 * methods (so no Postgres), the eight scrapers' scrape() (so no scraper code runs; each throws an
 * error that contains a secret) and DeduplicationEngine.deduplicate (throws a secret-bearing
 * error, which is how a save failure reaches `result.error`). Global fetch throws as a backstop and
 * is asserted unused. Sessions are real NextAuth cookies (authTestKit.ts); the database is the
 * recording fake (fakeDb.ts).
 */
import { ADMIN, installRequestScope, setAdminEmails, signInAs, signOut, uninstallRequestScope } from "./authTestKit";
import { resetDb } from "./fakeDb";
import { describe, it, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { NextRequest } from "next/server";
import type { SyncResult } from "@/services/aggregator/autoSync";

const SCRAPER_ERROR = 'Headers.append: "Bearer SECRET-TOKEN-abc\ndef" is an invalid header value.';
const SAVE_ERROR = "password authentication failed for user fc_prod (password: SECRET-DB-PASS)";
const LOCK_ERROR = "connect ECONNREFUSED 10.0.0.5:5432 as fc_prod SECRET-LOCK-PASS";
const LEAKS = [
  "SECRET-TOKEN-abc",
  "invalid header value",
  "Headers.append",
  "SECRET-DB-PASS",
  "fc_prod",
  "password authentication failed",
  "SECRET-LOCK-PASS",
  "ECONNREFUSED",
  "10.0.0.5",
];
const SYNC_SECRET = "correct-horse-battery-staple";

let view: typeof import("@/app/api/admin/syncView");
let autoSync: typeof import("@/services/aggregator/autoSync");
let adminSync: typeof import("@/app/api/admin/sync/route");
let machineSync: typeof import("@/app/api/sync/route");
let fetchSpy: ReturnType<typeof mock.method>;

// What the stubbed sync lock does.
let lockHeldByUs = true; // pg_try_advisory_lock answers true; false means another process holds it
let connectError: Error | null = null;

type LockClient = { connect: () => Promise<void>; query: (...a: unknown[]) => Promise<unknown>; end: () => Promise<void> };

before(async () => {
  installRequestScope();
  fetchSpy = mock.method(globalThis, "fetch", async () => {
    throw new Error("network access is forbidden in this test");
  });
  for (const m of ["error", "log", "warn"] as const) mock.method(console, m, () => {});

  const client = pg.Client.prototype as unknown as LockClient;
  mock.method(client, "connect", async () => {
    if (connectError) throw connectError;
  });
  mock.method(client, "query", async () => ({ rows: [{ locked: lockHeldByUs }] }));
  mock.method(client, "end", async () => {});

  const { OcmScraper } = await import("@/services/aggregator/ocm");
  const { OsmScraper } = await import("@/services/aggregator/osm");
  const { EvYatraScraper } = await import("@/services/aggregator/evyatra");
  const { TataPowerScraper } = await import("@/services/aggregator/cpos/tataPower");
  const { AtherGridScraper } = await import("@/services/aggregator/cpos/atherGrid");
  const { StatiqScraper } = await import("@/services/aggregator/cpos/statiq");
  const { ChargeZoneScraper } = await import("@/services/aggregator/cpos/chargeZone");
  const { BpclScraper } = await import("@/services/aggregator/cpos/bpcl");
  for (const Scraper of [OcmScraper, OsmScraper, EvYatraScraper, TataPowerScraper, AtherGridScraper, StatiqScraper, ChargeZoneScraper, BpclScraper]) {
    mock.method(Scraper.prototype, "scrape", async () => {
      throw new Error(SCRAPER_ERROR);
    });
  }
  const { DeduplicationEngine } = await import("@/services/aggregator/dedupe");
  mock.method(DeduplicationEngine, "deduplicate", () => {
    throw new Error(SAVE_ERROR);
  });

  view = await import("@/app/api/admin/syncView");
  autoSync = await import("@/services/aggregator/autoSync");
  adminSync = await import("@/app/api/admin/sync/route");
  machineSync = await import("@/app/api/sync/route");
});
after(() => {
  uninstallRequestScope();
  mock.restoreAll();
});
beforeEach(async () => {
  resetDb();
  fetchSpy.mock.resetCalls();
  lockHeldByUs = true;
  connectError = null;
  process.env.SYNC_SECRET_KEY = SYNC_SECRET;
  setAdminEmails(ADMIN.email);
  signOut();
  await signInAs(ADMIN);
});

// ---------------------------------------------------------------------------------------------
describe("publicSyncResult()", () => {
  const result = (over: Partial<SyncResult> = {}): SyncResult => ({
    timestamp: "2026-10-31T10:00:00.000Z",
    totalRaw: 120,
    totalDeduplicated: 100,
    snapshotsCaptured: 90,
    saveErrors: 2,
    scraperResults: [
      { name: "OCM", count: 60, status: "Success", durationMs: 1200 },
      { name: "Statiq", count: 0, status: `Failed: ${SCRAPER_ERROR}`, durationMs: 30 },
    ],
    ...over,
  });

  it("maps null to null", () => {
    assert.equal(view.publicSyncResult(null), null);
  });

  it("keeps a result without an error free of one", () => {
    assert.equal(view.publicSyncResult(result())!.error, undefined);
  });

  it("keeps the two fixed skip errors the admin panel and callers rely on", () => {
    // Pinned as literals, independently of the exported constants (see syncSkipStatus.test.ts).
    assert.equal(view.publicSyncResult(result({ error: "Sync already in progress" }))!.error, "Sync already in progress");
    assert.equal(view.publicSyncResult(result({ error: "Sync lock unavailable" }))!.error, "Sync lock unavailable");
  });

  it("replaces any other error text, whatever it contains", () => {
    for (const raw of [SAVE_ERROR, LOCK_ERROR, "Transaction API error: Unable to start a transaction", "sync already in progress", "Sync lock unavailable (detail)"]) {
      const out = view.publicSyncResult(result({ error: raw }))!.error;
      assert.equal(typeof out, "string", raw);
      assert.notEqual(out, raw);
      for (const leak of LEAKS) assert.ok(!out!.includes(leak), `"${leak}" survived in the error`);
    }
  });

  it("keeps a successful scraper's status as exactly Success, which the admin panel tests for", () => {
    assert.equal(view.publicSyncResult(result())!.scraperResults[0].status, "Success");
  });

  it("replaces a failed scraper's status with fixed text that is not Success", () => {
    for (const raw of [`Failed: ${SCRAPER_ERROR}`, SCRAPER_ERROR, "failed", "Success!", "success", ""]) {
      const out = view.publicSyncResult(result({ scraperResults: [{ name: "X", count: 0, status: raw, durationMs: 1 }] }))!.scraperResults[0].status;
      assert.notEqual(out, "Success", `status ${JSON.stringify(raw)} must not read as success`);
      assert.notEqual(out, raw);
      assert.ok(out.startsWith("Failed"), `fixed text should still read as a failure, got ${out}`);
      for (const leak of LEAKS) assert.ok(!out.includes(leak));
    }
  });

  it("keeps every other field: timestamp, totals, scraper names, counts and durations", () => {
    const out = view.publicSyncResult(result({ error: SAVE_ERROR }))!;
    assert.equal(out.timestamp, "2026-10-31T10:00:00.000Z");
    assert.deepEqual(
      [out.totalRaw, out.totalDeduplicated, out.snapshotsCaptured, out.saveErrors],
      [120, 100, 90, 2],
    );
    assert.deepEqual(
      out.scraperResults.map((s) => [s.name, s.count, s.durationMs]),
      [
        ["OCM", 60, 1200],
        ["Statiq", 0, 30],
      ],
    );
  });

  it("drops any field it does not know, at the top level and on a scraper (explicit field list)", () => {
    const withExtras = {
      ...result({ error: SAVE_ERROR }),
      rawError: SAVE_ERROR,
      debug: { token: "SECRET-TOKEN-abc" },
      scraperResults: [{ name: "OCM", count: 1, status: "Success", durationMs: 5, rawResponse: "SECRET-BODY", stack: SCRAPER_ERROR }],
    } as unknown as SyncResult;
    const out = view.publicSyncResult(withExtras)!;
    assert.deepEqual(Object.keys(out).sort(), [
      "error", "saveErrors", "scraperResults", "snapshotsCaptured", "timestamp", "totalDeduplicated", "totalRaw",
    ]);
    assert.deepEqual(Object.keys(out.scraperResults[0]).sort(), ["count", "durationMs", "name", "status"]);
    const text = JSON.stringify(out);
    assert.ok(!text.includes("SECRET-BODY") && !text.includes("SECRET-TOKEN-abc") && !text.includes("rawError"));
  });

  it("does not touch the stored result: the details must stay available to the server logs", () => {
    const stored = result({ error: SAVE_ERROR });
    const before = structuredClone(stored);
    const out = view.publicSyncResult(stored)!;
    assert.deepEqual(stored, before);
    assert.notEqual(out, stored);
    assert.notEqual(out.scraperResults, stored.scraperResults);
  });

  it("handles a result with no scrapers", () => {
    assert.deepEqual(view.publicSyncResult(result({ scraperResults: [] }))!.scraperResults, []);
  });
});

// ---------------------------------------------------------------------------------------------
describe("sync routes send no raw failure text", () => {
  /** A real run that fails every scraper and the save, so the stored result holds the raw text. */
  async function seedFailedRun() {
    const run = await autoSync.runSync();
    // Precondition: if the stored result were already clean these tests would prove nothing.
    const stored = JSON.stringify(autoSync.getLastSyncResult());
    assert.ok(stored.includes("SECRET-TOKEN-abc"), "the seeded run should hold the raw scraper error");
    assert.ok(stored.includes("SECRET-DB-PASS"), "the seeded run should hold the raw save error");
    assert.equal(run.scraperResults.length, 8);
  }
  const assertClean = (text: string) => {
    for (const leak of LEAKS) assert.ok(!text.includes(leak), `"${leak}" reached the client: ${text}`);
  };
  const adminPost = () => adminSync.POST(new NextRequest("http://localhost/api/admin/sync", { method: "POST" }));
  const machinePost = () =>
    machineSync.POST(new NextRequest("http://localhost/api/sync", { method: "POST", headers: { "x-sync-secret": SYNC_SECRET } }));

  it("GET /api/admin/sync shows scraper names and failure marks but not the failure text", async () => {
    await seedFailedRun();
    const res = await adminSync.GET();
    assert.equal(res.status, 200);
    const text = await res.text();
    assertClean(text);
    const { lastSync } = JSON.parse(text);
    assert.equal(lastSync.scraperResults.length, 8);
    for (const s of lastSync.scraperResults) {
      assert.ok(s.name.length > 0);
      assert.notEqual(s.status, "Success");
    }
    assert.equal(typeof lastSync.error, "string");
    assert.equal(fetchSpy.mock.callCount(), 0);
  });

  it("POST /api/admin/sync returns the run's result without the failure text", async () => {
    const res = await adminPost();
    assert.equal(res.status, 200);
    const text = await res.text();
    assertClean(text);
    const { success, result } = JSON.parse(text);
    assert.equal(success, true);
    assert.equal(result.scraperResults.length, 8);
    for (const s of result.scraperResults) assert.notEqual(s.status, "Success");
    // The server keeps the details for its own logs.
    assert.ok(JSON.stringify(autoSync.getLastSyncResult()).includes("SECRET-TOKEN-abc"), "the stored result was scrubbed");
    assert.equal(fetchSpy.mock.callCount(), 0);
  });

  it("the 409 body's lastSync is scrubbed too (another process holds the sync lock)", async () => {
    await seedFailedRun();
    lockHeldByUs = false;
    const res = await adminPost();
    assert.equal(res.status, 409);
    const text = await res.text();
    assertClean(text);
    const body = JSON.parse(text);
    assert.equal(typeof body.error, "string");
    assert.ok(body.lastSync, "the 409 body should still say what the last sync was");
    assert.equal(body.lastSync.scraperResults.length, 8);
    for (const s of body.lastSync.scraperResults) assert.notEqual(s.status, "Success");
  });

  it("the 503 body does not carry the lock connection error", async () => {
    await seedFailedRun();
    connectError = new Error(LOCK_ERROR);
    const res = await adminPost();
    assert.equal(res.status, 503);
    const text = await res.text();
    assertClean(text);
    assert.deepEqual(Object.keys(JSON.parse(text)), ["error"]);
  });

  it("POST /api/sync returns the result without the failure text", async () => {
    const res = await machinePost();
    assert.equal(res.status, 200);
    const text = await res.text();
    assertClean(text);
    const { success, result } = JSON.parse(text);
    assert.equal(success, false, "a run that failed to save must not be reported as a success");
    assert.equal(result.scraperResults.length, 8);
    for (const s of result.scraperResults) assert.notEqual(s.status, "Success");
    assert.equal(typeof result.error, "string");
    assert.equal(fetchSpy.mock.callCount(), 0);
  });

  it("POST /api/sync does not carry the lock connection error either", async () => {
    connectError = new Error(LOCK_ERROR);
    const res = await machinePost();
    const text = await res.text();
    assertClean(text);
    assert.equal(JSON.parse(text).result.error, "Sync lock unavailable");
  });

  it("an anonymous caller gets neither the result nor the lastSync", async () => {
    await seedFailedRun();
    signOut();
    for (const res of [await adminSync.GET(), await adminPost()]) {
      assert.equal(res.status, 401);
      const text = await res.text();
      assertClean(text);
      assert.ok(!text.includes("lastSync"));
    }
  });
});
