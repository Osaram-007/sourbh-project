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
