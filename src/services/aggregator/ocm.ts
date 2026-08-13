import { ScrapedStation, ScrapedConnector, ScraperEngine } from "./types";
import { ConnectorType, CurrentType, StationStatus, ConnectorStatus } from "@prisma/client";

export class OcmScraper implements ScraperEngine {
  name = "ocm";
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.OCM_API_KEY || "";
  }

  async scrape(): Promise<ScrapedStation[]> {
    console.log("Starting OCM Scraper...");
    if (!this.apiKey) {
      console.warn("Warning: OCM_API_KEY is not defined. Scraping might return limited results or fail.");
    }

    const url = `https://api.openchargemap.org/v3/poi/?output=json&countrycode=IN&maxresults=5000&compact=true&verbose=false&key=${this.apiKey}`;
    
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        throw new Error(`OCM API responded with status ${response.status}`);
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("Invalid OCM API response format: expected an array");
      }

      console.log(`Fetched ${data.length} POIs from OCM.`);
      const stations: ScrapedStation[] = [];

      for (const poi of data) {
        if (!poi.AddressInfo || typeof poi.AddressInfo.Latitude !== "number" || typeof poi.AddressInfo.Longitude !== "number") {
          continue;
        }

        const addressInfo = poi.AddressInfo;
        const connectors: ScrapedConnector[] = [];

        if (Array.isArray(poi.Connections)) {
          for (const conn of poi.Connections) {
            const type = this.mapConnectorType(conn.ConnectionType);
            const currentType = this.mapCurrentType(conn.CurrentType, type);
            const status = this.mapConnectorStatus(conn.StatusType);

            connectors.push({
              externalId: conn.ID ? String(conn.ID) : undefined,
              type,
              powerKw: typeof conn.PowerKW === "number" ? conn.PowerKW : undefined,
              currentType,
              status,
              pricing: typeof conn.Price === "number" ? conn.Price : undefined,
            });
          }
        }

        const status = this.mapStationStatus(poi.StatusType, connectors);

        stations.push({
          externalId: String(poi.ID),
          source: "ocm",
          name: addressInfo.Title || "EV Charging Station",
          operator: poi.OperatorInfo?.Title || "Independent",
          address: [
            addressInfo.AddressLine1,
            addressInfo.AddressLine2,
            addressInfo.AccessComments
          ].filter(Boolean).join(", ") || "No Address Provided",
          city: addressInfo.Town || undefined,
          state: addressInfo.StateOrProvince || undefined,
          pincode: addressInfo.Postcode || undefined,
          latitude: addressInfo.Latitude,
          longitude: addressInfo.Longitude,
          status,
          imageUrl: undefined,
          operatingHours: addressInfo.AccessComments || undefined,
          amenities: [], // OCM does not expose standard structured amenities list
          pricingInfo: poi.UsageCost || undefined,
          connectors,
        });
      }

      return stations;
    } catch (error) {
      console.error("Error scraping OCM:", error);
      throw error;
    }
  }

  private mapConnectorType(connType: any): ConnectorType {
    if (!connType) return ConnectorType.WALL_SOCKET;
    const title = String(connType.Title || "").toLowerCase();
    const id = connType.ID;

    // Standard OCM IDs or Titles
    if (id === 33 || title.includes("ccs") || title.includes("combo")) {
      return ConnectorType.CCS2;
    }
    if (id === 2 || title.includes("chademo")) {
      return ConnectorType.CHADEMO;
    }
    if (id === 25 || title.includes("type 2") || title.includes("mennekes")) {
      return ConnectorType.TYPE2;
    }
    if (id === 1 || title.includes("type 1")) {
      return ConnectorType.TYPE1;
    }
    if (id === 1036 || title.includes("gb/t") || title.includes("gbt")) {
      return ConnectorType.GB_T;
    }
    if (title.includes("bharat ac") || title.includes("ac-001")) {
      return ConnectorType.BHARAT_AC;
    }
    if (title.includes("bharat dc") || title.includes("dc-001")) {
      return ConnectorType.BHARAT_DC;
    }
    if (id === 1039 || title.includes("wall") || title.includes("bs1363")) {
      return ConnectorType.WALL_SOCKET;
    }

    // Default heuristics based on title
    if (title.includes("type2")) return ConnectorType.TYPE2;
    if (title.includes("ccs2")) return ConnectorType.CCS2;

    return ConnectorType.WALL_SOCKET;
  }

  private mapCurrentType(currentType: any, connType: ConnectorType): CurrentType {
    if (currentType) {
      const id = currentType.ID;
      const title = String(currentType.Title || "").toLowerCase();
      if (id === 30 || title.includes("dc")) return CurrentType.DC;
      if (id === 10 || title.includes("dc")) return CurrentType.DC;
      if (id === 20 || title.includes("ac")) return CurrentType.AC;
    }

    // Heuristics based on connector type
    if (([ConnectorType.CCS2, ConnectorType.CHADEMO, ConnectorType.GB_T, ConnectorType.BHARAT_DC] as ConnectorType[]).includes(connType)) {
      return CurrentType.DC;
    }
    return CurrentType.AC;
  }

  private mapConnectorStatus(statusType: any): ConnectorStatus {
    if (!statusType) return ConnectorStatus.UNKNOWN;
    
    if (statusType.IsOperational === true) {
      return ConnectorStatus.AVAILABLE;
    }
    if (statusType.IsOperational === false) {
      return ConnectorStatus.FAULTED;
    }

    const title = String(statusType.Title || "").toLowerCase();
    if (title.includes("available") || title.includes("operational")) return ConnectorStatus.AVAILABLE;
    if (title.includes("occupied")) return ConnectorStatus.OCCUPIED;
    if (title.includes("broken") || title.includes("faulted") || title.includes("out of service")) return ConnectorStatus.FAULTED;

    return ConnectorStatus.UNKNOWN;
  }

  private mapStationStatus(statusType: any, connectors: ScrapedConnector[]): StationStatus {
    if (connectors.some(c => c.status === ConnectorStatus.OCCUPIED)) {
      return StationStatus.OCCUPIED;
    }
    if (connectors.length > 0 && connectors.every(c => c.status === ConnectorStatus.FAULTED)) {
      return StationStatus.OFFLINE;
    }

    if (!statusType) return StationStatus.UNKNOWN;

    if (statusType.IsOperational === true) {
      return StationStatus.AVAILABLE;
    }
    if (statusType.IsOperational === false) {
      return StationStatus.OFFLINE;
    }

    const title = String(statusType.Title || "").toLowerCase();
    if (title.includes("available") || title.includes("operational")) return StationStatus.AVAILABLE;
    if (title.includes("occupied")) return StationStatus.OCCUPIED;
    if (title.includes("offline") || title.includes("broken") || title.includes("out of service")) return StationStatus.OFFLINE;

    return StationStatus.UNKNOWN;
  }
}
