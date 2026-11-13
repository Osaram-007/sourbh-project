/**
 * T0-02 follow-up: getSyncSkipStatus(result) maps a runSync() result to the HTTP status
 * POST /api/admin/sync must answer when the run was skipped without scraping: 409 when another
 * sync holds the run, 503 when the sync lock could not be taken, null when the run executed (its
 * result is then reported as before). No database needed, so this always runs.
 *
 * Run: npx tsx --test tests/backend/syncSkipStatus.test.ts
 *
 * The mapping is pure, so its cases use plain objects. The strings are pinned here as literals,
 * independently of the exported constants, because the constants must equal what runSync()
 * really returns: the last test checks that against real runSync() calls.
 *
 * Those calls use a DATABASE_URL pointing at a closed local port (set before any app module loads,
 * since src/lib/db.ts reads it at import time), so the lock connection is refused and nothing
 * touches a real database. Hard rule: no test may run the real scrapers. Global fetch (the only
 * transport they use) is replaced by a function that throws and asserted unused; this stubs the
 * network boundary only.
 */
import { describe, it, before, type TestContext } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://x:x@127.0.0.1:1/x";

describe("getSyncSkipStatus (no database)", () => {
  let autoSync: typeof import("@/services/aggregator/autoSync");

  before(async () => {
    autoSync = await import("@/services/aggregator/autoSync");
  });

  const resultWith = (error?: string) => ({
    timestamp: "2026-10-14T00:00:00.000Z",
    totalRaw: 0,
    totalDeduplicated: 0,
    snapshotsCaptured: 0,
    saveErrors: 0,
    scraperResults: [],
    error,
  });

  it("exports the error constants with the exact strings callers and the admin panel rely on", () => {
    assert.equal(autoSync.SYNC_ALREADY_IN_PROGRESS_ERROR, "Sync already in progress");
    assert.equal(autoSync.SYNC_LOCK_UNAVAILABLE_ERROR, "Sync lock unavailable");
  });

  it("answers 409 when another sync already holds the run", () => {
    assert.equal(autoSync.getSyncSkipStatus(resultWith("Sync already in progress")), 409);
  });

  it("answers 503 when the sync lock is unavailable", () => {
    assert.equal(autoSync.getSyncSkipStatus(resultWith("Sync lock unavailable")), 503);
  });

  it("answers null when the run has no error", () => {
    assert.equal(autoSync.getSyncSkipStatus(resultWith()), null);
  });

  it("answers null for an error from a run that executed, which keeps its old response", () => {
    // A save failure happened after scraping, so the sync did run and is reported as before.
    assert.equal(autoSync.getSyncSkipStatus(resultWith("Transaction API error: Unable to start a transaction")), null);
    assert.equal(autoSync.getSyncSkipStatus(resultWith("Sync did not complete")), null);
    // Matching is exact: near misses are not skips.
    assert.equal(autoSync.getSyncSkipStatus(resultWith("sync already in progress")), null);
    assert.equal(autoSync.getSyncSkipStatus(resultWith("")), null);
  });

  describe("against real runSync() results", () => {
    function blockNetwork(t: TestContext) {
      return t.mock.method(globalThis, "fetch", async () => {
        throw new Error("network access is forbidden in this test");
      });
    }

    it("a run whose lock connection is refused maps to 503", { timeout: 30_000 }, async (t) => {
      const fetchSpy = blockNetwork(t);
      t.mock.method(console, "error", () => {}); // the refused connection is logged on purpose

      const result = await autoSync.runSync();

      assert.equal(result.error, "Sync lock unavailable");
      assert.equal(autoSync.getSyncSkipStatus(result), 503);
      assert.equal(fetchSpy.mock.callCount(), 0, "no scraper may run without the lock");
    });

    it("an overlapping call in the same process maps to 409 while the first maps to 503", { timeout: 30_000 }, async (t) => {
      const fetchSpy = blockNetwork(t);
      t.mock.method(console, "error", () => {});

      // The second call starts while the first is still waiting on its lock connection, so it hits
      // the in-memory guard; nothing was ever saved, so that guard answers with its own result.
      const [first, second] = await Promise.all([autoSync.runSync(), autoSync.runSync()]);

      assert.equal(first.error, "Sync lock unavailable");
      assert.equal(autoSync.getSyncSkipStatus(first), 503);
      assert.equal(second.error, "Sync already in progress");
      assert.equal(autoSync.getSyncSkipStatus(second), 409);
      assert.equal(autoSync.isSyncInProgress(), false);
      assert.equal(fetchSpy.mock.callCount(), 0);
    });
  });
});
