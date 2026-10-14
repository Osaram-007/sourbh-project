import pg from "pg";
import { OcmScraper } from "./ocm";
import { OsmScraper } from "./osm";
import { EvYatraScraper } from "./evyatra";
import { TataPowerScraper } from "./cpos/tataPower";
import { AtherGridScraper } from "./cpos/atherGrid";
import { StatiqScraper } from "./cpos/statiq";
import { ChargeZoneScraper } from "./cpos/chargeZone";
import { BpclScraper } from "./cpos/bpcl";
import { DeduplicationEngine } from "./dedupe";
import { ScrapedStation } from "./types";
import { captureSnapshots, cleanupOldSnapshots } from "../analytics/snapshotCapture";
import { db } from "@/lib/db";

export interface ScraperResult {
  name: string;
  count: number;
  status: "Success" | string;
  durationMs: number;
}

export interface SyncResult {
  timestamp: string;
  totalRaw: number;
  totalDeduplicated: number;
  snapshotsCaptured: number;
  saveErrors: number;
  scraperResults: ScraperResult[];
  error?: string;
}

// In-memory sync state (persists across requests within the same server process)
let lastSyncResult: SyncResult | null = null;
let syncInProgress = false;
let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let nextSyncAt: Date | null = null;

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Postgres advisory-lock key that serialises sync runs across processes (worker + web).
export const SYNC_LOCK_KEY = 0x464353594e43; // ASCII "FCSYNC"

// `error` of a runSync() result for a run skipped without scraping. Callers match these, not literals.
export const SYNC_ALREADY_IN_PROGRESS_ERROR = "Sync already in progress";
export const SYNC_LOCK_UNAVAILABLE_ERROR = "Sync lock unavailable";

export function getLastSyncResult(): SyncResult | null {
  return lastSyncResult;
}

export function isSyncInProgress(): boolean {
  return syncInProgress;
}

export function getNextSyncTime(): Date | null {
  return nextSyncAt;
}

/**
 * Takes the cross-process sync lock: the worker and web-triggered syncs run in different
 * processes, so the in-memory flag alone cannot stop them overlapping. A session-level advisory
 * lock lives and dies with its connection, so it needs a dedicated client; a pooled Prisma
 * connection could be recycled or handed to another query mid-run.
 * Resolves to the client holding the lock, or null if another process already holds it.
 * Rejects if the connection or the lock query fails.
 */
async function acquireSyncLock(): Promise<pg.Client | null> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  // A connection that drops mid-run emits 'error'; unhandled, that would crash the process.
  // ponytail: the drop also frees the lock mid-run; we log and let the run finish (abort here if overlap shows up).
  client.on("error", (err) => console.error("[AutoSync] Sync lock connection error:", err));

  let locked = false;
  try {
    await client.connect();
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [SYNC_LOCK_KEY]);
    locked = rows[0].locked;
  } finally {
    if (!locked) await client.end().catch(() => {});
  }
  return locked ? client : null;
}

