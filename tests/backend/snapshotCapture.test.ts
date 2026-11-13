/**
 * T0-02 regression (spec DATA-5, part): captureSnapshots(syncSource, since) must record only the
 * stations saved at or after `since` (the cycle start), with their connectors. A station whose
 * source failed this cycle, or that vanished from its source, keeps an older lastSynced and must
 * NOT be re-recorded as a fresh observation. Before T0-02 it snapshotted every Station row, which
 * silently inflated the behaviour dataset every 15 minutes.
 *
 * NEEDS A REAL POSTGRES. Set TEST_DATABASE_URL to a dedicated, disposable database. When it is
 * unset every test below is reported as SKIPPED (never as passed).
 *
 * Prepare the schema once (versioned migrations do not exist yet, see T0-05):
 *   bash:        DATABASE_URL="$TEST_DATABASE_URL" npx prisma db push
 *   PowerShell:  $env:DATABASE_URL = $env:TEST_DATABASE_URL; npx prisma db push
 * Then run:
 *   bash:        TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/fullcharge_test npx tsx --test tests/backend/snapshotCapture.test.ts
 *   PowerShell:  $env:TEST_DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/fullcharge_test"; npx tsx --test tests/backend/snapshotCapture.test.ts
 *
 * Isolation: every row this file inserts is tagged with PREFIX (Station.source and
 * StationSnapshot.syncSource) and only such rows are deleted. Tables are never truncated.
 * Process exit can lag by about 10 s after the tests finish: the pg.Pool in src/lib/db.ts is not
 * exported, so it cannot be closed and idles out on its own (or pass --test-force-exit).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { ConnectorStatus, ConnectorType, CurrentType, StationStatus } from "@prisma/client";
import type { ScrapedStation } from "@/services/aggregator/types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = TEST_DATABASE_URL
  ? false
  : "TEST_DATABASE_URL is not set: needs a real Postgres (see the header of this file)";
const dbTest = { skip, timeout: 60_000 };

// Before any app module loads: src/lib/db.ts reads DATABASE_URL at import time.
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

// Marks every row this file creates. RUN is unique per run and is the Station.source of the fixtures.
const PREFIX = "t0-02-snapshot-test-";
const RUN = `${PREFIX}${randomUUID()}`;

// A cycle start far in the future: rows already in the database, or inserted by other test files
// running in parallel against it, all have a much older lastSynced, so they can never be picked up
// and the exact counts below hold on a non-empty database. Boundary cases are offsets from it.
const CYCLE_START = new Date("2099-06-01T00:00:00.000Z");
const at = (offsetMs: number) => new Date(CYCLE_START.getTime() + offsetMs);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const connector = (type: ConnectorType, powerKw: number, currentType: CurrentType, status: ConnectorStatus) => ({
  type,
  powerKw,
  currentType,
  status,
});
const tuple = (type: string, powerKw: number | null, currentType: string, status: string) =>
  `${type}|${powerKw}|${currentType}|${status}`;

describe("captureSnapshots only records stations saved this cycle (real Postgres)", () => {
  let db: (typeof import("@/lib/db"))["db"];
  let captureSnapshots: (typeof import("@/services/analytics/snapshotCapture"))["captureSnapshots"];

  /** Deletes only rows this file created: stations by source prefix (cascades to their connectors and
   * snapshots) and snapshots by syncSource prefix (covers snapshots of stations that are not ours). */
  async function purge() {
    await db.stationSnapshot.deleteMany({ where: { syncSource: { startsWith: PREFIX } } });
    await db.station.deleteMany({ where: { source: { startsWith: PREFIX } } });
  }

  // Hooks run even when every test is skipped, so they must be inert without a database.
  before(async () => {
    if (!TEST_DATABASE_URL) return;
    ({ db } = await import("@/lib/db"));
    ({ captureSnapshots } = await import("@/services/analytics/snapshotCapture"));
    await purge(); // leftovers of a run that crashed before its own cleanup
  });

  after(async () => {
    if (db) await purge();
  });

  describe("with stations on both sides of the cycle start", () => {
    const id = {} as Record<"recentAfter" | "recentAtCutoff" | "recentNoConnectors" | "staleJustBefore" | "staleOld", string>;

    async function createStation(
      key: string,
      lastSynced: Date,
      status: StationStatus,
      connectors: ReturnType<typeof connector>[],
    ): Promise<string> {
      const row = await db.station.create({
        data: {
          source: RUN,
          externalId: key,
          name: `T0-02 ${key}`,
          address: "T0-02 test address",
          latitude: 12.9716,
          longitude: 77.5946,
          status,
          lastSynced,
          connectors: { create: connectors },
        },
      });
      return row.id;
    }

    before(async () => {
      if (!TEST_DATABASE_URL) return;
      // Saved this cycle (lastSynced >= CYCLE_START): must be captured.
      id.recentAfter = await createStation("recent-after", at(HOUR), "AVAILABLE", [
        connector("CCS2", 60, "DC", "AVAILABLE"),
        connector("TYPE2", 7.4, "AC", "OCCUPIED"),
      ]);
      id.recentAtCutoff = await createStation("recent-at-cutoff", at(0), "OCCUPIED", [
        connector("CHADEMO", 50, "DC", "FAULTED"),
        connector("CCS2", 120, "DC", "AVAILABLE"),
      ]);
      id.recentNoConnectors = await createStation("recent-no-connectors", at(2 * HOUR), "UNKNOWN", []);
      // Not saved this cycle (source failed or station vanished): must be skipped.
      id.staleJustBefore = await createStation("stale-1ms-before", at(-1), "AVAILABLE", [
        connector("CCS2", 30, "DC", "AVAILABLE"),
      ]);
      id.staleOld = await createStation("stale-30-days", at(-30 * DAY), "OFFLINE", [
        connector("TYPE2", 22, "AC", "UNKNOWN"),
        connector("BHARAT_DC", 15, "DC", "FAULTED"),
      ]);
    });

    // Far-future rows must not outlive these tests: a later, real-time capture would pick them up.
    after(async () => {
      if (db) await purge();
    });

    it("records exactly the stations with lastSynced >= since, with their connectors, and returns that count", dbTest, async () => {
      const syncSource = `${RUN}:cycle`;

      const returned = await captureSnapshots(syncSource, CYCLE_START);

      const snapshots = await db.stationSnapshot.findMany({
        where: { syncSource },
        include: { connectorSnapshots: true },
      });
      const recorded = new Map(
        snapshots.map((s) => [
          s.stationId,
          {
            status: s.status,
            connectors: s.connectorSnapshots.map((c) => tuple(c.connectorType, c.powerKw, c.currentType, c.status)).sort(),
          },
        ]),
      );

      // One snapshot per recent station (the one saved exactly at `since` included, the one 1 ms
      // before it excluded), each with the status and connectors as stored.
      assert.deepEqual(
        recorded,
        new Map([
          [id.recentAfter, { status: "AVAILABLE", connectors: ["CCS2|60|DC|AVAILABLE", "TYPE2|7.4|AC|OCCUPIED"] }],
          [id.recentAtCutoff, { status: "OCCUPIED", connectors: ["CCS2|120|DC|AVAILABLE", "CHADEMO|50|DC|FAULTED"] }],
          [id.recentNoConnectors, { status: "UNKNOWN", connectors: [] }],
        ]),
      );
      assert.equal(snapshots.length, 3, "each station is recorded once");
      // 3 stations but 4 connectors, so this cannot pass by returning the connector count.
      assert.equal(returned, 3, "the return value is the number of station snapshots written");

      // DATA-5: a station not saved this cycle is never recorded as a fresh observation.
      const staleIds = [id.staleJustBefore, id.staleOld];
      assert.equal(await db.stationSnapshot.count({ where: { stationId: { in: staleIds } } }), 0);
      assert.equal(await db.connectorSnapshot.count({ where: { stationSnapshot: { stationId: { in: staleIds } } } }), 0);
    });

    it("records nothing and returns 0 when no station was saved this cycle", dbTest, async () => {
      const syncSource = `${RUN}:empty`;

      // Every fixture station exists but is older than this cycle start: the "all sources failed" case.
      const returned = await captureSnapshots(syncSource, at(DAY));

      assert.equal(returned, 0);
      assert.equal(await db.stationSnapshot.count({ where: { syncSource } }), 0);
      assert.equal(await db.connectorSnapshot.count({ where: { stationSnapshot: { syncSource } } }), 0);
    });
  });

  it("integration: a station re-saved by saveToDatabase this cycle is captured with its new status, one that was not is skipped", dbTest, async () => {
    // captureSnapshots depends on saveToDatabase refreshing lastSynced on EVERY successful save,
    // including the update of an existing row. If it ever stops, no existing station would be
    // snapshotted again and the behaviour dataset would silently dry up.
    const { DeduplicationEngine } = await import("@/services/aggregator/dedupe");
    const syncSource = `${RUN}:integration`;
    const sourceA = `${RUN}:source-a`; // scrapes fine in cycle 2
    const sourceB = `${RUN}:source-b`; // fails in cycle 2: its station is not saved again
    const scraped = (source: string, status: StationStatus): ScrapedStation => ({
      externalId: "station-1",
      source,
      name: `T0-02 ${source}`,
      address: "T0-02 test address",
      latitude: 12.9716,
      longitude: 77.5946,
      status,
      amenities: [],
      connectors: [{ type: "CCS2", powerKw: 60, currentType: "DC", status: "AVAILABLE" }],
    });

    // Cycle 1: both sources succeed, so both stations are created.
    assert.equal(await DeduplicationEngine.saveToDatabase([scraped(sourceA, "AVAILABLE"), scraped(sourceB, "AVAILABLE")]), 0);
    await sleep(50); // lastSynced has millisecond precision: keep cycle 2 strictly after cycle 1

    // Cycle 2: source A re-saves its existing station with a new status, source B saves nothing.
    const cycleStart = new Date();
    assert.equal(await DeduplicationEngine.saveToDatabase([scraped(sourceA, "OFFLINE")]), 0);
    await captureSnapshots(syncSource, cycleStart);

    // Only our two stations are inspected: other rows saved in the same window may be captured too.
    const snapshots = await db.stationSnapshot.findMany({
      where: { syncSource, station: { source: { in: [sourceA, sourceB] } } },
      include: { station: true },
    });
    assert.deepEqual(
      snapshots.map((s) => [s.station.source, s.status]),
      [[sourceA, "OFFLINE"]],
    );
  });
});
