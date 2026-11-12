"use client";

// Wraps every route, so it stays tiny: no icons, no libraries. New copy, pending founder sign-off (Q-W13).
export default function Error({ retry }: { error: Error; retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-start justify-center gap-4 p-6">
      <meta name="robots" content="noindex" />
      <h1 className="text-2xl font-bold text-[#0f7d38]">Something went wrong</h1>
      <p>Please try again.</p>
      <button type="button" onClick={() => retry()} className="rounded bg-[#0f7d38] px-4 py-2 text-white">
        Try again
      </button>
      <p className="flex gap-4 underline">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full reload after an error; Link would add JS */}
        <a href="/">Go to the home page</a>
        <a href="/app">Find a charger</a>
      </p>
    </main>
  );
}
