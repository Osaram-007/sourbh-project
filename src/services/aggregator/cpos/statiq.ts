import { ScrapedStation, ScrapedConnector, ScraperEngine } from "../types";
import { db } from "@/lib/db";
import { ConnectorType, CurrentType, StationStatus, ConnectorStatus } from "@prisma/client";

// Helper function to fetch items in parallel chunks to prevent rate limits or server overload
async function batchFetch<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const chunkPromises = chunk.map(fn);
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
    if (i % (batchSize * 10) === 0 && i > 0) {
      console.log(`[Statiq Scraper] Fetched details for ${results.length}/${items.length} stations...`);
    }
  }
  return results;
}

export class StatiqScraper implements ScraperEngine {
  name = "statiq";

  async scrape(): Promise<ScrapedStation[]> {
    console.log("Starting Statiq Scraper using public markers API...");

    const url = "https://backend.statiq.co.in/station/v1/markers";
    const headers = {
      "Content-Type": "application/json",
      "company-id": "90"
    };

    // Bounding box covering all of India's geographic territory
    const body = {
      latitude: 20.5937,
      longitude: 78.9629,
      all_chargers: 0,
      connector_id: [],
      vertices: [
        [68.0, 38.0],
        [98.0, 38.0],
        [98.0, 7.0],
        [68.0, 7.0],
        [68.0, 38.0]
      ]
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Statiq markers API responded with status ${response.status}`);
      }

      const rawData = await response.json();
      const rawStations = rawData.data?.stations;

      if (!Array.isArray(rawStations)) {
        throw new Error("Invalid Statiq response format");
      }

      console.log(`Retrieved ${rawStations.length} station markers. Fetching details in batches...`);

      // Fetch details for each station marker in parallel batches
      const fetchDetails = async (marker: any) => {
        try {
          const detailRes = await fetch("https://backend.statiq.co.in/station/v1/details", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "company-id": "90"
            },
            body: JSON.stringify({
              latitude: 0,
              longitude: 0,
              station_id: marker.station_id
            })
          });
          if (!detailRes.ok) return null;
          const detailData = await detailRes.json();
          return detailData.data?.station_detail || null;
        } catch (err) {
          console.warn(`Failed to fetch details for station ${marker.station_id}:`, err);
          return null;
        }
      };

      // Query with a safe concurrency level of 50 to avoid rate limiting
      const allDetails = await batchFetch(rawStations, 50, fetchDetails);

      const stations: ScrapedStation[] = [];
      for (const item of allDetails) {
        if (!item) continue;

        const connectors: ScrapedConnector[] = [];
        for (const charger of (item.plugin_details || [])) {
          const powerKw = parseFloat(charger.power_rating) || 50;
          const pricing = parseFloat(charger.price) || undefined;
          for (const c of (charger.connectors || [])) {
            connectors.push({
              externalId: String(c.connector_id),
              type: this.mapConnectorType(c.connector_type),
              powerKw,
              currentType: this.mapCurrentType(c.connector_type),
              status: c.connector_status === "available" ? ConnectorStatus.AVAILABLE : ConnectorStatus.OCCUPIED,
              pricing,
            });
          }
        }

        // Map status
        let status: StationStatus = StationStatus.UNKNOWN;
        if (item.availability === "Available" || item.closing_status?.text?.toLowerCase().includes("open")) {
          status = StationStatus.AVAILABLE;
        } else if (item.availability === "Unavailable") {
          status = StationStatus.OFFLINE;
        }

        stations.push({
          externalId: String(item.id),
          source: "statiq",
          name: item.station_name || "Statiq Charging Hub",
          operator: "Statiq",
          address: item.address || item.area || "Statiq Charging Station",
          city: item.station_city_name || undefined,
          latitude: parseFloat(item.latitude),
          longitude: parseFloat(item.longitude),
          status,
          imageUrl: item.station_image_url || undefined,
          operatingHours: item.operational_time || undefined,
          amenities: (item.amenities_icon || []).map((a: any) => a.type.toUpperCase()),
          pricingInfo: item.plugin_details?.[0]?.price_with_currency || undefined,
          connectors,
        });
      }

      console.log(`Statiq Scraper complete. Processed ${stations.length} stations.`);
      return stations;
    } catch (error: any) {
      console.error("Error scraping Statiq:", error);
      throw error;
    }
  }

  private mapConnectorType(typeStr: string): ConnectorType {
    if (!typeStr) return ConnectorType.CCS2;
    const s = typeStr.toLowerCase();
    if (s.includes("ccs")) return ConnectorType.CCS2;
    if (s.includes("type2") || s.includes("type 2")) return ConnectorType.TYPE2;
    if (s.includes("chademo")) return ConnectorType.CHADEMO;
    if (s.includes("gbt") || s.includes("gb/t")) return ConnectorType.GB_T;
    if (s.includes("bharat ac")) return ConnectorType.BHARAT_AC;
    if (s.includes("bharat dc")) return ConnectorType.BHARAT_DC;
    return ConnectorType.CCS2;
  }

  private mapCurrentType(typeStr: string): CurrentType {
    if (!typeStr) return CurrentType.DC;
    const s = typeStr.toLowerCase();
    if (s.includes("ac") || s.includes("type2")) return CurrentType.AC;
    return CurrentType.DC;
  }

  private getRealSeedStations(): ScrapedStation[] {
    return [];
  }
}
