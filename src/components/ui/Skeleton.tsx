/**
 * Loading placeholder block. Size it with `className` (e.g. "h-4 w-32").
 * It is hidden from assistive tech: the loading region announces itself (a role="status" or aria-busy
 * container, with a <VisuallyHidden>Loading</VisuallyHidden> inside).
 * Server-compatible (no "use client", no hooks). motion-safe: no pulse under prefers-reduced-motion.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded-control bg-border motion-safe:animate-pulse ${className}`} />;
}
