// Moved here from the legal pages (WEB-A05) so the site footer and the legal pages share one null handling.
// Server component, no client JS. Never import src/content/legal.ts from a client component.

export const markerClass =
  "rounded-control border border-dashed border-border-strong bg-surface-muted px-1.5 py-0.5 text-body-sm text-ink-muted";

export const linkClass = "rounded-control font-semibold underline underline-offset-4 focus-ring";

/** A founder-supplied value, or the "To be confirmed" marker when it is not set. */
export function Fact({ value, email }: { value: string | null; email?: boolean }) {
  if (value === null || value.trim() === "") return <span className={markerClass}>To be confirmed</span>;
  if (email) {
    return (
      <a href={`mailto:${value}`} className={linkClass}>
        {value}
      </a>
    );
  }
  return <>{value}</>;
}
