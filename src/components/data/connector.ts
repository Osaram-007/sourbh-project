/**
 * Connector wording: types, power, price and the per-connector status text (ADR-0020). Pure functions, no React.
 * ConnectorRow renders these; StationCard (WEB-B09) and StationDetail (WEB-B12) import them so the words are
 * defined once. Raw enums never reach the UI (WL-APP-8): an unknown value reads as "not listed" or "Status unknown".
 *
 * The literal unions mirror the Prisma enums and ADR-0008; check them against docs/api-v1.md when T1-01 lands.
 */
import { STATUS, type AvailabilityState } from "../../lib/status";

export type ConnectorType = "CCS2" | "CHADEMO" | "TYPE2" | "TYPE1" | "GB_T" | "BHARAT_AC" | "BHARAT_DC" | "WALL_SOCKET";
/** What the source reported for one connector. */
export type ConnectorSourceStatus = "AVAILABLE" | "OCCUPIED" | "FAULTED" | "UNKNOWN";
/** How fresh that report is (T1-05). Only LIVE and RECENT may be shown as current. */
export type AvailabilityConfidence = "LIVE" | "RECENT" | "HISTORICAL" | "UNKNOWN";

/** Missing-data texts (spec-mobile 5.0; "Price not listed" per the web wording note). Never default a value instead. */
export const NOT_LISTED = {
  connector: "Connector not listed",
  power: "Power not listed",
  price: "Price not listed",
} as const;

const TYPE_LABEL: Record<ConnectorType, string> = {
  CCS2: "CCS2",
  CHADEMO: "CHAdeMO",
  TYPE2: "Type 2",
  TYPE1: "Type 1",
  GB_T: "GB/T",
  BHARAT_AC: "Bharat AC",
  BHARAT_DC: "Bharat DC",
  WALL_SOCKET: "Wall socket",
};

export function connectorTypeLabel(type: ConnectorType | null | undefined): string {
  return (type && TYPE_LABEL[type]) || NOT_LISTED.connector;
}

const kw = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** "50 kW", or "Power not listed" for null, non-finite and zero (never a default). */
export function formatPower(powerKw: number | null | undefined): string {
  return typeof powerKw === "number" && Number.isFinite(powerKw) && Math.round(powerKw * 10) > 0
    ? `${kw.format(powerKw)} kW`
    : NOT_LISTED.power;
}

/** "₹18/kWh" (INR per kWh, the only unit the API exposes), or "Price not listed" for null, non-finite and zero. */
export function formatPrice(pricePerKwh: number | null | undefined): string {
  return typeof pricePerKwh === "number" && Number.isFinite(pricePerKwh) && Math.round(pricePerKwh * 100) > 0
    ? `₹${inr.format(pricePerKwh)}/kWh`
    : NOT_LISTED.price;
}

// Which of the four station states supplies the icon and colour. Station-level red already covers busy and broken,
// so In use and Out of service share it; the word tells them apart.
const SOURCE: Record<ConnectorSourceStatus, { state: AvailabilityState; text?: string }> = {
  AVAILABLE: { state: "AVAILABLE" },
  OCCUPIED: { state: "UNAVAILABLE", text: "In use" },
  FAULTED: { state: "UNAVAILABLE", text: "Out of service" },
  UNKNOWN: { state: "UNKNOWN" },
};

/**
 * The per-connector word and its icon state (ADR-0020). LIVE or RECENT: Available, In use, Out of service or
 * Status unknown. Any other confidence, or a missing status: "Status unknown", in grey, whatever the source said.
 * "Available" and "Status unknown" come from status.ts; only "In use" and "Out of service" are defined here.
 */
export function connectorStatus(
  status: ConnectorSourceStatus | null | undefined,
  confidence: AvailabilityConfidence | null | undefined,
): { state: AvailabilityState; label: string } {
  const current = confidence === "LIVE" || confidence === "RECENT";
  const { state, text } = (current && status && SOURCE[status]) || SOURCE.UNKNOWN;
  return { state, label: text ?? STATUS[state].label };
}
