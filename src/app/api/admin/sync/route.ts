import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import {
  runSync,
  getLastSyncResult,
  isSyncInProgress,
  getNextSyncTime,
  getSyncSkipStatus,
} from "@/services/aggregator/autoSync";

// GET: Return last sync status (admin only: includes scraper names and failure messages)
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    return NextResponse.json({
      lastSync: getLastSyncResult(),
      syncInProgress: isSyncInProgress(),
      nextSyncAt: getNextSyncTime()?.toISOString() || null,
    });
  } catch (error) {
    console.error("Admin sync status API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch sync status" },
      { status: 500 }
    );
  }
}

// 409 for a sync already running here (pre-check) or in another process (run skipped on the sync lock)
function syncAlreadyInProgress() {
  return NextResponse.json(
    { error: "Sync is already in progress", lastSync: getLastSyncResult() },
    { status: 409 }
  );
}

// POST: Trigger manual sync
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    if (isSyncInProgress()) {
      return syncAlreadyInProgress();
    }

    const result = await runSync();

    // runSync() skips without scraping when another process holds the sync lock or the lock cannot
    // be taken. That is not a completed sync, so it must not be reported as one.
    const skipStatus = getSyncSkipStatus(result);
    if (skipStatus === 409) {
      return syncAlreadyInProgress();
    }
    if (skipStatus === 503) {
      return NextResponse.json(
        { error: "Sync could not start, try again shortly" },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Admin sync API error:", error);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