/** Releases the sync lock and closes its connection (closing alone would free it too). Never throws. */
async function releaseSyncLock(client: pg.Client): Promise<void> {
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [SYNC_LOCK_KEY]);
  } catch (err) {
    console.error("[AutoSync] Failed to release the sync lock explicitly:", err);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function runSync(): Promise<SyncResult> {
  if (syncInProgress) {
    // Always marked skipped: the previous run's result carries no error, so callers would take it for a run.
    return {
      ...(lastSyncResult ?? {
        timestamp: new Date().toISOString(),
        totalRaw: 0,
        totalDeduplicated: 0,
        snapshotsCaptured: 0,
        saveErrors: 0,
        scraperResults: [],
      }),
      error: SYNC_ALREADY_IN_PROGRESS_ERROR,
    };
  }

  syncInProgress = true;

  let result: SyncResult = {
    timestamp: new Date().toISOString(),
    totalRaw: 0,
    totalDeduplicated: 0,
    snapshotsCaptured: 0,
    saveErrors: 0,
    scraperResults: [],
    error: "Sync did not complete",
  };
  let lockClient: pg.Client | null = null;
  try {
    try {
      lockClient = await acquireSyncLock();
    } catch (err) {
      // Fail closed: without the lock another process may be scraping at the same time.
      // Logs the error object, not .message: a refused connection is an AggregateError with an empty message.
      console.error("[AutoSync] Could not take the sync lock, skipping this run:", err);
      return { ...result, error: SYNC_LOCK_UNAVAILABLE_ERROR };
    }
    if (!lockClient) {
      console.log("[AutoSync] Another process is already syncing, skipping this run.");
      return { ...result, error: SYNC_ALREADY_IN_PROGRESS_ERROR };
    }

    // Taken once the lock is held, so every station saved from here on was written by this run.
    const startedAt = new Date();
    console.log("[AutoSync] Starting full data synchronization...");

    const scrapers = [
      new OcmScraper(),
      new OsmScraper(),
      new EvYatraScraper(),
      new TataPowerScraper(),
      new AtherGridScraper(),
      new StatiqScraper(),
      new ChargeZoneScraper(),
      new BpclScraper(),
    ];

    const scraperResults: ScraperResult[] = [];
    let combinedStations: ScrapedStation[] = [];

    for (const scraper of scrapers) {
      const start = Date.now();
      try {
        console.log(`[AutoSync] Running scraper: ${scraper.name}...`);
        const stations = await scraper.scrape();
        combinedStations = combinedStations.concat(stations);
        scraperResults.push({
          name: scraper.name,
          count: stations.length,
          status: "Success",
          durationMs: Date.now() - start,
        });
      } catch (err: any) {
        console.error(`[AutoSync] Scraper ${scraper.name} failed:`, err.message);
        scraperResults.push({
          name: scraper.name,
          count: 0,
          status: `Failed: ${err.message}`,
          durationMs: Date.now() - start,
        });
      }
    }

    const totalRaw = combinedStations.length;
    console.log(`[AutoSync] Deduplicating ${totalRaw} stations...`);

    let totalDeduplicated = 0;
    let snapshotsCaptured = 0;
    let saveErrors = 0;
    let error: string | undefined;

    try {
      const deduplicated = DeduplicationEngine.deduplicate(combinedStations);
      totalDeduplicated = deduplicated.length;
      saveErrors = await DeduplicationEngine.saveToDatabase(deduplicated);
      console.log(`[AutoSync] Sync complete. ${totalDeduplicated} stations saved.`);

      // Capture snapshots for behavior analytics (only stations saved by this run)
      try {
        snapshotsCaptured = await captureSnapshots("scheduled", startedAt);
        console.log(`[AutoSync] Captured ${snapshotsCaptured} behavior snapshots.`);
      } catch (snapErr: any) {
        console.error("[AutoSync] Snapshot capture failed (non-fatal):", snapErr.message);
      }

      // Cleanup old snapshots (retention policy)
      try {
        await cleanupOldSnapshots();
      } catch (cleanupErr: any) {
        console.error("[AutoSync] Snapshot cleanup failed (non-fatal):", cleanupErr.message);
      }
    } catch (err: any) {
      error = err.message;
      console.error("[AutoSync] Failed to save to database:", err.message);
    }

    result = {
      timestamp: new Date().toISOString(),
      totalRaw,
      totalDeduplicated,
      snapshotsCaptured,
      saveErrors,
      scraperResults,
      error,
    };

    lastSyncResult = result;

    try {
      await db.syncRun.create({
        data: {
          startedAt,
          finishedAt: new Date(),
          totalRaw,
          totalDeduplicated,
          snapshotsCaptured,
          saveErrors,
          scraperResults: scraperResults as any,
          error,
        },
      });
    } catch (logErr: any) {
      console.error("[AutoSync] Failed to persist SyncRun record (non-fatal):", logErr.message);
    }
  } finally {
    if (lockClient) await releaseSyncLock(lockClient);
    syncInProgress = false;
    // Schedule next sync time
    nextSyncAt = new Date(Date.now() + SYNC_INTERVAL_MS);
  }

  return result;
}

/**
 * HTTP status a caller that triggers a sync must answer with when runSync() skipped the run
 * without scraping: 409 if another sync already holds the run, 503 if the lock could not be taken.
 * null means the run executed, so its result is reported as usual.
 */
export function getSyncSkipStatus(result: SyncResult): 409 | 503 | null {
  if (result.error === SYNC_ALREADY_IN_PROGRESS_ERROR) return 409;
  if (result.error === SYNC_LOCK_UNAVAILABLE_ERROR) return 503;
  return null;
}

/**
 * Initialize auto-sync: runs immediately on first call, then every SYNC_INTERVAL_MS (15 minutes).
 * Safe to call multiple times — will only init once.
 */
export function initAutoSync() {
  if (syncIntervalId !== null) return; // Already initialized

  console.log("[AutoSync] Initializing auto-sync engine...");

  // Run initial sync after a short delay (let the server fully start)
  setTimeout(() => {
    runSync().catch((err) =>
      console.error("[AutoSync] Initial sync failed:", err)
    );
  }, 5000);

  // Schedule recurring syncs
  syncIntervalId = setInterval(() => {
    runSync().catch((err) =>
      console.error("[AutoSync] Scheduled sync failed:", err)
    );
  }, SYNC_INTERVAL_MS);

  console.log(`[AutoSync] Recurring sync scheduled every ${SYNC_INTERVAL_MS / 60000} minutes.`);
}
