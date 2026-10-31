/**
 * The one status map (ADR-0020). Badge, map marker, legend, landing status cards and tests import this;
 * nothing else may define availability colours, icons or words.
 *
 * Four states only. No station-level "In use" and no "Maintenance" in V1.
 * Status is always colour + icon + word (WL-A11Y-3), never colour alone.
 * Keys match AvailabilityState from the T1-05 availability service (not the Prisma StationStatus enum, which has other values).
 */

export type AvailabilityState = "AVAILABLE" | "LIMITED" | "UNAVAILABLE" | "UNKNOWN";

/** lucide-react export names. Distinct silhouettes: circle+check, triangle, octagon, circle+question mark. */
export type StatusIconName = "CircleCheck" | "TriangleAlert" | "OctagonX" | "CircleQuestionMark";

export interface StatusEntry {
  /** Plain-English word shown next to the icon. */
  label: string;
  /** One short line for legends and the landing cards. Draft copy: the founder may edit it (Q-W13). */
  description: string;
  /** CSS variable name, defined in src/app/globals.css (the contrast test checks it). */
  token: `--color-status-${string}`;
  /** For `style` or an SVG fill. Never build a Tailwind class name from a state: classes must appear literally to be generated. */
  color: `var(--color-status-${string})`;
  icon: StatusIconName;
}

export const STATUS: Record<AvailabilityState, StatusEntry> = {
  AVAILABLE: {
    label: "Available",
    description: "The network shows this charger as available.",
    token: "--color-status-available",
    color: "var(--color-status-available)",
    icon: "CircleCheck",
  },
  LIMITED: {
    label: "Limited",
    description: "Some connectors are free, but fewer than half.",
    token: "--color-status-limited",
    color: "var(--color-status-limited)",
    icon: "TriangleAlert",
  },
  UNAVAILABLE: {
    label: "Unavailable",
    description: "No connectors are free, or the network reports the charger offline.",
    token: "--color-status-unavailable",
    color: "var(--color-status-unavailable)",
    icon: "OctagonX",
  },
  UNKNOWN: {
    label: "Status unknown",
    description: "We have no recent status for this charger.",
    token: "--color-status-unknown",
    color: "var(--color-status-unknown)",
    icon: "CircleQuestionMark",
  },
};

/** Display order for legends and the landing cards. */
export const STATUS_ORDER: readonly AvailabilityState[] = ["AVAILABLE", "LIMITED", "UNAVAILABLE", "UNKNOWN"];
