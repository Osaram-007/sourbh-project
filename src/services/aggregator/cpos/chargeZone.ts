import { ScrapedStation, ScrapedConnector, ScraperEngine } from "../types";
import { ConnectorType, CurrentType, StationStatus, ConnectorStatus } from "@prisma/client";

export class ChargeZoneScraper implements ScraperEngine {
  name = "chargezone";

  async scrape(): Promise<ScrapedStation[]> {
    console.log("Starting Charge Zone Scraper...");

    const stationsMap = new Map<string, ScrapedStation>();

    // Step 1: Scrape from Primary ChargeCloud API
    try {
      const apiStations = await this.scrapeFromApi();
      for (const st of apiStations) {
        stationsMap.set(st.externalId, st);
      }
      console.log(`Fetched ${apiStations.length} stations from primary Charge Zone API.`);
    } catch (err: any) {
      console.warn(`Primary Charge Zone API fetch failed: ${err.message}. Proceeding to fallback sources.`);
    }

    // Step 2: Scrape from Public Directory Sitemaps
    try {
      const directoryStations = await this.scrapeFromDirectorySitemap();
      let addedCount = 0;
      for (const st of directoryStations) {
        if (!stationsMap.has(st.externalId)) {
          stationsMap.set(st.externalId, st);
          addedCount++;
        }
      }
      console.log(`Discovered ${addedCount} additional stations from Charge Zone directory sitemaps.`);
    } catch (err: any) {
      console.warn(`Charge Zone directory sitemap crawl failed: ${err.message}`);
    }

    // NOTE: A previous "Step 3" seeded hardcoded highway corridor stations here
    // (invented status/connectors/pricing). Removed for data integrity - do not
    // reintroduce fabricated stations as a fallback.

    const finalStations = Array.from(stationsMap.values());
    console.log(`Charge Zone Scraper complete. Total processed: ${finalStations.length} stations.`);
    return finalStations;
  }

