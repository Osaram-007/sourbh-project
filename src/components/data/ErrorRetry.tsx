"use client";

import type { ReactNode } from "react";
import { Button } from "../ui/Button";

/**
 * A failed request with a retry button (WL-APP-10): the error is never shown as "empty". `onRetry` is an event
 * handler, so this is a client component: use it from the app, never from marketing pages. It has no hooks and
 * imports no icon library, so it adds almost nothing to the client bundle.
 *
 * The text is plain and says what happened; never put an error message, status code or stack from the server in it
 * (WL-SEC-1). Pass `retrying` while the retry is in flight. role="alert" announces it when it appears.
 */
export function ErrorRetry({
  title = "Could not load this",
  message = "Please try again.",
  onRetry,
  retrying = false,
  className = "",
}: {
  title?: string;
  message?: ReactNode;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div role="alert" className={`flex flex-col items-center gap-3 px-6 py-10 text-center ${className}`}>
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="text-status-unavailable"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <p className="text-title font-semibold text-ink">{title}</p>
      {message ? <p className="max-w-sm text-body text-ink-muted">{message}</p> : null}
      <Button variant="secondary" onClick={onRetry} disabled={retrying} aria-busy={retrying}>
        {retrying ? "Retrying..." : "Try again"}
      </Button>
    </div>
  );
}
