/**
 * T0-02 regression (spec D11, DATA-5 part): runSync() must fail closed when the cross-process
 * sync lock cannot be taken. No database is needed, so this always runs.
 *
 * Run: npx tsx --test tests/backend/syncLockFailClosed.test.ts
 *
 * DATABASE_URL points at a closed local port, so the dedicated lock client's connection is
 * refused. It is set before any app module loads because src/lib/db.ts reads it at import time
 * (hence the dynamic import in before()). Nothing here ever talks to a real database.
 *
 * Hard rule: no test may run the real scrapers (they call external CPO/OSM APIs). Both tests stop
 * runSync() before the scrape step. As a safety net, global fetch (the only transport the scrapers
 * use) is replaced by a function that throws, and each test asserts it was never called. That
 * stubs the network boundary only; runSync() and its lock logic run for real.
 */
import { describe, it, before, type TestContext } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://x:x@127.0.0.1:1/x";

describe("runSync fails closed when the sync lock is unavailable (no database)", () => {
  let autoSync: typeof import("@/services/aggregator/autoSync");

  before(async () => {
    autoSync = await import("@/services/aggregator/autoSync");
  });

  /** Blocks the network and silences the expected error log; returns spies on both. */
  function guard(t: TestContext) {
    const fetchSpy = t.mock.method(globalThis, "fetch", async () => {
      throw new Error("network access is forbidden in this test");
    });
    const errorLog = t.mock.method(console, "error", () => {});
    return { fetchSpy, errorLog };
  }

  it("resolves instead of throwing, reports 'Sync lock unavailable' and does no work", { timeout: 30_000 }, async (t) => {
    const { fetchSpy, errorLog } = guard(t);

    const result = await autoSync.runSync();

    assert.equal(result.error, "Sync lock unavailable");
    assert.equal(result.totalRaw, 0);
    assert.equal(result.totalDeduplicated, 0);
    assert.equal(result.snapshotsCaptured, 0);
    assert.equal(result.saveErrors, 0);
    assert.deepEqual(result.scraperResults, []);
    assert.equal(fetchSpy.mock.callCount(), 0, "no scraper may run without the lock");
    assert.ok(errorLog.mock.callCount() >= 1, "the failure must be logged, not swallowed silently");
    assert.equal(autoSync.isSyncInProgress(), false);
  });

  it("runs the lock attempt again on a second call, so the in-memory flag was reset", { timeout: 60_000 }, async (t) => {
    const { fetchSpy } = guard(t);

    const first = await autoSync.runSync();
    const second = await autoSync.runSync();

    assert.equal(first.error, "Sync lock unavailable");
    // A flag left at true would short-circuit this call to "Sync already in progress".
    assert.equal(second.error, "Sync lock unavailable");
    assert.equal(autoSync.isSyncInProgress(), false);
    assert.equal(fetchSpy.mock.callCount(), 0);
  });
});
