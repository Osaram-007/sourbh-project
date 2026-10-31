"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./IconButton";

/**
 * Modal dialog on the native <dialog> element: the browser makes the page behind it inert (focus cannot reach it),
 * closes on Esc and returns focus to the element that opened it. Client component: keep it out of marketing pages.
 *
 * Controlled. Always render it and toggle `open` (do not unmount it while open, or focus is not returned).
 * `onClose` fires when the user closes it (Esc or the Close button); set `open` to false there.
 * Focus lands on the first control in `children` (put `autoFocus` on a better one if needed), else on Close.
 *
 * Known limits: no backdrop-click close (Esc and Close only), no page scroll lock. A toast fired while a
 * modal is open is behind the modal and not announced, so show errors inside the dialog instead.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Becomes the accessible name (aria-labelledby) and the visible heading. */
  title: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Also fires after our own close() when `open` went false: only report a close the user caused.
      onClose={() => {
        if (open) onClose();
      }}
      // m-auto: Tailwind's preflight zeroes the margin that centres a modal dialog.
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-card border border-border bg-surface p-0 text-ink shadow-popover backdrop:bg-ink/50"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <h2 id={titleId} className="px-6 pb-4 pr-16 pt-6 text-title font-semibold">
          {title}
        </h2>
        <div className="overflow-y-auto px-6 pb-6">{children}</div>
      </div>
      {/* After the content in DOM order, so initial focus lands in the content, not on Close. */}
      <IconButton label="Close" size="sm" className="absolute right-4 top-4" onClick={() => ref.current?.close()}>
        <X className="size-5" />
      </IconButton>
    </dialog>
  );
}
