import type { ComponentProps } from "react";
import { buttonClass, type ButtonStyle } from "./Button";

type IconButtonProps = Omit<ComponentProps<"button">, "aria-label" | "aria-labelledby"> &
  ButtonStyle & {
    /** Required accessible name (becomes aria-label). Say what it does ("Close"), not what it looks like ("X"). */
    label: string;
  };

/**
 * Icon-only button. `children` is the icon; it is hidden from assistive tech, so `label` is the name.
 * For a toggle (save, favourite) pass aria-pressed. Square target: md = 44px, sm = 32px. Defaults to the quiet variant.
 * Server-compatible (no "use client", no hooks). lucide-react 1.x icons are client components ("use client" + context),
 * so an icon rendered from a server component ships that JS: use an inline <svg> on JS-budget pages (landing).
 */
export function IconButton({ label, variant = "quiet", size, className = "", type = "button", children, ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} aria-label={label} className={`${buttonClass({ variant, size, iconOnly: true })} ${className}`}>
      <span aria-hidden="true" className="inline-flex">
        {children}
      </span>
    </button>
  );
}
