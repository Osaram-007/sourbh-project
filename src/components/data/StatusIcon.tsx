import { STATUS, type AvailabilityState, type StatusIconName } from "../../lib/status";

/**
 * The status icon: a filled shape in the status colour with a white glyph. Server component, no "use client",
 * no lucide-react. One lucide icon on `/` costs 548 bytes of JS (its Icon and context modules are client code),
 * so the four shapes are inlined here. Paths are from lucide (ISC licence), keyed by StatusIconName from status.ts.
 *
 * Colour is an SVG attribute (var(--color-status-*)), not a class and not a style attribute, so it works under any
 * CSP. White on a status fill is for glyphs only (3:1 non-text); the word next to the icon is always ink.
 * Hidden from assistive tech: the word beside it is the accessible name.
 */
const CIRCLE = "M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0z";

const ICON: Record<StatusIconName, { shape: string; glyph: string }> = {
  CircleCheck: { shape: CIRCLE, glyph: "m9 12 2 2 4-4" },
  TriangleAlert: {
    shape: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
    glyph: "M12 9v4M12 17h.01",
  },
  OctagonX: {
    shape:
      "M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z",
    glyph: "m15 9-6 6m0-6 6 6",
  },
  CircleQuestionMark: { shape: CIRCLE, glyph: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" },
};

/** `size` is in px (default 16). An unexpected state shows the grey Unknown icon, never a blank. */
export function StatusIcon({ state, size = 16 }: { state: AvailabilityState; size?: number }) {
  const { color, icon } = STATUS[state] ?? STATUS.UNKNOWN;
  const { shape, glyph } = ICON[icon];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-surface)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d={shape} fill={color} stroke={color} />
      <path d={glyph} />
    </svg>
  );
}
