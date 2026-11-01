import { AvailabilityBadge } from "./AvailabilityBadge";
import {
  connectorStatus,
  connectorTypeLabel,
  formatPower,
  formatPrice,
  type AvailabilityConfidence,
  type ConnectorSourceStatus,
  type ConnectorType,
} from "./connector";
import { FreshnessText } from "./FreshnessText";
import type { Timestamp } from "./time";

export interface ConnectorRowProps {
  /** null = "Connector not listed". */
  type: ConnectorType | null;
  currentType?: "AC" | "DC" | null;
  /** kW. null = "Power not listed". */
  powerKw: number | null;
  /** INR per kWh. null = "Price not listed". */
  pricePerKwh: number | null;
  status: ConnectorSourceStatus | null;
  /** Only LIVE or RECENT shows In use / Out of service / Available; anything else is "Status unknown" (ADR-0020). */
  confidence: AvailabilityConfidence | null;
  /** Per-connector source time. undefined = show no time line; null = "Update time unknown". */
  updatedAt?: Timestamp;
}

/**
 * One connector: type, power, price and its own status. Renders an <li>, so put it inside a <ul>.
 * Server component: no "use client", no lucide-react. Shows only what it is given (spec-mobile 5.0): a null
 * type, power or price reads "... not listed", never a default.
 */
export function ConnectorRow({ type, currentType, powerKw, pricePerKwh, status, confidence, updatedAt }: ConnectorRowProps) {
  const { state, label } = connectorStatus(status, confidence);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-3 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="flex flex-wrap gap-x-2 text-body text-ink">
          <span className="font-semibold">{connectorTypeLabel(type)}</span>
          {currentType ? <span className="text-ink-muted">{currentType}</span> : null}
        </p>
        <p className="flex flex-wrap gap-x-3 text-body-sm text-ink">
          <span>{formatPower(powerKw)}</span>
          <span>{formatPrice(pricePerKwh)}</span>
        </p>
        {updatedAt === undefined ? null : <FreshnessText at={updatedAt} />}
      </div>
      <AvailabilityBadge state={state} label={label} />
    </li>
  );
}
