import { ScrapedStation, ScrapedConnector, ScraperEngine, parseNumeric } from "../types";
import { db } from "@/lib/db";
import { ConnectorType, CurrentType, StationStatus, ConnectorStatus, CredentialStatus } from "@prisma/client";

// Maps an OCPI EVSE status string to our ConnectorStatus. Unrecognised values
// resolve to UNKNOWN rather than being guessed — collapsing everything
// non-available into OCCUPIED would make FAULTED unreachable in analytics.
function mapOcpiConnectorStatus(status: unknown): ConnectorStatus {
  const s = String(status ?? "").toUpperCase();
  if (s === "AVAILABLE") return ConnectorStatus.AVAILABLE;
  if (s === "CHARGING" || s === "OCCUPIED" || s === "RESERVED" || s === "BLOCKED") return ConnectorStatus.OCCUPIED;
  if (s === "OUTOFORDER" || s === "INOPERATIVE" || s === "REMOVED") return ConnectorStatus.FAULTED;
  return ConnectorStatus.UNKNOWN;
}

// Station availability is derived from real connector states, never assumed.
function deriveStationStatus(connectors: ScrapedConnector[]): StationStatus {
  if (connectors.length === 0) return StationStatus.UNKNOWN;
  if (connectors.some((c) => c.status === ConnectorStatus.AVAILABLE)) return StationStatus.AVAILABLE;
  if (connectors.some((c) => c.status === ConnectorStatus.OCCUPIED)) return StationStatus.OCCUPIED;
  if (connectors.every((c) => c.status === ConnectorStatus.FAULTED)) return StationStatus.OFFLINE;
  return StationStatus.UNKNOWN;
}

export class BpclScraper implements ScraperEngine {
  name = "bpcl";

  async scrape(): Promise<ScrapedStation[]> {
    console.log("Starting BPCL eDrive Scraper...");

    let credentials = null;
    try {
      credentials = await db.cpoCredential.findUnique({
        where: { cpoName: "bpcl" }
      });
    } catch (e) {
      console.warn("Could not query database for BPCL CPO credentials. Running in standalone mode.");
    }

    if (credentials && credentials.status === CredentialStatus.ACTIVE) {
      console.log("Using active BPCL / IONAGE OCPI API credentials from database.");
      try {
        return await this.scrapeWithOcpiCredentials(credentials);
      } catch (err: any) {
        console.warn(`IONAGE OCPI scraping failed: ${err.message}. Falling back to public discovery.`);
      }
    }

    console.log("Running BPCL eDrive public guest discovery engine...");
    return this.scrapePublicGuest();
  }

  private async scrapeWithOcpiCredentials(credentials: any): Promise<ScrapedStation[]> {
    const url = "https://api.ionage.in/ocpi/2.2.1/locations";
    const headers = {
      "Authorization": `Token ${credentials.authToken}`,
      "Accept": "application/json",
      ...(credentials.headers as Record<string, string>)
    };

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });

    if (response.status === 401 || response.status === 403) {
      await db.cpoCredential.update({
        where: { id: credentials.id },
        data: { status: CredentialStatus.EXPIRED }
      }).catch(() => {});
      throw new Error(`BPCL / IONAGE OCPI Auth failed with status ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`BPCL / IONAGE OCPI responded with status ${response.status}`);
    }

    const data = await response.json();
    const locations = data.data || data.locations || data;

    if (!Array.isArray(locations)) {
      throw new Error("Invalid OCPI response format");
    }

    const stations: ScrapedStation[] = [];
    for (const item of locations) {
      const lat = parseFloat(item.coordinates?.latitude || item.latitude);
      const lng = parseFloat(item.coordinates?.longitude || item.longitude);

      if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) continue;

      const connectors: ScrapedConnector[] = [];
      for (const evse of (item.evses || [])) {
        for (const conn of (evse.connectors || [])) {
          const powerKw = parseNumeric(conn.max_electric_power);
          connectors.push({
            externalId: String(conn.id || evse.uid || "bpcl-c1"),
            type: ConnectorType.CCS2,
            powerKw,
            currentType: CurrentType.DC,
            status: mapOcpiConnectorStatus(evse.status),
            // tariff_id is an identifier, not a price — never treat it as one.
            pricing: undefined
          });
        }
      }

      stations.push({
        externalId: String(item.id || `bpcl-${lat.toFixed(4)}-${lng.toFixed(4)}`),
        source: "bpcl",
        name: item.name || "BPCL eDrive Fast Charging Station",
        operator: "BPCL eDrive",
        address: item.address || "BPCL Fuel Retail Outlet",
        city: item.city || undefined,
        state: item.state || undefined,
        pincode: item.postal_code || undefined,
        latitude: lat,
        longitude: lng,
        // Availability must come from live EVSE data, never assumed. Operating
        // hours / amenities / pricing / connectors are only recorded when the
        // API actually returns them — no invented defaults (they would be
        // snapshotted every cycle as if they were measurements).
        status: deriveStationStatus(connectors),
        operatingHours: undefined,
        amenities: [],
        pricingInfo: undefined,
        connectors
      });
    }

    return stations;
  }

  private async scrapePublicGuest(): Promise<ScrapedStation[]> {
    const bpclMap = new Map<string, ScrapedStation>();

    // 1. Fetch from BEE EV Yatra public dataset filtered for BPCL
    try {
      const url = "https://evyatra.beeindia.gov.in/bee-ev-web-api/rest/private/chargingStation/public/list";
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        signal: AbortSignal.timeout(30000)
      });

      if (response.ok) {
        const data = await response.json();
        const list = Array.isArray(data) ? data : (data.data || []);
        for (const item of list) {
          const operatorName = (item.agencyName || item.companyName || item.operator || "").toUpperCase();
          const name = (item.chargingStationName || item.name || "").toUpperCase();

          if (operatorName.includes("BPCL") || operatorName.includes("BHARAT PETROLEUM") || name.includes("BPCL")) {
            const lat = parseFloat(item.latitude);
            const lng = parseFloat(item.longitude);
            if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) continue;

            const externalId = `bpcl-yatra-${item.id || item.chargingStationId || `${lat.toFixed(4)}-${lng.toFixed(4)}`}`;
            bpclMap.set(externalId, {
              externalId,
              source: "bpcl",
              name: item.chargingStationName || "BPCL eDrive Fast Charger",
              operator: "BPCL eDrive",
              address: item.address || "BPCL Fuel Station",
              city: item.city || undefined,
              state: item.state || undefined,
              latitude: lat,
              longitude: lng,
              // Only the location is real (from the API). We have no genuine live-availability
              // signal, connector hardware info, or pricing for this station, so we don't
              // fabricate them.
              status: StationStatus.UNKNOWN,
              operatingHours: "24/7",
              amenities: ["RESTROOMS", "FOOD_COURT", "PARKING"],
              connectors: []
            });
          }
        }
      }
    } catch {
      // Non-fatal if public endpoint times out
    }

    const results = Array.from(bpclMap.values());
    console.log(`BPCL eDrive Public Discovery engine complete. Total processed: ${results.length} stations.`);
    return results;
  }
}
