import { ScrapedStation, ScrapedConnector, ScraperEngine, parseNumeric } from "../types";
import { db } from "@/lib/db";
import { ConnectorType, CurrentType, StationStatus, ConnectorStatus, CredentialStatus } from "@prisma/client";
import { randomUUID } from "crypto";

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
      console.log(`[Tata Power Scraper] Fetched details for ${results.length}/${items.length} stations...`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return results;
}

export class TataPowerScraper implements ScraperEngine {
  name = "tata";

  async scrape(): Promise<ScrapedStation[]> {
    console.log("Starting Tata Power EZ Charge Scraper...");
    
    // 1. Fetch credentials from DB if available.
    // If credentials are found and ACTIVE, we can use the old bearer token endpoint.
    let credentials = null;
    try {
      credentials = await db.cpoCredential.findUnique({
        where: { cpoName: "tata" }
      });
    } catch (e) {
      console.warn("Could not query database for Tata CPO credentials. Running in standalone mode.");
    }

    if (credentials && credentials.status === CredentialStatus.ACTIVE) {
      console.log("Using active Tata Power API credentials from database.");
      return this.scrapeWithCredentials(credentials);
    }

    console.log("Running in public guest scraper mode...");
    return this.scrapePublicGuest();
  }

  private async scrapeWithCredentials(credentials: any): Promise<ScrapedStation[]> {
    const url = "https://ezcharge.tatapower.com/api/v1/stations";
    const headers = {
      "Authorization": `Bearer ${credentials.authToken}`,
      "Accept": "application/json",
      ...(credentials.headers as Record<string, string>)
    };

    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      
      if (response.status === 401 || response.status === 403) {
        await db.cpoCredential.update({
          where: { id: credentials.id },
          data: { status: CredentialStatus.EXPIRED }
        });
        
        await db.crawlerLog.create({
          data: {
            cpoCredentialId: credentials.id,
            statusCode: response.status,
            message: `Authentication failed. Token expired or rejected.`
          }
        });
        throw new Error(`Tata CPO API Authentication failed with code ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(`Tata CPO API responded with status ${response.status}`);
      }

      const rawData = await response.json();
      const rawStations = rawData.stations || rawData;

      if (!Array.isArray(rawStations)) {
        throw new Error("Invalid Tata CPO response format");
      }

      const stations: ScrapedStation[] = [];
      for (const item of rawStations) {
        const connectors: ScrapedConnector[] = (item.connectors || []).map((c: any) => ({
          externalId: String(c.id),
          type: this.mapConnectorType(c.type || c.connectorType),
          powerKw: parseNumeric(c.power),
          currentType: this.mapCurrentType(c.type || c.connectorType),
          status: c.isAvailable ? ConnectorStatus.AVAILABLE : ConnectorStatus.OCCUPIED,
          pricing: parseFloat(c.rate) || undefined,
        }));

        stations.push({
          externalId: String(item.id),
          source: "tata",
          name: item.name || "Tata Power EZ Charge",
          operator: "Tata Power",
          address: item.address || "Tata EV Charging Hub",
          city: item.city || undefined,
          state: item.state || undefined,
          pincode: item.pincode || undefined,
          latitude: parseFloat(item.latitude),
          longitude: parseFloat(item.longitude),
          status: item.isActive ? StationStatus.AVAILABLE : StationStatus.OFFLINE,
          imageUrl: item.image || undefined,
          operatingHours: item.timing || undefined,
          amenities: item.amenities || [],
          pricingInfo: item.pricingText || undefined,
          connectors,
        });
      }

      return stations;
    } catch (error: any) {
      console.error("Error scraping Tata Power with credentials:", error);
      await db.crawlerLog.create({
        data: {
          cpoCredentialId: credentials.id,
          statusCode: 500,
          message: `Crawler failed: ${error.message}`
        }
      }).catch(() => {});
      throw error;
    }
  }

  private async scrapePublicGuest(): Promise<ScrapedStation[]> {
    const listUrl = `https://ezcharge.tatapower.com/HobsIntegration/syncRequestHandler?transid=${randomUUID()}&service=GET_CHARGING_STATIONS_ALL`;
    
    const headers = {
      "Content-Type": "application/json",
      "Authorization": "Basic NDUzNDY5VFBMOnNhZG1wd2Q=",
      "sessionid": ""
    };

    const listBody = {
      "userid": "",
      "latitude": "",
      "longitude": "",
      "profileid": "PUBLIC",
      "profileType": "PUBLIC",
      "filter": {
        "radius": "",
        "connector_type": "ALL",
        "connector_standard": [],
        "availability": "",
        "free_chargers": "",
        "amenities": [],
        "tariff_name": []
      }
    };

    console.log("Fetching all Tata Power stations...");
    const listRes = await fetch(listUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(listBody),
      signal: AbortSignal.timeout(15000)
    });

    if (!listRes.ok) {
      throw new Error(`Failed to fetch Tata stations list: ${listRes.statusText}`);
    }

    const listData = await listRes.json();
    const rawStations = listData.chargingStations;

    if (!Array.isArray(rawStations)) {
      throw new Error("Invalid Tata chargingStations list response format");
    }

    console.log(`Discovered ${rawStations.length} Tata stations. Fetching detailed connector configurations in batches...`);

    const fetchDetails = async (station: any) => {
      try {
        const detailsUrl = `https://ezcharge.tatapower.com/HobsIntegration/syncRequestHandler?transid=${randomUUID()}&service=GET_CHARGE_STATION_DETAILS_GUEST`;
        const detailsRes = await fetch(detailsUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            locationid: station.station_code
          }),
          signal: AbortSignal.timeout(15000)
        });

        if (!detailsRes.ok) return null;
        const detailsData = await detailsRes.json();
        
        if (detailsData.statusList?.[0]?.statusCode !== "0000") return null;
        return detailsData.StationDetails?.[0]?.location || null;
      } catch (e: any) {
        console.warn(`Failed to fetch details for Tata station ${station.station_code}: ${e.message}`);
        return null;
      }
    };

    // Query details for all stations with a concurrency level of 50
    const allDetails = await batchFetch(rawStations, 50, fetchDetails);

    const scrapedStations: ScrapedStation[] = [];

    for (let i = 0; i < allDetails.length; i++) {
      const location = allDetails[i];
      const basicStation = rawStations[i];
      if (!location) {
        // If details fetch failed, we can fallback to the basic info with empty connectors
        let status: StationStatus = StationStatus.UNKNOWN;
        if (basicStation.station_status === "AVAILABLE") {
          status = StationStatus.AVAILABLE;
        } else if (basicStation.station_status === "OUTOFORDER" || basicStation.station_status === "OFFLINE") {
          status = StationStatus.OFFLINE;
        }

        scrapedStations.push({
          externalId: basicStation.station_code,
          source: "tata",
          name: basicStation.station_name || "Tata Power EZ Charge",
          operator: "Tata Power",
          address: basicStation.city ? `Tata EV Charging Hub, ${basicStation.city}` : "Tata EV Charging Hub",
          city: basicStation.city || undefined,
          state: basicStation.state || undefined,
          latitude: parseFloat(basicStation.coordinates?.latitude) || 0,
          longitude: parseFloat(basicStation.coordinates?.longitude) || 0,
          status,
          connectors: [],
          amenities: []
        });
        continue;
      }

      // Map connectors
      const connectors: ScrapedConnector[] = [];
      let connectorIndex = 1;

      for (const evse of (location.evses || [])) {
        if (!evse) continue;
        for (const conn of (evse.connectors || [])) {
          if (!conn) continue;
          
          let connStatus: (typeof ConnectorStatus)[keyof typeof ConnectorStatus] = ConnectorStatus.UNKNOWN;
          if (conn.status === "AVAILABLE") {
            connStatus = ConnectorStatus.AVAILABLE;
          } else if (conn.status === "OCCUPIED" || conn.status === "CHARGING") {
            connStatus = ConnectorStatus.OCCUPIED;
          }

          connectors.push({
            externalId: `${evse.evseCode || evse.oemSerialNumber || "evse"}-${conn.connectorCode || connectorIndex++}`,
            type: this.mapConnectorType(conn.standard),
            powerKw: parseNumeric(conn.maxElectricPower, evse.chargerCapacity),
            currentType: this.mapCurrentType(conn.powerType || conn.standard),
            status: connStatus,
            pricing: parseFloat(conn.rate) || undefined
          });
        }
      }

      // Map amenities/facilities
      const amenities = (location.facilities || [])
        .filter((f: any) => f.selected)
        .map((f: any) => {
          const key = (f.key || f.text || "").toUpperCase();
          if (key.includes("RESTROOM") || key.includes("WASHROOM")) return "RESTROOMS";
          if (key.includes("FOOD") || key.includes("CAFETERIA") || key.includes("RESTAURANT")) return "FOOD_COURT";
          if (key.includes("MALL")) return "SHOPPING";
          if (key.includes("HOTEL")) return "LODGING";
          return key;
        });

      // Map address coordinates
      const lat = parseFloat(location.address?.coordinates?.latitude) || parseFloat(basicStation.coordinates?.latitude) || 0;
      const lng = parseFloat(location.address?.coordinates?.longitude) || parseFloat(basicStation.coordinates?.longitude) || 0;

      const addressLine1 = location.address?.addressLine1 || "";
      const addressLine2 = location.address?.addressLine2 || "";
      const address = [addressLine1, addressLine2].filter(Boolean).join(", ") || basicStation.station_name || "Tata EV Charging Hub";

      let status: (typeof StationStatus)[keyof typeof StationStatus] = StationStatus.UNKNOWN;
      if (location.status === "AVAILABLE") {
        status = StationStatus.AVAILABLE;
      } else if (location.status === "OCCUPIED" || location.status === "CHARGING") {
        status = StationStatus.AVAILABLE;
      } else if (location.status === "OFFLINE" || location.status === "OUTOFORDER") {
        status = StationStatus.OFFLINE;
      }

      scrapedStations.push({
        externalId: location.locationCode || basicStation.station_code,
        source: "tata",
        name: location.name || basicStation.station_name || "Tata Power EZ Charge",
        operator: "Tata Power",
        address,
        city: location.address?.city || basicStation.city || undefined,
        state: location.address?.state || basicStation.state || undefined,
        pincode: location.address?.postalCode || undefined,
        latitude: lat,
        longitude: lng,
        status,
        operatingHours: location.openingTimesList?.[0]?.regularHours ? "24/7" : undefined,
        amenities,
        connectors
      });
    }

    console.log(`Tata Power EZ Charge Scraper complete. Processed ${scrapedStations.length} stations.`);
    return scrapedStations;
  }

  private mapConnectorType(typeStr: string): ConnectorType {
    if (!typeStr) return ConnectorType.CCS2;
    const s = typeStr.toLowerCase();
    if (s.includes("ccs2") || s.includes("ccs-2") || s.includes("ccs combo") || s.includes("combo 2")) return ConnectorType.CCS2;
    if (s.includes("type2") || s.includes("type 2") || s.includes("type-2")) return ConnectorType.TYPE2;
    if (s.includes("chademo")) return ConnectorType.CHADEMO;
    if (s.includes("gbt") || s.includes("gb/t") || s.includes("gb-t")) return ConnectorType.GB_T;
    if (s.includes("bharat ac") || s.includes("bharat-ac")) return ConnectorType.BHARAT_AC;
    if (s.includes("bharat dc") || s.includes("bharat-dc")) return ConnectorType.BHARAT_DC;
    return ConnectorType.CCS2;
  }

  private mapCurrentType(typeStr: string): CurrentType {
    if (!typeStr) return CurrentType.DC;
    const s = typeStr.toLowerCase();
    if (s.includes("ac") || s.includes("type2") || s.includes("type-2")) return CurrentType.AC;
    return CurrentType.DC;
  }
}

