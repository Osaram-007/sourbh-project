/**
 * The one status map (ADR-0020). Badge, map marker, legend, landing status cards and tests import this;
 * nothing else may define availability colours, icons or words.
 *
 * Four states only. No station-level "In use" and no "Maintenance" in V1.
 * Status is always colour + icon + word (WL-A11Y-3), never colour alone.
 * Keys match AvailabilityState from the T1-05 availability service.
 */

export type StationStatus = "AVAILABLE" | "LIMITED" | "UNAVAILABLE" | "UNKNOWN";

/** lucide-react export names. Distinct silhouettes: circle+check, triangle, octagon, circle+question mark. */
export type StatusIconName = "CircleCheck" | "TriangleAlert" | "OctagonX" | "CircleQuestionMark";

export interface StatusEntry {
  /** Plain-English word shown next to the icon. */
  label: string;
  /** One short line for legends and the landing cards. Matches the DN-9 meaning of each state. */
  description: string;
  /** CSS variable name, defined in src/app/globals.css (the contrast test checks it). */
  token: `--color-status-${string}`;
  /** Ready for `style`/SVG fill. In class names use the Tailwind utility, e.g. `bg-status-available`. */
  color: `var(--color-status-${string})`;
  icon: StatusIconName;
}

export const STATUS: Record<StationStatus, StatusEntry> = {
  AVAILABLE: {
    label: "Available",
    description: "Ready to charge.",
    token: "--color-status-available",
    color: "var(--color-status-available)",
    icon: "CircleCheck",
  },
  LIMITED: {
    label: "Limited",
    description: "Some connectors are free.",
    token: "--color-status-limited",
    color: "var(--color-status-limited)",
    icon: "TriangleAlert",
  },
  UNAVAILABLE: {
    label: "Unavailable",
    description: "Not currently available.",
    token: "--color-status-unavailable",
    color: "var(--color-status-unavailable)",
    icon: "OctagonX",
  },
  UNKNOWN: {
    label: "Status unknown",
    description: "No recent availability information.",
    token: "--color-status-unknown",
    color: "var(--color-status-unknown)",
    icon: "CircleQuestionMark",
  },
};

/** Display order for legends and the landing cards. */
export const STATUS_ORDER: readonly StationStatus[] = ["AVAILABLE", "LIMITED", "UNAVAILABLE", "UNKNOWN"];
