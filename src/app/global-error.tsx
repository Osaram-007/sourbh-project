"use client";

// Replaces the root layout, so it brings its own <html>/<body> and inline styles (no globals.css here, so hex stays).
// New copy, pending founder sign-off (Q-W13).
export default function GlobalErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en-IN">
      <head>
        <title>Something went wrong | FullCharge</title>
        <meta name="robots" content="noindex" />
      </head>
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 24, maxWidth: 560 }}>
        <main>
          <h1 style={{ color: "#0f7d38" }}>Something went wrong</h1>
          <p>Please try again.</p>
          <button type="button" onClick={() => retry()} style={{ background: "#0f7d38", color: "#fff", border: 0, borderRadius: 4, padding: "8px 16px" }}>
            Try again
          </button>
          <p>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full reload after a root-layout crash */}
            <a href="/">Go to the home page</a> · <a href="/app">Find a charger</a>
          </p>
        </main>
      </body>
    </html>
  );
}
