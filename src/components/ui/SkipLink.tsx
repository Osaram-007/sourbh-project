import type { ReactNode } from "react";

/**
 * First focusable element in the layout. Hidden off-screen until it has keyboard focus.
 * The layout must render `<main id="main-content" tabIndex={-1}>` (or pass another `href`).
 * Server-compatible (no "use client", no hooks); z-100 sits above sticky headers.
 */
export function SkipLink({
  href = "#main-content",
  children = "Skip to main content",
}: {
  href?: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={href}
      className="fixed left-4 top-4 z-100 -translate-y-[200%] rounded-control bg-brand px-4 py-3 font-semibold text-on-brand focus:translate-y-0 focus-ring"
    >
      {children}
    </a>
  );
}