  private async scrapeFromApi(): Promise<ScrapedStation[]> {
    const url = "https://api.chargecloud.net/v1/util/stationlocator";
    const headers = {
      "authorization": "amtzYmZqa2Ric29pZmhlZm5lbGN6eCxtdiBkc25zaWVsZ2ZubHNldw==",
      "referer": "https://www.chargezone.co.in/",
      "accept": "*/*",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`Charge Zone API responded with status ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("Invalid Charge Zone response format");
    }

    const stations: ScrapedStation[] = [];
    for (const item of data) {
      if (!item.gps_latitude || !item.gps_longitude) continue;

      const lat = parseFloat(item.gps_latitude);
      const lng = parseFloat(item.gps_longitude);

      if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) continue;

      let stationStatus: StationStatus = StationStatus.UNKNOWN;
      let connectorStatus: ConnectorStatus = ConnectorStatus.UNKNOWN;

      const rawStatus = (item.status || "").trim().toLowerCase();
      if (rawStatus === "available" || rawStatus === "open") {
        stationStatus = StationStatus.AVAILABLE;
        connectorStatus = ConnectorStatus.AVAILABLE;
      } else if (rawStatus === "in use" || rawStatus === "charging" || rawStatus === "busy") {
        stationStatus = StationStatus.AVAILABLE;
        connectorStatus = ConnectorStatus.OCCUPIED;
      } else if (rawStatus === "unavailable" || rawStatus === "powerloss" || rawStatus === "under maintenance" || rawStatus === "faulted") {
        stationStatus = StationStatus.OFFLINE;
        connectorStatus = ConnectorStatus.UNKNOWN;
      } else if (rawStatus === "coming soon") {
        stationStatus = StationStatus.UNKNOWN;
        connectorStatus = ConnectorStatus.UNKNOWN;
      }

      const connectors = this.parseConnectors(item, connectorStatus);

      const rawStationId = item.station_id ? String(item.station_id).trim() : "";
      const isInvalidId = !rawStationId || rawStationId === "0000" || rawStationId === "0";
      const externalId = isInvalidId
        ? `cz-${lat.toFixed(4)}-${lng.toFixed(4)}`
        : rawStationId;

      stations.push({
        externalId,
        source: "chargezone",
        name: item.station_name || item.name || "Charge Zone Station",
        operator: "Charge Zone",
        address: item.address || item.location || "Charge Zone Charger",
        city: item.city || undefined,
        state: item.state || undefined,
        pincode: item.pin_code ? String(item.pin_code) : undefined,
        latitude: lat,
        longitude: lng,
        status: stationStatus,
        // Only use values the API actually returns - no fabricated fallbacks
        operatingHours: item.working_hours || undefined,
        amenities: [],
        pricingInfo: item.pricing || undefined,
        connectors,
      });
    }

    return stations;
  }

  private async scrapeFromDirectorySitemap(): Promise<ScrapedStation[]> {
    const sitemapUrl = "https://ev-stations.chargezone.co.in/sitemap.xml?bid=cities&cid=283da2c0-340d-4b36-93cb-d66fd224466c";
    const res = await fetch(sitemapUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(30000)
    });

    if (!res.ok) {
      throw new Error(`Sitemap XML responded with ${res.status}`);
    }

    const xmlText = await res.text();
    const locMatches = Array.from(xmlText.matchAll(/<loc>(https:\/\/ev-stations\.chargezone\.co\.in\/location\/[^<]+)<\/loc>/g));
    const locationUrls = locMatches.map(m => m[1]);

    const stations: ScrapedStation[] = [];
    
    // Sample state/city pages up to 15 pages in parallel to avoid long sync delay
    const sampleUrls = locationUrls.slice(0, 15);
    const fetchPage = async (pageUrl: string) => {
      try {
        const pageRes = await fetch(pageUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          signal: AbortSignal.timeout(15000)
        });
        if (!pageRes.ok) return [];
        const html = await pageRes.text();

        // Extract JSON-LD schema blocks or store cards
        const parsed: ScrapedStation[] = [];
        const ldJsonMatches = Array.from(html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi));
        for (const match of ldJsonMatches) {
          try {
            const jsonObj = JSON.parse(match[1]);
            const items = Array.isArray(jsonObj) ? jsonObj : [jsonObj];
            for (const item of items) {
              if (item["@type"] === "Place" || item["@type"] === "LocalBusiness" || item.geo) {
                const lat = parseFloat(item.geo?.latitude || item.latitude);
                const lng = parseFloat(item.geo?.longitude || item.longitude);
                if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
                  const name = item.name || "Charge Zone Station";
                  const externalId = `cz-dir-${lat.toFixed(4)}-${lng.toFixed(4)}`;
                  parsed.push({
                    externalId,
                    source: "chargezone",
                    name,
                    operator: "Charge Zone",
                    address: item.address?.streetAddress || item.address || name,
                    city: item.address?.addressLocality || undefined,
                    state: item.address?.addressRegion || undefined,
                    latitude: lat,
                    longitude: lng,
                    // Sitemap pages carry no live status or hardware info - do not fabricate it
                    status: StationStatus.UNKNOWN,
                    amenities: [],
                    connectors: []
                  });
                }
              }
            }
          } catch {
            // Ignore JSON parse errors for non-matching script tags
          }
        }
        return parsed;
      } catch {
        return [];
      }
    };

    const results = await Promise.all(sampleUrls.map(fetchPage));
    for (const resList of results) {
      stations.push(...resList);
    }

    return stations;
  }

  private parseConnectors(item: any, status: ConnectorStatus): ScrapedConnector[] {
    const stationId = item.station_id ? String(item.station_id) : "cz";
    const fullText = [
      item.station_name || "",
      item.name || "",
      item.description || "",
      item.power || "",
      item.charger_capacity || "",
      item.capacity || ""
    ].join(" ").toLowerCase();

    // 1. Look for explicit kW power ratings (e.g., "180kW", "180 kW", "120kW", "240kW", "360kW", "60kW")
    const kwMatch = fullText.match(/(\d+(?:\.\d+)?)\s*(?:kw|k\.w\.|kilowatt)/i);
    let extractedKw = kwMatch ? parseFloat(kwMatch[1]) : null;

    // 2. Check structured payload fields
    if (extractedKw === null || isNaN(extractedKw)) {
      if (typeof item.power === "number" && item.power > 0) extractedKw = item.power;
      if (typeof item.capacity === "number" && item.capacity > 0) extractedKw = item.capacity;
      if (typeof item.power_rating === "number" && item.power_rating > 0) extractedKw = item.power_rating;
    }

    if (extractedKw !== null && !isNaN(extractedKw) && extractedKw > 0) {
      if (extractedKw >= 100) {
        // High-power Supercharger (120kW, 180kW, 240kW, 360kW Dual CCS2)
        return [
          { externalId: `${stationId}-c1`, type: ConnectorType.CCS2, powerKw: extractedKw, currentType: CurrentType.DC, status },
          { externalId: `${stationId}-c2`, type: ConnectorType.CCS2, powerKw: extractedKw, currentType: CurrentType.DC, status }
        ];
      } else if (extractedKw >= 30) {
        // Standard DC Fast Charger (30kW, 50kW, 60kW Dual CCS2)
        return [
          { externalId: `${stationId}-c1`, type: ConnectorType.CCS2, powerKw: extractedKw, currentType: CurrentType.DC, status },
          { externalId: `${stationId}-c2`, type: ConnectorType.CCS2, powerKw: extractedKw, currentType: CurrentType.DC, status }
        ];
      } else if (extractedKw >= 7) {
        return [
          { externalId: `${stationId}-c1`, type: ConnectorType.TYPE2, powerKw: extractedKw, currentType: CurrentType.AC, status }
        ];
      } else {
        return [
          { externalId: `${stationId}-c1`, type: ConnectorType.WALL_SOCKET, powerKw: extractedKw, currentType: CurrentType.AC, status }
        ];
      }
    }

    // Cannot determine actual connector hardware from this data - record nothing
    // rather than fabricating a "dual 180kW CCS2" default.
    return [];
  }
}
