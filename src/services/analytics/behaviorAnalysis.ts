import { db } from "@/lib/db";
import { StationStatus, ConnectorStatus } from "@prisma/client";

// ===================================================================
// Types
// ===================================================================

export interface StationBehavior {
  stationId: string;
  stationName: string;
  operator: string | null;
  source: string;
  timeRange: string;
  totalSnapshots: number;
  uptimePercent: number;
  offlinePercent: number;
  occupiedPercent: number;
  unknownPercent: number;
  reliabilityScore: number; // 1.0 to 5.0
  statusTransitions: number;
  hourlyHeatmap: HourlyBucket[];
  statusTimeline: StatusTimelineEntry[];
  connectorBreakdown: ConnectorAnalytics[];
}

export interface HourlyBucket {
  hour: number; // 0–23
  availableCount: number;
  occupiedCount: number;
  offlineCount: number;
  unknownCount: number;
  totalSnapshots: number;
}

export interface StatusTimelineEntry {
  status: string;
  from: string; // ISO timestamp
  to: string;   // ISO timestamp
  durationMinutes: number;
}

export interface ConnectorAnalytics {
  connectorType: string;
  currentType: string;
  powerKw: number | null;
  totalSnapshots: number;
  availablePercent: number;
  occupiedPercent: number;
  faultedPercent: number;
}

export interface FleetOverview {
  totalStationsTracked: number;
  totalSnapshots: number;
  avgUptimePercent: number;
  avgReliabilityScore: number;
  mostReliable: StationSummary[];
  leastReliable: StationSummary[];
  networkComparison: Record<string, NetworkStats>;
  statusDistribution: { status: string; percent: number }[];
}

export interface StationSummary {
  stationId: string;
  stationName: string;
  operator: string | null;
  source: string;
  uptimePercent: number;
  reliabilityScore: number;
  totalSnapshots: number;
}

export interface NetworkStats {
  stationCount: number;
  avgUptime: number;
  avgReliability: number;
}

// ===================================================================
// Time Range Helpers
// ===================================================================

function getTimeRangeDate(range: string): Date {
  const now = Date.now();
  switch (range) {
    case "24h": return new Date(now - 24 * 60 * 60 * 1000);
    case "7d":  return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "30d": return new Date(now - 30 * 24 * 60 * 60 * 1000);
    default:    return new Date(now - 7 * 24 * 60 * 60 * 1000);
  }
}

// ===================================================================
// Per-Station Behavior Analysis
// ===================================================================

