import { ScrapedStation, ScrapedConnector, ScraperEngine } from "./types";
import { ConnectorType, CurrentType, StationStatus, ConnectorStatus } from "@prisma/client";

export class OsmScraper implements ScraperEngine {
  name = "osm";

  async scrape(): Promise<ScrapedStation[]> {
    console.log("Starting OSM Overpass Scraper...");
    
    // Query to find charging stations in India
    const overpassQuery = `
      [out:json][timeout:180];
      area["ISO3166-1"="IN"]->.searchArea;
      (
        node["amenity"="charging_station"](area.searchArea);
        way["amenity"="charging_station"](area.searchArea);
      );
      out center;
    `;

    const url = "https://overpass-api.de/api/interpreter";

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "FullChargeEV/1.0 (EV Charger Discovery Platform)"
        },
        body: `data=${encodeURIComponent(overpassQuery)}`
      });
      if (!response.ok) {
        throw new Error(`OSM Overpass API responded with status ${response.status}`);
      }

      const data = await response.json();
      if (!data || !Array.isArray(data.elements)) {
        throw new Error("Invalid OSM Overpass response format");
      }

      console.log(`Fetched ${data.elements.length} elements from OSM.`);
      const stations: ScrapedStation[] = [];

      for (const element of data.elements) {
        // Coordinate parsing: elements of type 'node' have 'lat' and 'lon', ways have 'center'
        const latitude = element.lat ?? element.center?.lat;
        const longitude = element.lon ?? element.center?.lon;

        if (typeof latitude !== "number" || typeof longitude !== "number") {
          continue;
        }

        const tags = element.tags || {};
        const connectors: ScrapedConnector[] = this.parseConnectors(tags);

        // Address construction
        const addressParts = [
          tags["addr:housenumber"],
          tags["addr:street"],
          tags["addr:suburb"],
          tags["addr:district"],
        ].filter(Boolean);

        const address = addressParts.length > 0 
          ? addressParts.join(", ") 
          : tags["description"] || tags["operator"] || "EV Charging Station, India";

        stations.push({
          externalId: String(element.id),
          source: "osm",
          name: tags["name"] || tags["operator"] 
            ? `${tags["operator"] || ""} ${tags["name"] || "Charging Station"}`.trim()
            : `EV Charging Station #${element.id}`,
          operator: tags["operator"] || "Independent",
          address,
          city: tags["addr:city"] || undefined,
          state: tags["addr:state"] || undefined,
          pincode: tags["addr:postcode"] || undefined,
          latitude,
          longitude,
          status: StationStatus.UNKNOWN, // OSM data is static
          imageUrl: undefined,
          operatingHours: tags["opening_hours"] || undefined,
          amenities: this.parseAmenities(tags),
          pricingInfo: tags["fee"] === "yes" ? "Fee applies" : (tags["fee"] === "no" ? "Free" : undefined),
          connectors,
        });
      }

      return stations;
    } catch (error) {
      console.error("Error scraping OSM:", error);
      throw error;
    }
  }

  private parseConnectors(tags: any): ScrapedConnector[] {
    const connectors: ScrapedConnector[] = [];

    // Mappings of standard OSM keys for sockets to our ConnectorType
    const socketMappings = [
      { key: "socket:ccs2", type: ConnectorType.CCS2, current: CurrentType.DC },
      { key: "socket:chademo", type: ConnectorType.CHADEMO, current: CurrentType.DC },
      { key: "socket:type2", type: ConnectorType.TYPE2, current: CurrentType.AC },
      { key: "socket:type2_cable", type: ConnectorType.TYPE2, current: CurrentType.AC },
      { key: "socket:gbt", type: ConnectorType.GB_T, current: CurrentType.DC },
      { key: "socket:schuko", type: ConnectorType.WALL_SOCKET, current: CurrentType.AC },
      { key: "socket:bharat_ac", type: ConnectorType.BHARAT_AC, current: CurrentType.AC },
      { key: "socket:bharat_dc", type: ConnectorType.BHARAT_DC, current: CurrentType.DC },
    ];

    let totalParsedFromSockets = 0;

    for (const mapping of socketMappings) {
      const countVal = tags[mapping.key];
      if (countVal) {
        const count = parseInt(countVal, 10);
        if (!isNaN(count) && count > 0) {
          totalParsedFromSockets += count;
          // Look for power rating (e.g., socket:ccs2:output = 50kW or output = 50)
          const outputKey = `${mapping.key}:output`;
          let powerKw: number | undefined;
          if (tags[outputKey]) {
            const parsedOutput = parseFloat(tags[outputKey]);
            if (!isNaN(parsedOutput)) powerKw = parsedOutput;
          }

          for (let i = 0; i < count; i++) {
            connectors.push({
              externalId: `${mapping.key}-${i}`,
              type: mapping.type,
              powerKw,
              currentType: mapping.current,
              status: ConnectorStatus.UNKNOWN,
            });
          }
        }
      }
    }

    // Fallback: If no sockets are parsed but capacity is specified, generate default connectors
    if (connectors.length === 0 && tags["capacity"]) {
      const capacity = parseInt(tags["capacity"], 10);
      if (!isNaN(capacity) && capacity > 0) {
        // Try to guess from text tags or default to Wall Socket
        for (let i = 0; i < capacity; i++) {
          connectors.push({
            externalId: `cap-${i}`,
            type: ConnectorType.WALL_SOCKET,
            currentType: CurrentType.AC,
            status: ConnectorStatus.UNKNOWN,
          });
        }
      }
    }

    // absolute fallback: at least one wall socket connector
    if (connectors.length === 0) {
      connectors.push({
        externalId: "default",
        type: ConnectorType.WALL_SOCKET,
        currentType: CurrentType.AC,
        status: ConnectorStatus.UNKNOWN,
      });
    }

    return connectors;
  }

  private parseAmenities(tags: any): string[] {
    const amenities: string[] = [];
    
    // Guess amenities from location tags
    const location = String(tags["location"] || "").toLowerCase();
    if (location.includes("parking") || tags["parking"]) {
      amenities.push("PARKING");
    }
    
    // Check surrounding tags
    if (tags["toilets"] === "yes") {
      amenities.push("RESTROOMS");
    }
    if (tags["food"] === "yes" || tags["cafe"] === "yes" || tags["restaurant"] === "yes") {
      amenities.push("FOOD_COURT");
    }

    return amenities;
  }
}
