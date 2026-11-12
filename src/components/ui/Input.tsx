import type { ComponentProps, ReactNode } from "react";
import { controlClass, Field, fieldA11y } from "./Field";

type InputProps = Omit<ComponentProps<"input">, "id" | "className" | "aria-describedby" | "aria-invalid"> & {
  /** Required: it ties the label, hint and error to the control. Must be unique on the page. */
  id: string;
  /** Visible label (never placeholder-only). */
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
 * Labelled text input, 44px tall, 16px text. Everything else passes through, so set `autoComplete`, `inputMode`,
 * `required`, `name` and so on. Never block paste (WL-A11Y-6); OTP fields use autoComplete="one-time-code".
 * Server-compatible (no "use client", no hooks).
 */
export function Input({ id, label, hint, error, className, announce, type = "text", ...rest }: InputProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className} announce={announce}>
      <input {...rest} id={id} type={type} {...fieldA11y(id, { hint, error })} className={controlClass} />
    </Field>
  );
}
