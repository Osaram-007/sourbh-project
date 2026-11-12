import type { ReactNode } from "react";

/** Same container string as the header and footer (each keeps its own copy): keeps section edges aligned. */
export const CONTAINER = "mx-auto max-w-7xl px-gutter lg:px-8";

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-body-sm font-bold uppercase tracking-widest text-brand">{children}</p>;
}

/** The visible "Example" label (T-1, WL-LAND-4). Every sample on the page carries one. */
export function ExampleTag() {
  return (
    <span className="inline-flex items-center rounded-full border border-border-strong bg-surface px-2.5 py-0.5 text-body-sm font-semibold text-ink">
      Example
    </span>
  );
}
