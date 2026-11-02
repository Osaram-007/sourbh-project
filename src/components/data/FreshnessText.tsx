import { formatIst, freshnessLabel, toDate, UPDATE_UNKNOWN, type Timestamp } from "./time";

/**
 * "Updated 5 min ago" or "Update time unknown". Server component: no "use client", no hooks.
 *
 * `at` must be the SOURCE time (lastSourceUpdate) where the API has one. Pass null when it does not: this never
 * falls back to the ingestion time and never invents a time (spec-mobile 5.0). A missing, invalid or future-dated
 * `at` shows "Update time unknown". Under a day it reads "N min ago" / "N hours ago"; older it reads an explicit
 * IST date ("Updated 31 Oct, 3:42 pm IST"). The full IST time is the tooltip.
 *
 * It is computed once per render and does not tick: the page refreshes it when the data refetches.
 * `now` is for tests and for rendering a whole list against one clock.
 */
export function FreshnessText({ at, now, className = "" }: { at: Timestamp; now?: Date | number; className?: string }) {
  const base = `text-body-sm text-ink-muted ${className}`;
  const date = toDate(at);
  const clock = now === undefined ? new Date() : new Date(now);
  const label = date && freshnessLabel(date, clock);
  if (!date || !label) return <span className={base}>{UPDATE_UNKNOWN}</span>;
  // suppressHydrationWarning: the minute can roll over between the server render and hydration.
  return (
    <time dateTime={date.toISOString()} title={formatIst(date, clock)} suppressHydrationWarning className={base}>
      {label}
    </time>
  );
}
