import {
  SYNC_ALREADY_IN_PROGRESS_ERROR,
  SYNC_LOCK_UNAVAILABLE_ERROR,
  type SyncResult,
} from "@/services/aggregator/autoSync";

// Sync results as sent to clients (WL-SEC-1, admin and machine callers alike). A failed scraper's
// status and a save failure's `error` come from err.message upstream (URLs, DB errors, header
// values), so only fixed text leaves the server. The details stay in the server logs.
const FIXED_ERRORS = new Set<string>([SYNC_ALREADY_IN_PROGRESS_ERROR, SYNC_LOCK_UNAVAILABLE_ERROR]);

export function publicSyncResult(r: SyncResult | null): SyncResult | null {
  if (!r) return null;
  // Explicit fields, no spread: a field added to SyncResult later must be listed here to reach clients.
  return {
    timestamp: r.timestamp,
    totalRaw: r.totalRaw,
    totalDeduplicated: r.totalDeduplicated,
    snapshotsCaptured: r.snapshotsCaptured,
    saveErrors: r.saveErrors,
    scraperResults: r.scraperResults.map((s) => ({
      name: s.name,
      count: s.count,
      status: s.status === "Success" ? "Success" : "Failed",
      durationMs: s.durationMs,
    })),
    error: r.error === undefined ? undefined : FIXED_ERRORS.has(r.error) ? r.error : "Sync failed",
  };
}
