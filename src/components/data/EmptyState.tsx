import type { ReactNode } from "react";

/**
 * "Nothing here" for a request that succeeded and returned nothing (no results, no saved stations, no vehicles).
 * An API error is never an empty state: show ErrorRetry for that (WL-APP-10). Server component, no "use client".
 * The caller writes the words and passes any action (a Button or link). `icon` replaces the default search glyph
 * (pass lucide in client-only app code, inline SVG anywhere else); it is hidden from assistive tech.
 * Not a live region: the list or page that changed announces its own result.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className = "",
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-3 px-6 py-10 text-center ${className}`}>
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-mint text-brand">
        {icon ?? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        )}
      </span>
      <p className="text-title font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-sm text-body text-ink-muted">{description}</p> : null}
      {action}
    </div>
  );
}
