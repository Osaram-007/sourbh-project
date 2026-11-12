import type { Metadata } from "next";
import MarketingLayout from "./(marketing)/layout";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

// Sits outside (marketing), so it borrows that layout for the light surface, header, footer and skip link (no client JS).
// Plain <a>. New copy, pending founder sign-off (Q-W13).
export default function NotFound() {
  return (
    <MarketingLayout>
      <div className="mx-auto flex min-h-[50vh] w-full max-w-xl flex-col items-start justify-center gap-4 p-6">
        <h1 className="text-2xl font-bold text-brand">Page not found</h1>
        <p>We could not find that page.</p>
        <p className="flex gap-4 underline">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- plain link, no client JS */}
          <a href="/" className="focus-ring">Go to the home page</a>
          <a href="/app" className="focus-ring">Find a charger</a>
        </p>
      </div>
    </MarketingLayout>
  );
}
