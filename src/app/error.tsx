"use client";

// Wraps every route, so it stays tiny: no icons, no libraries. New copy, pending founder sign-off (Q-W13).
// Sits outside (marketing), so it sets its own light surface (body is still dark until WEB-B14).
export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex flex-1 flex-col bg-surface text-ink">
      <meta name="robots" content="noindex" />
      <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-start justify-center gap-4 p-6">
        <h1 className="text-2xl font-bold text-brand">Something went wrong</h1>
        <p>Please try again.</p>
        <button type="button" onClick={() => retry()} className="focus-ring rounded bg-brand px-4 py-2 text-on-brand">
          Try again
        </button>
        <p className="flex gap-4 underline">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full reload after an error; Link would add JS */}
          <a href="/" className="focus-ring">Go to the home page</a>
          <a href="/app" className="focus-ring">Find a charger</a>
        </p>
      </main>
    </div>
  );
}
