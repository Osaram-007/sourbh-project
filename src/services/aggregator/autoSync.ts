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

export function getLastSyncResult(): SyncResult | null {
  return lastSyncResult;
}

export function isSyncInProgress(): boolean {
  return syncInProgress;
}

export function getNextSyncTime(): Date | null {
  return nextSyncAt;
}

export async function runSync(): Promise<SyncResult> {
  if (syncInProgress) {
    return lastSyncResult || {
      timestamp: new Date().toISOString(),
      totalRaw: 0,
      totalDeduplicated: 0,
      snapshotsCaptured: 0,
      saveErrors: 0,
      scraperResults: [],
      error: "Sync already in progress",
    };
  }

  syncInProgress = true;
  const startedAt = new Date();
  console.log("[AutoSync] Starting full data synchronization...");

  let result: SyncResult = {
    timestamp: new Date().toISOString(),
    totalRaw: 0,
    totalDeduplicated: 0,
    snapshotsCaptured: 0,
    saveErrors: 0,
    scraperResults: [],
    error: "Sync did not complete",
  };
  try {
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

      // Capture snapshots for behavior analytics
      try {
        snapshotsCaptured = await captureSnapshots("scheduled");
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
    syncInProgress = false;
    // Schedule next sync time
    nextSyncAt = new Date(Date.now() + SYNC_INTERVAL_MS);
  }

  return result;
}

/**
 * Initialize auto-sync: runs immediately on first call, then every 30 minutes.
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
