import type { ComponentProps, ReactNode } from "react";
import { controlClass, Field, fieldA11y } from "./Field";

type SelectProps = Omit<ComponentProps<"select">, "id" | "className" | "multiple" | "aria-describedby" | "aria-invalid"> & {
  /** Required: it ties the label, hint and error to the control. Must be unique on the page. */
  id: string;
  /** Visible label. */
  label: ReactNode;
  hint?: ReactNode;
  /** Sets aria-invalid, the red border and the message, linked with aria-describedby. */
  error?: ReactNode;
  /** Applies to the wrapper (width, margin). */
  className?: string;
  /** false: the error is not role="alert" (forms that focus the first invalid field instead). */
  announce?: boolean;
};

/**
 * Labelled native <select> (single choice), 44px tall. `children` are the <option>s. The native control keeps
 * keyboard and mobile pickers working. Server-compatible (no "use client", no hooks); the chevron is inline SVG.
 */
export function Select({ id, label, hint, error, className, announce, children, ...rest }: SelectProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className} announce={announce}>
      <div className="relative">
        <select {...rest} id={id} {...fieldA11y(id, { hint, error })} className={`${controlClass} appearance-none pr-10`}>
          {children}
        </select>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-5 -translate-y-1/2 text-ink-muted"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    </Field>
  );
}
