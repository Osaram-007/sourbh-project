import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

// Plain <a>, no client JS. New copy, pending founder sign-off (Q-W13).
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-start justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold text-[#0f7d38]">Page not found</h1>
      <p>We could not find that page.</p>
      <p className="flex gap-4 underline">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- plain link, no client JS */}
        <a href="/">Go to the home page</a>
        <a href="/app">Find a charger</a>
      </p>
    </main>
  );
}
