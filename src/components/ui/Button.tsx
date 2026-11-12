import type { ComponentProps } from "react";

/**
 * Button, ButtonLink and buttonClass. Server-compatible: no "use client", no hooks, every state is CSS.
 * md = 44px (primary touch target), sm = 32px (never below the 24px floor).
 * `className` is for layout only (width, margin); do not use it to restyle colours or padding.
 *
 * To style a next/link <Link> as a button, use `buttonClass()` and keep `prefetch={false}` on links to /app.
 * ButtonLink is a plain <a>: zero client JS, full page load.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control font-semibold focus-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:shrink-0";

// Classes appear literally so Tailwind generates them. hover: only applies on hover-capable pointers, so active:
// is the feedback a tap gets on touch.
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-hover active:bg-brand-hover",
  secondary: "border border-border-strong bg-surface text-ink hover:bg-mint active:bg-ink/10",
  quiet: "text-ink hover:bg-ink/5 active:bg-ink/10",
};
const SIZE: Record<ButtonSize, string> = {
  md: "min-h-target px-5 text-body",
  sm: "min-h-8 px-3 text-body-sm",
};
const ICON_SIZE: Record<ButtonSize, string> = { md: "size-target", sm: "size-8" };

export interface ButtonStyle {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** @param iconOnly square target with no padding (used by IconButton). */
export function buttonClass({ variant = "primary", size = "md", iconOnly = false }: ButtonStyle & { iconOnly?: boolean } = {}) {
  return `${BASE} ${VARIANT[variant]} ${iconOnly ? ICON_SIZE[size] : SIZE[size]}`;
}

/** `type` defaults to "button" (not "submit"): pass type="submit" explicitly in forms. */
export function Button({ variant, size, className = "", type = "button", ...rest }: ComponentProps<"button"> & ButtonStyle) {
  return <button type={type} {...rest} className={`${buttonClass({ variant, size })} ${className}`} />;
}

export function ButtonLink({ variant, size, className = "", ...rest }: ComponentProps<"a"> & ButtonStyle & { href: string }) {
  return <a {...rest} className={`${buttonClass({ variant, size })} ${className}`} />;
}
