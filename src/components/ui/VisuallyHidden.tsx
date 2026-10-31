import type { ComponentProps } from "react";

/** Text for screen readers only. Server-compatible (no "use client", no hooks). */
export function VisuallyHidden(props: Omit<ComponentProps<"span">, "className">) {
  return <span {...props} className="sr-only" />;
}