export async function getStationBehavior(
  stationId: string,
  timeRange: string = "7d"
): Promise<StationBehavior | null> {
  const since = getTimeRangeDate(timeRange);

  // Fetch the station info
  const station = await db.station.findUnique({
    where: { id: stationId },
    select: { id: true, name: true, operator: true, source: true },
  });

  if (!station) return null;

  // Fetch all snapshots for this station within the time range
  const snapshots = await db.stationSnapshot.findMany({
    where: {
      stationId,
      capturedAt: { gte: since },
    },
    include: { connectorSnapshots: true },
    orderBy: { capturedAt: "asc" },
  });

  const totalSnapshots = snapshots.length;
  if (totalSnapshots === 0) {
    return {
      stationId: station.id,
      stationName: station.name,
      operator: station.operator,
      source: station.source,
      timeRange,
      totalSnapshots: 0,
      uptimePercent: 0,
      offlinePercent: 0,
      occupiedPercent: 0,
      unknownPercent: 0,
      reliabilityScore: 0,
      statusTransitions: 0,
      hourlyHeatmap: Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        availableCount: 0,
        occupiedCount: 0,
        offlineCount: 0,
        unknownCount: 0,
        totalSnapshots: 0,
      })),
      statusTimeline: [],
      connectorBreakdown: [],
    };
  }

  // Count statuses
  let availableCount = 0;
  let occupiedCount = 0;
  let offlineCount = 0;
  let unknownCount = 0;

  // Hourly heatmap buckets
  const hourlyBuckets: HourlyBucket[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    availableCount: 0,
    occupiedCount: 0,
    offlineCount: 0,
    unknownCount: 0,
    totalSnapshots: 0,
  }));

  // Status transitions
  let statusTransitions = 0;
  let prevStatus: StationStatus | null = null;

  // Status timeline
  const statusTimeline: StatusTimelineEntry[] = [];
  let currentTimelineEntry: { status: string; from: Date } | null = null;

  // Connector aggregation
  const connectorMap = new Map<
    string,
    {
      connectorType: string;
      currentType: string;
      powerKw: number | null;
      total: number;
      available: number;
      occupied: number;
      faulted: number;
    }
  >();

  for (const snapshot of snapshots) {
    const hour = new Date(snapshot.capturedAt).getHours();

    // Station status counts
    switch (snapshot.status) {
      case "AVAILABLE":
        availableCount++;
        hourlyBuckets[hour].availableCount++;
        break;
      case "OCCUPIED":
        occupiedCount++;
        hourlyBuckets[hour].occupiedCount++;
        break;
      case "OFFLINE":
        offlineCount++;
        hourlyBuckets[hour].offlineCount++;
        break;
      default:
        unknownCount++;
        hourlyBuckets[hour].unknownCount++;
        break;
    }
    hourlyBuckets[hour].totalSnapshots++;

    // Status transitions
    if (prevStatus !== null && snapshot.status !== prevStatus) {
      statusTransitions++;

      // Close previous timeline entry
      if (currentTimelineEntry) {
        statusTimeline.push({
          status: currentTimelineEntry.status,
          from: currentTimelineEntry.from.toISOString(),
          to: new Date(snapshot.capturedAt).toISOString(),
          durationMinutes: Math.round(
            (new Date(snapshot.capturedAt).getTime() -
              currentTimelineEntry.from.getTime()) /
              60000
          ),
        });
      }

      currentTimelineEntry = {
        status: snapshot.status,
        from: new Date(snapshot.capturedAt),
      };
    } else if (currentTimelineEntry === null) {
      currentTimelineEntry = {
        status: snapshot.status,
        from: new Date(snapshot.capturedAt),
      };
    }
    prevStatus = snapshot.status;

    // Connector snapshots
    for (const cs of snapshot.connectorSnapshots) {
      const key = `${cs.connectorType}_${cs.currentType}_${cs.powerKw ?? "null"}`;
      if (!connectorMap.has(key)) {
        connectorMap.set(key, {
          connectorType: cs.connectorType,
          currentType: cs.currentType,
          powerKw: cs.powerKw,
          total: 0,
          available: 0,
          occupied: 0,
          faulted: 0,
        });
      }
      const entry = connectorMap.get(key)!;
      entry.total++;
      if (cs.status === "AVAILABLE") entry.available++;
      else if (cs.status === "OCCUPIED") entry.occupied++;
      else if (cs.status === "FAULTED") entry.faulted++;
    }
  }

  // Close final timeline entry
  if (currentTimelineEntry) {
    const lastSnapshot = snapshots[snapshots.length - 1];
    statusTimeline.push({
      status: currentTimelineEntry.status,
      from: currentTimelineEntry.from.toISOString(),
      to: new Date(lastSnapshot.capturedAt).toISOString(),
      durationMinutes: Math.round(
        (new Date(lastSnapshot.capturedAt).getTime() -
          currentTimelineEntry.from.getTime()) /
          60000
      ),
    });
  }

  // Calculate percentages
  const uptimePercent = round((availableCount / totalSnapshots) * 100);
  const offlinePercent = round((offlineCount / totalSnapshots) * 100);
  const occupiedPercent = round((occupiedCount / totalSnapshots) * 100);
  const unknownPercent = round((unknownCount / totalSnapshots) * 100);

  // Reliability score (1-5 scale)
  // Based on: uptime %, transition frequency penalty, offline penalty
  const reliabilityScore = computeReliabilityScore(
    uptimePercent,
    offlinePercent,
    statusTransitions,
    totalSnapshots
  );

  // Connector breakdown
  const connectorBreakdown: ConnectorAnalytics[] = Array.from(
    connectorMap.values()
  ).map((c) => ({
    connectorType: c.connectorType,
    currentType: c.currentType,
    powerKw: c.powerKw,
    totalSnapshots: c.total,
    availablePercent: c.total > 0 ? round((c.available / c.total) * 100) : 0,
    occupiedPercent: c.total > 0 ? round((c.occupied / c.total) * 100) : 0,
    faultedPercent: c.total > 0 ? round((c.faulted / c.total) * 100) : 0,
  }));

  return {
    stationId: station.id,
    stationName: station.name,
    operator: station.operator,
    source: station.source,
    timeRange,
    totalSnapshots,
    uptimePercent,
    offlinePercent,
    occupiedPercent,
    unknownPercent,
    reliabilityScore,
    statusTransitions,
    hourlyHeatmap: hourlyBuckets,
    statusTimeline: statusTimeline.slice(-50), // Last 50 transitions to keep response size reasonable
    connectorBreakdown,
  };
}

