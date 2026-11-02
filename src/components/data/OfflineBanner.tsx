"use client";

import { useSyncExternalStore } from "react";
import { Button } from "../ui/Button";
import { formatIst, toDate, UPDATE_UNKNOWN, type Timestamp } from "./time";

/**
 * "You are offline. Showing data from 31 Oct, 3:42 pm IST." plus a Retry button (WL-APP-10, spec-mobile 5.0).
 * Mount it once in the app shell. Client component (it listens for the browser's online/offline events); use it
 * from the app, never from marketing pages. It imports no icon library.
 *
 * `lastUpdated` = when the data now on screen was last fetched or observed. Pass null when unknown: it then says
 * "Update time unknown" and never presents cached data as current or invents a time.
 * It renders nothing while online (the always-present role="status" wrapper lets the banner be announced politely).
 * `offline` overrides the browser's state, e.g. to follow React Query's onlineManager or to render it in a test.
 */
const subscribe = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};

export function OfflineBanner({
  lastUpdated,
  onRetry,
  offline,
  className = "",
}: {
  lastUpdated: Timestamp;
  onRetry: () => void;
  offline?: boolean;
  className?: string;
}) {
  // The server and the first client render assume online, so hydration never mismatches.
  const detected = useSyncExternalStore(
    subscribe,
    () => !navigator.onLine,
    () => false,
  );
  const date = toDate(lastUpdated);
  return (
    <div role="status" className={className}>
      {(offline ?? detected) ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border border-border-strong bg-surface-muted px-3 py-2 text-body-sm text-ink">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="shrink-0"
          >
            <path d="M12 20h.01M8.5 16.429a5 5 0 0 1 7 0M5 12.859a10 10 0 0 1 5.17-2.69M19 12.859a10 10 0 0 0-2.007-1.523M2 8.82a15 15 0 0 1 4.177-2.643M22 8.82a15 15 0 0 0-11.288-3.764M2 2l20 20" />
          </svg>
          <p className="min-w-0 flex-1">
            <span className="font-semibold">You are offline.</span> {date ? `Showing data from ${formatIst(date)}.` : `${UPDATE_UNKNOWN}.`}
          </p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}
