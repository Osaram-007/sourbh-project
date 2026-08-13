import { ScrapedStation, ScrapedConnector, ScraperEngine } from "./types";
import { ConnectorType, CurrentType, StationStatus, ConnectorStatus } from "@prisma/client";

export class EvYatraScraper implements ScraperEngine {
  name = "evyatra";

  async scrape(): Promise<ScrapedStation[]> {
    console.log("Starting BEE EV Yatra Scraper...");
    
    // Official BEE EV Yatra public JSON endpoint
    const url = "https://evyatra.beeindia.gov.in/bee-ev-web-api/rest/private/chargingStation/public/list";

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        signal: AbortSignal.timeout(30000),
        next: { revalidate: 3600 } // Cache for 1 hour in Next.js
      });

      if (!response.ok) {
        throw new Error(`BEE EV Yatra API responded with status ${response.status}`);
      }

      const data = await response.json();
      const stationsList = data.data || data;

      if (!Array.isArray(stationsList)) {
        throw new Error("Invalid EV Yatra API response: expected an array in data field");
      }

      console.log(`Fetched ${stationsList.length} stations from BEE EV Yatra.`);
      const stations: ScrapedStation[] = [];

      for (const item of stationsList) {
        const latitude = parseFloat(item.latitude);
        const longitude = parseFloat(item.longitude);

        if (isNaN(latitude) || isNaN(longitude) || latitude === 0 || longitude === 0) {
          continue;
        }

        // Parse connectors list if available
        const connectors: ScrapedConnector[] = [];
        if (Array.isArray(item.connectors)) {
          for (const conn of item.connectors) {
            connectors.push({
              externalId: conn.connectorId ? String(conn.connectorId) : undefined,
              type: this.mapConnectorType(conn.connectorType),
              powerKw: parseFloat(conn.capacity) || undefined,
              currentType: this.mapCurrentType(conn.connectorType),
              status: conn.status === "Available" ? ConnectorStatus.AVAILABLE : ConnectorStatus.UNKNOWN,
            });
          }
        }

        // No fallback default connector: if the API doesn't specify connectors, we don't know
        // the hardware present, so leave the array empty rather than inventing it.

        stations.push({
          externalId: String(item.chargingStationId || item.id),
          source: "evyatra",
          name: item.stationName || "BEE Charging Station",
          operator: item.cpoName || item.agencyName || "BEE Aggregated",
          address: item.address || "India",
          city: item.cityName || undefined,
          state: item.stateName || undefined,
          pincode: item.pincode || undefined,
          latitude,
          longitude,
          // "Active" only means the station is commissioned/registered with BEE, not that a
          // connector is currently free. There is no genuine live-availability field in this
          // payload, so we don't fabricate one.
          status: StationStatus.UNKNOWN,
          imageUrl: undefined,
          operatingHours: item.workingTime || undefined,
          amenities: [],
          pricingInfo: item.tariff ? `₹${item.tariff}/unit` : undefined,
          connectors,
        });
      }

      return stations;
    } catch (error) {
      // A failed source must contribute zero rows, never fabricated ones. Rethrow so
      // autoSync.ts records this as a genuine "Failed" scrape instead of masking it.
      console.warn("Failed to fetch live BEE EV Yatra data.", error);
      throw error;
    }
  }

  private mapConnectorType(typeStr: string): ConnectorType {
    if (!typeStr) return ConnectorType.WALL_SOCKET;
    const s = typeStr.toLowerCase();

    if (s.includes("ccs") || s.includes("combo")) return ConnectorType.CCS2;
    if (s.includes("chademo")) return ConnectorType.CHADEMO;
    if (s.includes("type 2") || s.includes("type2")) return ConnectorType.TYPE2;
    if (s.includes("gb/t") || s.includes("gbt")) return ConnectorType.GB_T;
    if (s.includes("bharat ac") || s.includes("ac001") || s.includes("ac 001")) return ConnectorType.BHARAT_AC;
    if (s.includes("bharat dc") || s.includes("dc001") || s.includes("dc 001")) return ConnectorType.BHARAT_DC;
    if (s.includes("wall") || s.includes("socket") || s.includes("plug")) return ConnectorType.WALL_SOCKET;

    return ConnectorType.WALL_SOCKET;
  }

  private mapCurrentType(typeStr: string): CurrentType {
    if (!typeStr) return CurrentType.AC;
    const s = typeStr.toLowerCase();
    if (s.includes("dc") || s.includes("ccs") || s.includes("chademo") || s.includes("gbt")) {
      return CurrentType.DC;
    }
    return CurrentType.AC;
  }
}
