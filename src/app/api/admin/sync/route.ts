import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  runSync,
  getLastSyncResult,
  isSyncInProgress,
  getNextSyncTime,
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

// POST: Trigger manual sync
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any)?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (isSyncInProgress()) {
      return NextResponse.json(
        { error: "Sync is already in progress", lastSync: getLastSyncResult() },
        { status: 409 }
      );
    }

    const result = await runSync();

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
