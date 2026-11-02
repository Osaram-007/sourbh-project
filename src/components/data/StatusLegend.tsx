import { STATUS, STATUS_ORDER } from "../../lib/status";
import { AvailabilityDisclaimer } from "./AvailabilityDisclaimer";
import { StatusIcon } from "./StatusIcon";

/**
 * Every state the app can produce, with its icon, word and description, in STATUS_ORDER, read from
 * src/lib/status.ts (ADR-0020). Nothing is copied, so it can never list a state the app cannot show.
 * Server component: no "use client", no lucide-react. It renders on the landing page.
 *
 * variant "cards" = a grid of cards for the landing "Know before you go" section (1, 2 then 4 columns).
 * variant "list"  = a plain stacked list for a map legend or a popover.
 * The caller supplies the heading. The disclaimer is shown by default (WL-LAND-9, WL-LEGAL-7).
 */
export function StatusLegend({
  variant = "cards",
  showDisclaimer = true,
  className = "",
}: {
  variant?: "cards" | "list";
  showDisclaimer?: boolean;
  className?: string;
}) {
  const cards = variant === "cards";
  return (
    <div className={className}>
      <ul className={cards ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-4" : "flex flex-col gap-3"}>
        {STATUS_ORDER.map((state) => (
          <li
            key={state}
            className={cards ? "flex items-start gap-3 rounded-card border border-border bg-surface p-4 shadow-card sm:flex-col" : "flex items-start gap-2"}
          >
            <StatusIcon state={state} size={cards ? 28 : 20} />
            <div>
              <p className="font-semibold text-ink">{STATUS[state].label}</p>
              <p className="text-body-sm text-ink-muted">{STATUS[state].description}</p>
            </div>
          </li>
        ))}
      </ul>
      {showDisclaimer ? <AvailabilityDisclaimer className="mt-4" /> : null}
    </div>
  );
}
