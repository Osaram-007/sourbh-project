/**
 * The availability disclaimer (WL-LEGAL-7). StatusLegend shows it under the status cards; the app shows it next to
 * status in StationDetail. Server component, inline SVG (no lucide-react), so it is safe on the landing page.
 * Draft wording from the copy deck, section 6; the founder signs it off (Q-W13). Never add "verified" or a live claim (T-2).
 */
export const AVAILABILITY_DISCLAIMER =
  "Availability and status depend on data provided by connected charging networks and other sources. Status can change at any time.";

export function AvailabilityDisclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={`flex items-start gap-2 text-body-sm text-ink-muted ${className}`}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mt-0.5 shrink-0"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      <span>{AVAILABILITY_DISCLAIMER}</span>
    </p>
  );
}
