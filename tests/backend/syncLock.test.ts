/**
 * T0-02 regression (spec D11, DATA-5 part): only one sync may run at a time ACROSS PROCESSES.
 * runSync() takes a Postgres session advisory lock (SYNC_LOCK_KEY) on its own pg.Client. A run
 * that cannot get it must return "Sync already in progress" without scraping and without writing
 * a SyncRun row, must not leak the connection it used to try, and a run that did get it must hand
 * it back (and reset its in-memory flag) however it ends.
 *
 * NEEDS A REAL POSTGRES. Set TEST_DATABASE_URL to a dedicated, disposable database. When it is
 * unset every test below is reported as SKIPPED (never as passed). The no-database half of the
 * lock behaviour (fail closed) lives in syncLockFailClosed.test.ts and always runs.
 *
 * Prepare the schema once (versioned migrations do not exist yet, see T0-05):
 *   bash:        DATABASE_URL="$TEST_DATABASE_URL" npx prisma db push
 *   PowerShell:  $env:DATABASE_URL = $env:TEST_DATABASE_URL; npx prisma db push
 * Then run:
 *   bash:        TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/fullcharge_test npx tsx --test tests/backend/syncLock.test.ts
 *   PowerShell:  $env:TEST_DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/fullcharge_test"; npx tsx --test tests/backend/syncLock.test.ts
 *
 * The tests take the sync advisory lock on that database, so do not point them at a database a
 * sync worker is using. "Another process" is a second pg.Client (a separate session), which is
 * exactly what the lock is meant to exclude.
 *
 * Hard rule: no test may run the real scrapers (they call external CPO/OSM APIs). Every test stops
 * runSync() before the scrape step: at the lock for the first two, and by an abort right after the
 * lock is taken for the third (see its comment). As a safety net, global fetch (the only transport
 * the scrapers use) is replaced by a function that throws, and each test asserts it was never
 * called. That stubs the network boundary only; runSync() and its lock logic run for real.
 */
