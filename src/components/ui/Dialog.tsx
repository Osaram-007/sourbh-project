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
 * `dismissible={false}` (a consent gate, say): no Close button, Esc does nothing, and the dialog only closes when the
 * parent sets `open` to false. `onClose` is never called.
 * Focus lands on the first focusable element in `children`, else on Close. Do not rely on `autoFocus` to pick another
 * control: it only works for content that is in the server-rendered HTML. For content that mounts when the dialog
 * opens, React focuses it before showModal() runs, while the dialog is still closed, and the focus is lost. Put the
 * control that should take focus first in the DOM instead.
 *
 * Known limits: no backdrop-click close (Esc and Close only), no page scroll lock. A toast fired while a
 * modal is open is behind the modal and not announced, so show errors inside the dialog instead.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  /** Becomes the accessible name (aria-labelledby) and the visible heading. */
  title: ReactNode;
  children: ReactNode;
  /** false: the user cannot close it (no Close button, Esc is ignored). Default true. */
  dismissible?: boolean;
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
      // cancel and close do not bubble, but a nested dialog can still deliver them here: act on our own events only.
      // Chrome lets a second Esc close the dialog even when cancel is prevented, so close also re-opens a dialog that
      // must stay open.
      onCancel={(e) => {
        if (e.target === e.currentTarget && !dismissible) e.preventDefault();
      }}
      // close also fires after our own close() when `open` went false: only react while `open` is still true.
      onClose={(e) => {
        if (e.target !== e.currentTarget || !open) return;
        if (dismissible) onClose();
        else ref.current?.showModal();
      }}
      // m-auto: Tailwind's preflight zeroes the margin that centres a modal dialog.
      // The dialog caps its height and clips; only the content area scrolls (one scrollbar). The inner div is 2px
      // shorter because of the 1px border on each side.
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-card border border-border bg-surface p-0 text-ink shadow-popover backdrop:bg-ink/50"
    >
      <div className="flex max-h-[calc(100dvh-2rem-2px)] flex-col">
        <h2 id={titleId} className={`px-6 pb-3 pt-6 text-title font-semibold ${dismissible ? "pr-16" : ""}`}>
          {title}
        </h2>
        {/* pt-1: the focus ring of the first control would be clipped by the scroll area otherwise. */}
        <div className="overflow-y-auto px-6 pb-6 pt-1">{children}</div>
      </div>
      {/* After the content in DOM order, so initial focus lands in the content, not on Close. 44px: the only exit on touch. */}
      {dismissible ? (
        <IconButton label="Close" className="absolute right-2 top-2" onClick={() => ref.current?.close()}>
          <X className="size-5" />
        </IconButton>
      ) : null}
    </dialog>
  );
}
