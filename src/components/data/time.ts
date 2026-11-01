/**
 * Date helpers for FreshnessText and OfflineBanner. Pure functions, no React, no Intl.
 * IST is a fixed +05:30 offset with no daylight saving, so dates are computed by hand: the output is
 * identical on the server, in every browser and across Node versions, and always says "IST".
 *
 * Nothing here invents a time. A missing, invalid or future-dated timestamp gives null, which the caller
 * shows as "Update time unknown" (spec-mobile 5.0).
 */

export type Timestamp = Date | string | number | null | undefined;

export const UPDATE_UNKNOWN = "Update time unknown";

const IST_OFFSET_MS = 330 * 60_000;
// A source clock a little ahead of ours is normal; more than this and the time is not believable.
const FUTURE_TOLERANCE_MIN = 5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A valid Date, or null for null, undefined, "" and anything that does not parse. */
export function toDate(at: Timestamp): Date | null {
  if (at === null || at === undefined || at === "") return null;
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "31 Oct, 3:42 pm IST". The year is added only when it is not the current IST year. */
export function formatIst(date: Date, now: Date = new Date()): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const currentYear = new Date(now.getTime() + IST_OFFSET_MS).getUTCFullYear();
  const hour = ist.getUTCHours();
  const minute = String(ist.getUTCMinutes()).padStart(2, "0");
  const time = `${hour % 12 || 12}:${minute} ${hour < 12 ? "am" : "pm"}`;
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}${year === currentYear ? "" : ` ${year}`}, ${time} IST`;
}

/**
 * "Updated just now" (under a minute), "Updated 5 min ago", "Updated 3 hours ago" (under a day),
 * otherwise "Updated 31 Oct, 3:42 pm IST". null when the time is more than 5 minutes in the future.
 */
export function freshnessLabel(date: Date, now: Date = new Date()): string | null {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < -FUTURE_TOLERANCE_MIN) return null;
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  return `Updated ${formatIst(date, now)}`;
}
