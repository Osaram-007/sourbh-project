// Standalone data-collection process — run under its own systemd unit
// (see deploy/systemd/full-charge-sync.service) so scraping keeps running
// independent of the web app process.
//
// dotenv must load via a plain `import` (not a function call sandwiched
// between imports) — ES module imports are hoisted and fully executed
// before any of this file's own code runs, so `initAutoSync`'s import chain
// (which reaches src/lib/db.ts and builds the pg Pool from DATABASE_URL at
// module-load time) would otherwise run before .env is loaded at all.
import "dotenv/config";
import { initAutoSync } from "../src/services/aggregator/autoSync";

console.log("[SyncWorker] Starting standalone sync worker...");
initAutoSync();
