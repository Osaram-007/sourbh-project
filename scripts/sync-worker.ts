// Standalone data-collection process — run under its own systemd unit
// (see deploy/systemd/full-charge-sync.service) so scraping keeps running
// independent of the web app process.
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { initAutoSync } from "../src/services/aggregator/autoSync";

console.log("[SyncWorker] Starting standalone sync worker...");
initAutoSync();
