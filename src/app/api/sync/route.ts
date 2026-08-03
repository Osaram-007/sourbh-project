import { NextRequest, NextResponse } from "next/server";
import { OcmScraper } from "@/services/aggregator/ocm";
import { OsmScraper } from "@/services/aggregator/osm";
import { EvYatraScraper } from "@/services/aggregator/evyatra";
import { TataPowerScraper } from "@/services/aggregator/cpos/tataPower";
import { AtherGridScraper } from "@/services/aggregator/cpos/atherGrid";
import { StatiqScraper } from "@/services/aggregator/cpos/statiq";
import { DeduplicationEngine } from "@/services/aggregator/dedupe";
import { ScrapedStation } from "@/services/aggregator/types";

export const maxDuration = 300; // Allow API route to run up to 5 minutes on Vercel Pro/Enterprise or custom server

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("x-sync-secret");
    const secretKey = process.env.SYNC_SECRET_KEY;

    if (!secretKey || authHeader !== secretKey) {
      return NextResponse.json({ error: "Unauthorized. Invalid sync secret key." }, { status: 401 });
    }

    console.log("Triggering EV charger database synchronization...");
    
    // Instantiate all scrapers
    const scrapers = [
      new OcmScraper(),
      new OsmScraper(),
      new EvYatraScraper(),
      new TataPowerScraper(),
      new AtherGridScraper(),
      new StatiqScraper()
    ];

    const results: { name: string; count: number; status: string }[] = [];
    let combinedStations: ScrapedStation[] = [];

    // Run scrapers sequentially to prevent rate limits and coordinate memory usage on Render/Vercel
    for (const scraper of scrapers) {
      try {
        console.log(`Executing scraper: ${scraper.name}...`);
        const stations = await scraper.scrape();
        combinedStations = combinedStations.concat(stations);
        results.push({ name: scraper.name, count: stations.length, status: "Success" });
      } catch (err: any) {
        console.error(`Scraper ${scraper.name} failed:`, err);
        results.push({ name: scraper.name, count: 0, status: `Failed: ${err.message}` });
      }
    }

    const totalRaw = combinedStations.length;
    console.log(`Deduplicating total of ${totalRaw} stations...`);

    // Run deduplication
    const deduplicated = DeduplicationEngine.deduplicate(combinedStations);
    const totalDeduplicated = deduplicated.length;

    // Save to PostgreSQL PostGIS database
    await DeduplicationEngine.saveToDatabase(deduplicated);

    return NextResponse.json({
      success: true,
      summary: {
        totalRaw,
        totalDeduplicated,
        sources: results
      },
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("API error during manual synchronization:", error);
    return NextResponse.json({ error: "Internal sync error", message: error.message }, { status: 500 });
  }
}