// ===================================================================
// Fleet-Wide Overview
// ===================================================================

export async function getFleetOverview(
  timeRange: string = "7d"
): Promise<FleetOverview> {
  const since = getTimeRangeDate(timeRange);

  // Get all stations that have snapshots in this range
  const stationsWithSnapshots = await db.station.findMany({
    where: {
      snapshots: {
        some: { capturedAt: { gte: since } },
      },
    },
    select: {
      id: true,
      name: true,
      operator: true,
      source: true,
      snapshots: {
        where: { capturedAt: { gte: since } },
        select: { status: true },
      },
    },
  });

  const stationStats: StationSummary[] = [];
  let totalSnapshots = 0;
  let totalUptime = 0;
  let totalReliability = 0;

  // Per-network aggregation
  const networkMap = new Map<
    string,
    { stationCount: number; totalUptime: number; totalReliability: number }
  >();

  // Global status distribution
  let globalAvailable = 0;
  let globalOccupied = 0;
  let globalOffline = 0;
  let globalUnknown = 0;

  for (const station of stationsWithSnapshots) {
    const snaps = station.snapshots;
    const count = snaps.length;
    if (count === 0) continue;

    totalSnapshots += count;

    const available = snaps.filter((s) => s.status === "AVAILABLE").length;
    const offline = snaps.filter((s) => s.status === "OFFLINE").length;
    const occupied = snaps.filter((s) => s.status === "OCCUPIED").length;

    globalAvailable += available;
    globalOccupied += occupied;
    globalOffline += offline;
    globalUnknown += count - available - occupied - offline;

    const uptimePercent = round((available / count) * 100);
    const offlinePercent = round((offline / count) * 100);

    // Count transitions
    let transitions = 0;
    for (let i = 1; i < snaps.length; i++) {
      if (snaps[i].status !== snaps[i - 1].status) transitions++;
    }

    const reliabilityScore = computeReliabilityScore(
      uptimePercent,
      offlinePercent,
      transitions,
      count
    );

    const summary: StationSummary = {
      stationId: station.id,
      stationName: station.name,
      operator: station.operator,
      source: station.source,
      uptimePercent,
      reliabilityScore,
      totalSnapshots: count,
    };

    stationStats.push(summary);
    totalUptime += uptimePercent;
    totalReliability += reliabilityScore;

    // Network aggregation
    const network = station.source;
    if (!networkMap.has(network)) {
      networkMap.set(network, {
        stationCount: 0,
        totalUptime: 0,
        totalReliability: 0,
      });
    }
    const net = networkMap.get(network)!;
    net.stationCount++;
    net.totalUptime += uptimePercent;
    net.totalReliability += reliabilityScore;
  }

  const totalStations = stationStats.length;

  // Sort for most/least reliable
  const sorted = [...stationStats].sort(
    (a, b) => b.reliabilityScore - a.reliabilityScore
  );

  // Network comparison
  const networkComparison: Record<string, NetworkStats> = {};
  for (const [source, net] of networkMap.entries()) {
    networkComparison[source] = {
      stationCount: net.stationCount,
      avgUptime: net.stationCount > 0 ? round(net.totalUptime / net.stationCount) : 0,
      avgReliability:
        net.stationCount > 0
          ? round(net.totalReliability / net.stationCount, 1)
          : 0,
    };
  }

  // Status distribution
  const totalGlobal =
    globalAvailable + globalOccupied + globalOffline + globalUnknown;
  const statusDistribution =
    totalGlobal > 0
      ? [
          {
            status: "AVAILABLE",
            percent: round((globalAvailable / totalGlobal) * 100),
          },
          {
            status: "OCCUPIED",
            percent: round((globalOccupied / totalGlobal) * 100),
          },
          {
            status: "OFFLINE",
            percent: round((globalOffline / totalGlobal) * 100),
          },
          {
            status: "UNKNOWN",
            percent: round((globalUnknown / totalGlobal) * 100),
          },
        ]
      : [];

  return {
    totalStationsTracked: totalStations,
    totalSnapshots,
    avgUptimePercent:
      totalStations > 0 ? round(totalUptime / totalStations) : 0,
    avgReliabilityScore:
      totalStations > 0 ? round(totalReliability / totalStations, 1) : 0,
    mostReliable: sorted.slice(0, 10),
    leastReliable: sorted.slice(-10).reverse(),
    networkComparison,
    statusDistribution,
  };
}

