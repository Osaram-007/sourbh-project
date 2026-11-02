import { STATUS, type AvailabilityState } from "../../lib/status";
import { StatusIcon } from "./StatusIcon";

/**
 * Availability as colour + icon + word (WL-A11Y-3), from the one status map in src/lib/status.ts (ADR-0020).
 * Server component: no "use client", no hooks, no lucide-react, so it adds no JS to the landing page.
 *
 * The word is ink; only the icon carries the status colour (orange is 3.49:1, so it is never text).
 * `state` is the server-computed AvailabilityState. Show it only as the state T1-05 returned: a station
 * with confidence UNKNOWN is "UNKNOWN" here, and there is no station-level "In use" or "Maintenance".
 *
 * `label` replaces the word for per-connector text only ("In use", "Out of service"): pass what
 * connectorStatus() returns. A station-level badge never sets it.
 */
export function AvailabilityBadge({ state, label, className = "" }: { state: AvailabilityState; label?: string; className?: string }) {
  const entry = STATUS[state] ?? STATUS.UNKNOWN;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface py-0.5 pl-1.5 pr-2.5 text-body-sm font-semibold text-ink ${className}`}
    >
      <StatusIcon state={state} />
      {label ?? entry.label}
    </span>
  );
}
