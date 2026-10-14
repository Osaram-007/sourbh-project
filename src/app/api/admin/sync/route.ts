import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  runSync,
  getLastSyncResult,
  isSyncInProgress,
  getNextSyncTime,
  getSyncSkipStatus,
} from "@/services/aggregator/autoSync";

// GET: Return last sync status (public — only returns timestamps and counts)
export async function GET() {
  try {
    return NextResponse.json({
      lastSync: getLastSyncResult(),
      syncInProgress: isSyncInProgress(),
      nextSyncAt: getNextSyncTime()?.toISOString() || null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to fetch sync status", message: error.message },
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
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any)?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

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
  } catch (error: any) {
    return NextResponse.json(
      { error: "Sync failed", message: error.message },
      { status: 500 }
    );
  }
}
