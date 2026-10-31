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
  return {
    ...r,
    error: r.error === undefined ? undefined : FIXED_ERRORS.has(r.error) ? r.error : "Sync failed",
    scraperResults: r.scraperResults.map((s) => ({
      ...s,
      status: s.status === "Success" ? "Success" : "Failed",
    })),
  };
}
