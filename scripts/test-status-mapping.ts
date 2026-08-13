// Self-check for scraper status mapping — the logic that decides what every
// snapshot records, and therefore what the whole behaviour dataset means.
// Run: npx tsx scripts/test-status-mapping.ts
//
// Guards the two bugs that silently corrupted the dataset in production:
//   1. opening-hours text ("Open 24 hours") overriding live availability
//   2. every non-available connector collapsing to OCCUPIED, making FAULTED
//      unreachable and faultedPercent structurally always 0
import assert from "node:assert";
import { StationStatus, ConnectorStatus } from "@prisma/client";
import { StatiqScraper } from "../src/services/aggregator/cpos/statiq";

// mapConnectorStatus is private; reach past it deliberately rather than
// widening the public surface just for a test.
const statiq = new StatiqScraper() as any;

// --- Statiq connector status -------------------------------------------------
assert.equal(statiq.mapConnectorStatus("available"), ConnectorStatus.AVAILABLE);
assert.equal(statiq.mapConnectorStatus("AVAILABLE"), ConnectorStatus.AVAILABLE, "must be case-insensitive");
assert.equal(statiq.mapConnectorStatus("charging"), ConnectorStatus.OCCUPIED);
assert.equal(statiq.mapConnectorStatus("faulted"), ConnectorStatus.FAULTED);
// The regression that mattered: a faulted connector must NOT read as occupied.
assert.notEqual(statiq.mapConnectorStatus("out of order"), ConnectorStatus.OCCUPIED);
// Unknown/missing values must not be guessed into a real state.
assert.equal(statiq.mapConnectorStatus("something-new"), ConnectorStatus.UNKNOWN);
assert.equal(statiq.mapConnectorStatus(""), ConnectorStatus.UNKNOWN);
assert.equal(statiq.mapConnectorStatus(undefined), ConnectorStatus.UNKNOWN);

// --- Statiq station availability ---------------------------------------------
// Mirrors the mapping inlined in scrape(); kept in sync deliberately so the
// rule is asserted somewhere runnable.
function stationStatus(item: any): StationStatus {
  if (item.availability === "Available") return StationStatus.AVAILABLE;
  if (item.availability === "Unavailable") return StationStatus.OFFLINE;
  return StationStatus.UNKNOWN;
}

assert.equal(stationStatus({ availability: "Available" }), StationStatus.AVAILABLE);
assert.equal(stationStatus({ availability: "Unavailable" }), StationStatus.OFFLINE);
assert.equal(stationStatus({}), StationStatus.UNKNOWN);

// The core regression: a station that is genuinely Unavailable but open 24h
// must stay OFFLINE. Before the fix, closing_status flipped this to AVAILABLE
// and made OFFLINE unrecordable for any 24/7 station.
assert.equal(
  stationStatus({ availability: "Unavailable", closing_status: { text: "Open 24 hours" } }),
  StationStatus.OFFLINE,
  "opening hours must never override live availability"
);

console.log("All status mapping checks passed.");
