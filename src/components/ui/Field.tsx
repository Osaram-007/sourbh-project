import type { ReactNode } from "react";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * Shared label / hint / error plumbing for Input, Select and Checkbox (also usable for a custom control).
 * Server-compatible: no "use client", no hooks, no lucide-react (its Icon is a client component, which would
 * ship JS to every page that renders a form). Ids are derived from the required `id`, so there is no useId.
 */

/** Border, size and focus for a text-like control. Error styling comes from aria-invalid, set by fieldA11y(). */
export const controlClass =
  "min-h-target w-full rounded-control border border-border-strong bg-surface px-3 text-body text-ink placeholder:text-ink-muted focus-ring disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted aria-invalid:border-status-unavailable";

/** Spread on the control: <input id={id} {...fieldA11y(id, { hint, error })} />. Links the hint and error text and flags invalid. */
export function fieldA11y(id: string, { hint, error }: { hint?: ReactNode; error?: ReactNode }) {
  const ids: string[] = [];
  if (hint) ids.push(`${id}-hint`);
  if (error) ids.push(`${id}-error`);
  return {
    "aria-describedby": ids.length ? ids.join(" ") : undefined,
    "aria-invalid": error ? true : undefined,
  };
}

export function FieldHint({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  return (
    <p id={`${id}-hint`} className={`text-body-sm text-ink-muted ${className}`}>
      {children}
    </p>
  );
}

/**
 * Text is ink, not red: red is only 4.45:1 on mint. The error is carried by the icon, the word "Error" and the text,
 * and the control border turns red (3:1 non-text), so it is never colour alone.
 */
export function FieldError({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  return (
    <p id={`${id}-error`} className={`flex items-start gap-1.5 text-body-sm font-medium text-ink ${className}`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-status-unavailable"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <span>
        <VisuallyHidden>Error: </VisuallyHidden>
        {children}
      </span>
    </p>
  );
}

/** Label above, then hint, the control (children) and the error. `className` applies to the wrapper. */
export function Field({
  id,
  label,
  hint,
  error,
  className = "",
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-body-sm font-semibold text-ink">
        {label}
      </label>
      {hint ? <FieldHint id={id}>{hint}</FieldHint> : null}
      {children}
      {error ? <FieldError id={id}>{error}</FieldError> : null}
    </div>
  );
}
