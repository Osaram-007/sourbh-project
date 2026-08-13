import { ScrapedStation, ScrapedConnector, ScraperEngine, parseNumeric } from "../types";
import { db } from "@/lib/db";
import { ConnectorType, CurrentType, StationStatus, ConnectorStatus, CredentialStatus } from "@prisma/client";

function mapAtherConnectorStatus(status: unknown): ConnectorStatus {
  const s = String(status ?? "").toLowerCase();
  if (s === "available") return ConnectorStatus.AVAILABLE;
  if (s === "occupied" || s === "charging" || s === "busy" || s === "in use") return ConnectorStatus.OCCUPIED;
  if (s === "faulted" || s === "fault" || s === "error" || s === "out of order" || s === "offline") return ConnectorStatus.FAULTED;
  return ConnectorStatus.UNKNOWN;
}

export class AtherGridScraper implements ScraperEngine {
  name = "ather";

  async scrape(): Promise<ScrapedStation[]> {
    console.log("Starting Ather Grid Scraper...");
    
    let credentials = null;
    try {
      credentials = await db.cpoCredential.findUnique({
        where: { cpoName: "ather" }
      });
    } catch (e) {
      console.warn("Could not query database for Ather CPO credentials. Running in standalone mode.");
    }

    if (credentials && credentials.status === CredentialStatus.ACTIVE) {
      console.log("Using active Ather Grid API credentials from database.");
      try {
        return await this.scrapeWithCredentials(credentials);
      } catch (err: any) {
        console.warn(`Credential-based Ather scraping failed: ${err.message}. Falling back to public guest discovery.`);
      }
    }

    console.log("Running Ather Grid public guest discovery engine...");
    return this.scrapePublicGuest();
  }

  private async scrapeWithCredentials(credentials: any): Promise<ScrapedStation[]> {
    const url = "https://api.atherenergy.com/grid/v2/locations";
    const headers = {
      "Authorization": `Bearer ${credentials.authToken}`,
      "Accept": "application/json",
      ...(credentials.headers as Record<string, string>)
    };

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    
    if (response.status === 401 || response.status === 403) {
      await db.cpoCredential.update({
        where: { id: credentials.id },
        data: { status: CredentialStatus.EXPIRED }
      }).catch(() => {});
      throw new Error(`Ather Grid API Authentication failed with code ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`Ather Grid API responded with status ${response.status}`);
    }

    const data = await response.json();
    const rawLocations = data.locations || data;

    if (!Array.isArray(rawLocations)) {
      throw new Error("Invalid Ather Grid response format");
    }

    const stations: ScrapedStation[] = [];
    for (const item of rawLocations) {
      const connectors: ScrapedConnector[] = (item.chargers || []).map((c: any) => ({
        externalId: String(c.id),
        type: ConnectorType.TYPE2,
        powerKw: parseNumeric(c.power),
        currentType: CurrentType.AC,
        // Unrecognised states resolve to UNKNOWN — collapsing everything
        // non-available into OCCUPIED makes FAULTED unreachable in analytics.
        status: mapAtherConnectorStatus(c.status),
        pricing: parseNumeric(item.pricing),
      }));

      stations.push({
        externalId: String(item.id),
        source: "ather",
        name: item.name || "Ather Grid Station",
        operator: "Ather Grid",
        address: item.address || "Ather Grid Charger",
        city: item.city || undefined,
        state: item.state || undefined,
        pincode: item.pincode || undefined,
        latitude: parseFloat(item.latitude),
        longitude: parseFloat(item.longitude),
        // `isActive` means commissioned, not "a connector is free right now" —
        // treating it as live availability would inflate uptime. Only an
        // explicit false is meaningful (station out of service).
        status: item.isActive === false ? StationStatus.OFFLINE : StationStatus.UNKNOWN,
        imageUrl: item.imageUrl || undefined,
        // No invented defaults — only record what the API actually returns.
        operatingHours: item.timing || undefined,
        amenities: Array.isArray(item.amenities) ? item.amenities : [],
        pricingInfo: undefined,
        connectors,
      });
    }

    return stations;
  }

  private async scrapePublicGuest(): Promise<ScrapedStation[]> {
    const publicStationsMap = new Map<string, ScrapedStation>();

    // 1. Try public guest web endpoint if reachable
    try {
      const publicUrl = "https://api.atherenergy.com/grid/v1/public/chargers";
      const res = await fetch(publicUrl, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        signal: AbortSignal.timeout(30000)
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.data || data.locations || []);
        for (const item of list) {
          const lat = parseFloat(item.latitude || item.lat);
          const lng = parseFloat(item.longitude || item.lng);
          if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) continue;

          const externalId = item.id ? String(item.id) : `ather-pub-${lat.toFixed(4)}-${lng.toFixed(4)}`;
          publicStationsMap.set(externalId, {
            externalId,
            source: "ather",
            name: item.name || item.location_name || "Ather Grid Charger",
            operator: "Ather Grid",
            address: item.address || item.area || "Ather EV Charging Point",
            city: item.city || undefined,
            state: item.state || undefined,
            latitude: lat,
            longitude: lng,
            // Only an explicit true/false from the API maps to a real status -
            // a missing field means we don't know, not that it's available.
            status: item.is_available === true ? StationStatus.AVAILABLE
              : item.is_available === false ? StationStatus.OFFLINE
              : StationStatus.UNKNOWN,
            amenities: [],
            connectors: []
          });
        }
      }
    } catch {
      // Non-fatal if public endpoint requires active token
    }

    // NOTE: A previous "Step 2" merged in ~12 hardcoded metro hub stations here
    // (invented status/connectors/pricing/amenities). Removed for data integrity -
    // do not reintroduce fabricated stations as a fallback.

    const results = Array.from(publicStationsMap.values());
    console.log(`Ather Grid Public Discovery engine complete. Total processed: ${results.length} stations.`);
    return results;
  }
}
