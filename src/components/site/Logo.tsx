/**
 * PLACEHOLDER logo (Q-C8: no brand asset yet). A bolt drawn here, plus the name in the page font.
 * Both the header and the footer render this component, so swapping the final logo means replacing
 * the body of this file and nothing else. The bolt takes its colour from the --color-brand token.
 * Recorded in docs/asset-register.md. Server component, no client JS.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-7 shrink-0 text-brand" fill="currentColor">
        <path d="M14 1.5 4.5 13.5h5.8L8.8 22.5 19.5 9.8h-6z" />
      </svg>
      <span className="text-title font-bold tracking-tight text-ink">FullCharge</span>
    </span>
  );
}