import { describe, it, before, after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = TEST_DATABASE_URL
  ? false
  : "TEST_DATABASE_URL is not set: needs a real Postgres (see the header of this file)";
const dbTest = { skip, timeout: 30_000 };

// Before any app module loads: src/lib/db.ts reads DATABASE_URL at import time and the lock client
// reads it when it connects. Both must see the test database.
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

describe("sync lock across sessions (real Postgres)", () => {
  let autoSync: typeof import("@/services/aggregator/autoSync");
  let admin: pg.Client | undefined; // test-side session: counts SyncRun rows, probes the lock

  // Hooks run even when every test is skipped, so they must be inert without a database.
  before(async () => {
    if (!TEST_DATABASE_URL) return;
    autoSync = await import("@/services/aggregator/autoSync");
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    admin = client;
  });

  after(async () => {
    await admin?.end();
  });

  // try-lock, not the blocking variant: if a worker already holds it, fail fast instead of hanging.
  async function tryLock(client: pg.Client): Promise<boolean> {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [autoSync.SYNC_LOCK_KEY]);
    return rows[0].locked;
  }

  async function unlock(client: pg.Client): Promise<void> {
    await client.query("SELECT pg_advisory_unlock($1)", [autoSync.SYNC_LOCK_KEY]);
  }

  async function countSyncRuns(): Promise<number> {
    const { rows } = await admin!.query('SELECT count(*)::int AS n FROM "SyncRun"');
    return rows[0].n;
  }

  /** Plays "another process": a separate session that holds the sync lock while fn runs. */
  async function withLockHeldElsewhere(fn: () => Promise<void>): Promise<void> {
    const other = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await other.connect();
    try {
      assert.equal(
        await tryLock(other),
        true,
        "could not take the sync advisory lock on the test database: is a sync worker or another test run using it?",
      );
      await fn();
    } finally {
      try {
        await unlock(other);
      } finally {
        await other.end(); // closing the session frees the lock even if the unlock above failed
      }
    }
  }

  function blockNetwork(t: TestContext) {
    return t.mock.method(globalThis, "fetch", async () => {
      throw new Error("network access is forbidden in this test");
    });
  }

  it("returns 'Sync already in progress' with no scraping and no SyncRun row while another session holds the lock", dbTest, async (t) => {
    const fetchSpy = blockNetwork(t);
    const runsBefore = await countSyncRuns();

    await withLockHeldElsewhere(async () => {
      const result = await autoSync.runSync();

      assert.equal(result.error, "Sync already in progress");
      assert.equal(result.totalRaw, 0);
      assert.equal(result.totalDeduplicated, 0);
      assert.equal(result.snapshotsCaptured, 0);
      assert.equal(result.saveErrors, 0);
      assert.deepEqual(result.scraperResults, []);
      assert.equal(fetchSpy.mock.callCount(), 0, "no scraper may run without the lock");
      assert.equal(await countSyncRuns(), runsBefore, "a skipped run must not write a SyncRun row");
      // The error text alone cannot tell a stuck in-memory flag from a real skip, so check the flag.
      assert.equal(autoSync.isSyncInProgress(), false);
    });
  });

  it("closes the connection it used to try the lock, so skipped runs do not leak sessions", dbTest, async (t) => {
    const fetchSpy = blockNetwork(t);

    await withLockHeldElsewhere(async () => {
      // Pass-through spies: the real connect/end still run. Installed after the other session
      // connected, so they only see the lock client (this path runs no Prisma queries, so no
      // pooled clients either).
      const connectSpy = t.mock.method(pg.Client.prototype, "connect");
      const endSpy = t.mock.method(pg.Client.prototype, "end");

      const result = await autoSync.runSync();

      assert.equal(result.error, "Sync already in progress");
      assert.equal(connectSpy.mock.callCount(), 1, "one dedicated lock client per attempt");
      assert.equal(endSpy.mock.callCount(), 1, "the denied lock client must be ended, not left open");
      assert.equal(fetchSpy.mock.callCount(), 0);
    });
  });

  it("takes the lock when it is free and hands it back when the run ends", dbTest, async (t) => {
    // Positive control: the tests above would also pass if the lock were always denied. A run that
    // gets the lock would go on to scrape, so it is aborted right after: the log line that announces
    // the start of the sync, which is only reached once the lock is held, throws. A denied run never
    // logs it, so an always-denied lock fails here with "Missing expected rejection". If the line is
    // ever reworded the test fails loudly rather than passing vacuously, and scrapers still cannot
    // reach the network (fetch is blocked). Retention is set far out so a broken abort cannot purge
    // old snapshots from the test database.
    const ABORT = "abort right after the lock was taken (test seam)";
    const retention = process.env.SNAPSHOT_RETENTION_DAYS;
    process.env.SNAPSHOT_RETENTION_DAYS = "36500";
    t.after(() => {
      if (retention === undefined) delete process.env.SNAPSHOT_RETENTION_DAYS;
      else process.env.SNAPSHOT_RETENTION_DAYS = retention;
    });
    t.mock.method(console, "log", (...args: unknown[]) => {
      if (String(args[0]).includes("Starting full data synchronization")) throw new Error(ABORT);
    });
    const fetchSpy = blockNetwork(t);
    const endSpy = t.mock.method(pg.Client.prototype, "end");

    await assert.rejects(autoSync.runSync(), { message: ABORT });

    // It gave the lock back: session closed, flag reset, and another session can take the lock now.
    assert.equal(endSpy.mock.callCount(), 1, "the lock session must be closed when the run ends");
    assert.equal(autoSync.isSyncInProgress(), false);
    assert.equal(fetchSpy.mock.callCount(), 0);
    assert.equal(await tryLock(admin!), true, "the lock must be free once the run is over");
    await unlock(admin!);
  });
});