// ===================================================================
// Quick Reliability Lookup (for user-facing badge)
// ===================================================================

export async function getStationReliability(
  stationId: string
): Promise<{ uptimePercent: number; reliabilityScore: number; totalSnapshots: number } | null> {
  const since = getTimeRangeDate("7d");

  const snapshots = await db.stationSnapshot.findMany({
    where: {
      stationId,
      capturedAt: { gte: since },
    },
    select: { status: true },
    orderBy: { capturedAt: "asc" },
  });

  if (snapshots.length === 0) return null;

  const total = snapshots.length;
  const available = snapshots.filter((s) => s.status === "AVAILABLE").length;
  const offline = snapshots.filter((s) => s.status === "OFFLINE").length;

  let transitions = 0;
  for (let i = 1; i < snapshots.length; i++) {
    if (snapshots[i].status !== snapshots[i - 1].status) transitions++;
  }

  const uptimePercent = round((available / total) * 100);
  const offlinePercent = round((offline / total) * 100);
  const reliabilityScore = computeReliabilityScore(
    uptimePercent,
    offlinePercent,
    transitions,
    total
  );

  return { uptimePercent, reliabilityScore, totalSnapshots: total };
}

// ===================================================================
// Helpers
// ===================================================================

function round(value: number, decimals: number = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Computes a reliability score from 1.0 to 5.0 based on:
 * - Uptime percentage (primary factor — 60% weight)
 * - Offline percentage penalty (20% weight)
 * - Status flapping penalty (20% weight) — chargers that constantly change state are unreliable
 */
function computeReliabilityScore(
  uptimePercent: number,
  offlinePercent: number,
  statusTransitions: number,
  totalSnapshots: number
): number {
  // Base score from uptime (0–5 scale)
  const uptimeScore = (uptimePercent / 100) * 5;

  // Offline penalty: high offline % reduces score
  const offlinePenalty = (offlinePercent / 100) * 5;

  // Flapping penalty: high transition rate relative to snapshots = unreliable
  const transitionRate =
    totalSnapshots > 1 ? statusTransitions / (totalSnapshots - 1) : 0;
  const flappingPenalty = Math.min(transitionRate * 3, 2); // Cap at 2 points

  // Weighted combination
  const raw =
    uptimeScore * 0.6 -
    offlinePenalty * 0.2 -
    flappingPenalty * 0.2;

  // Clamp to 1.0–5.0
  return round(Math.max(1.0, Math.min(5.0, raw + 1.5)), 1);
}
