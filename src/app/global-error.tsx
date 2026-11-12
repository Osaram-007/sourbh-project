"use client";

// Replaces the root layout, so it brings its own <html>/<body> and inline styles (no globals.css here).
// New copy, pending founder sign-off (Q-W13).
export default function GlobalError({ retry }: { error: Error; retry: () => void }) {
  return (
    <html lang="en-IN">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 24, maxWidth: 560 }}>
        <meta name="robots" content="noindex" />
        <h1 style={{ color: "#0f7d38" }}>Something went wrong</h1>
        <p>Please try again.</p>
        <button type="button" onClick={() => retry()} style={{ background: "#0f7d38", color: "#fff", border: 0, borderRadius: 4, padding: "8px 16px" }}>
          Try again
        </button>
        <p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- no router context in global-error */}
          <a href="/">Go to the home page</a> · <a href="/app">Find a charger</a>
        </p>
      </body>
    </html>
  );
}
