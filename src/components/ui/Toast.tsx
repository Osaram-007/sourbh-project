"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { IconButton } from "./IconButton";

/**
 * Toasts, the replacement for alert(). Mount <Toaster /> once per app shell, then call toast() from anywhere
 * on the client (event handlers, query callbacks):
 *
 *   toast("Link copied");
 *   toast("Could not copy the link", { kind: "error" });
 *
 * Info and success disappear after 6 s (override with `duration` in ms, 0 = stay until dismissed); errors stay until
 * dismissed. The timer pauses while the pointer or keyboard focus is on the toast. At most 3 show at once.
 * Announced politely through an always-present live region. Client component: keep it out of marketing pages.
 * Known limit: a toast fired while a modal <Dialog> is open is behind it and not announced.
 */
type Kind = "info" | "success" | "error";
interface Item {
  id: number;
  message: string;
  kind: Kind;
  duration: number;
}

// Module-level store: toast() has to work outside React. The server never calls it, so no per-request state leaks.
let items: Item[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const NONE: Item[] = [];

function set(next: Item[]) {
  items = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function toast(message: string, { kind = "info", duration }: { kind?: Kind; duration?: number } = {}) {
  const id = nextId++;
  set([...items, { id, message, kind, duration: duration ?? (kind === "error" ? 0 : 6000) }].slice(-3));
  return id;
}

export function dismissToast(id: number) {
  set(items.filter((t) => t.id !== id));
}

const ICON = { info: Info, success: CircleCheck, error: CircleAlert } as const;
// Icon colours are 3:1 non-text; the message itself is always ink.
const ICON_COLOR: Record<Kind, string> = { info: "text-ink", success: "text-brand", error: "text-status-unavailable" };

function ToastItem({ id, message, kind, duration }: Item) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!duration || paused) return;
    const timer = setTimeout(() => dismissToast(id), duration);
    return () => clearTimeout(timer);
  }, [id, duration, paused]);

  const Icon = ICON[kind];
  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border border-border bg-surface p-3 pl-4 text-ink shadow-popover"
    >
      <Icon aria-hidden="true" className={`mt-1.5 size-5 shrink-0 ${ICON_COLOR[kind]}`} />
      <p className="flex-1 py-1.5 text-body-sm">{message}</p>
      <IconButton label="Dismiss notification" size="sm" onClick={() => dismissToast(id)}>
        <X className="size-4" />
      </IconButton>
    </div>
  );
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => NONE);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4">
      {list.map((t) => (
        <ToastItem key={t.id} {...t} />
      ))}
    </div>
  );
}
