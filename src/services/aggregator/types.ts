import { ConnectorType, CurrentType, StationStatus, ConnectorStatus } from "@prisma/client";

export interface ScrapedConnector {
  externalId?: string;
  type: ConnectorType;
  powerKw?: number;
  currentType: CurrentType;
  status: ConnectorStatus;
  pricing?: number;
}

export interface ScrapedStation {
  externalId: string;
  source: string; // "ocm" | "osm" | "evyatra" | "tata" | "ather" | "statiq"
  name: string;
  operator?: string;
  address: string;
  city?: string;
  state?: string;
  pincode?: string;
  latitude: number;
  longitude: number;
  status: StationStatus;
  imageUrl?: string;
  operatingHours?: string;
  amenities: string[]; // e.g., ["PARKING", "RESTROOMS", "FOOD_COURT", "WIFI"]
  pricingInfo?: string;
  connectors: ScrapedConnector[];
}

export interface ScraperEngine {
  name: string;
  scrape(): Promise<ScrapedStation[]>;
}

// Parses each candidate with parseFloat and returns the first finite result,
// or undefined if none parse — never fabricates a placeholder number.
export function parseNumeric(...values: unknown[]): number | undefined {
  for (const v of values) {
    const n = parseFloat(String(v));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
