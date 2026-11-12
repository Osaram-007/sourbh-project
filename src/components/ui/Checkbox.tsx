import type { ComponentProps, ReactNode } from "react";
import { FieldError, FieldHint, fieldA11y } from "./Field";

type CheckboxProps = Omit<ComponentProps<"input">, "id" | "className" | "type" | "aria-describedby" | "aria-invalid"> & {
  /** Required: it ties the label, hint and error to the control. Must be unique on the page. */
  id: string;
  /** Visible label, to the right of the box. Clicking it toggles the box. May hold a link (e.g. a privacy policy). */
  label: ReactNode;
  hint?: ReactNode;
  /** Sets aria-invalid and shows the message, linked with aria-describedby. */
  error?: ReactNode;
  /** Applies to the wrapper (width, margin). */
  className?: string;
  /** false: the error is not role="alert" (forms that focus the first invalid field instead). */
  announce?: boolean;
};

/**
 * Labelled native checkbox. The box is 24px (the WCAG 2.5.8 target) and uses the brand accent colour.
 * Server-compatible (no "use client", no hooks).
 */
export function Checkbox({ id, label, hint, error, className = "", announce, ...rest }: CheckboxProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-start gap-3">
        <input
          {...rest}
          id={id}
          type="checkbox"
          {...fieldA11y(id, { hint, error })}
          className="size-target-min shrink-0 cursor-pointer accent-brand focus-ring disabled:cursor-not-allowed"
        />
        <label htmlFor={id} className="pt-px text-body text-ink">
          {label}
        </label>
      </div>
      {hint ? (
        <FieldHint id={id} className="pl-9">
          {hint}
        </FieldHint>
      ) : null}
      {error ? (
        <FieldError id={id} className="pl-9" announce={announce}>
          {error}
        </FieldError>
      ) : null}
    </div>
  );
}
