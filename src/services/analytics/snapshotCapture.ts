import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";

/**
 * Captures a point-in-time snapshot of all stations and their connectors.
 * Called after each successful sync cycle to build historical time-series data
 * for per-charger behavior analysis.
 *
 * Uses bulk createMany with pre-generated UUIDs to execute in milliseconds
 * instead of tens of thousands of individual insert queries.
 */
export async function captureSnapshots(syncSource: string = "scheduled"): Promise<number> {
  console.log("[SnapshotCapture] Starting bulk snapshot capture...");
  const startTime = Date.now();

  // Fetch all current stations with their connectors
  const stations = await db.station.findMany({
    include: { connectors: true },
  });

  if (stations.length === 0) {
    console.log("[SnapshotCapture] No stations found to snapshot.");
    return 0;
  }

  const now = new Date();
  const stationSnapshotsData: Array<{
    id: string;
    stationId: string;
    status: any;
    syncSource: string;
    capturedAt: Date;
  }> = [];

  const connectorSnapshotsData: Array<{
    id: string;
    stationSnapshotId: string;
    connectorType: any;
    powerKw: number | null;
    currentType: any;
    status: any;
    capturedAt: Date;
  }> = [];

  for (const station of stations) {
    const snapshotId = randomUUID();
    stationSnapshotsData.push({
      id: snapshotId,
      stationId: station.id,
      status: station.status,
      syncSource,
      capturedAt: now,
    });

    for (const conn of station.connectors) {
      connectorSnapshotsData.push({
        id: randomUUID(),
        stationSnapshotId: snapshotId,
        connectorType: conn.type,
        powerKw: conn.powerKw,
        currentType: conn.currentType,
        status: conn.status,
        capturedAt: now,
      });
    }
  }

  // Insert in batches of 1,000 to remain well within SQL query parameter limits
  const BATCH_SIZE = 1000;

  for (let i = 0; i < stationSnapshotsData.length; i += BATCH_SIZE) {
    const chunk = stationSnapshotsData.slice(i, i + BATCH_SIZE);
    await db.stationSnapshot.createMany({
      data: chunk,
    });
  }

  for (let i = 0; i < connectorSnapshotsData.length; i += BATCH_SIZE) {
    const chunk = connectorSnapshotsData.slice(i, i + BATCH_SIZE);
    await db.connectorSnapshot.createMany({
      data: chunk,
    });
  }

  const durationMs = Date.now() - startTime;
  console.log(
    `[SnapshotCapture] Bulk captured ${stationSnapshotsData.length} station snapshots & ${connectorSnapshotsData.length} connector snapshots in ${durationMs}ms.`
  );

  return stationSnapshotsData.length;
}

/**
 * Cleans up old snapshot data according to the retention policy:
 * - Granular (30-min) snapshots: kept for 7 days
 * - Everything older than 7 days: deleted
 */
export async function cleanupOldSnapshots(): Promise<number> {
  console.log("[SnapshotCapture] Running snapshot cleanup...");

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const deletedConnectors = await db.connectorSnapshot.deleteMany({
    where: { capturedAt: { lt: sevenDaysAgo } },
  });

  const deletedStations = await db.stationSnapshot.deleteMany({
    where: { capturedAt: { lt: sevenDaysAgo } },
  });

  console.log(
    `[SnapshotCapture] Cleanup complete. Deleted ${deletedStations.count} station snapshots, ${deletedConnectors.count} connector snapshots.`
  );

  return deletedStations.count;
}
