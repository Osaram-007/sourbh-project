import type { NextConfig } from "next";

// ADR-0016. CSP_ENFORCE=1 enforces; anything else is report-only. Read at BUILD time and inlined into
// both this file and src/proxy.ts (via `env` below), so the two halves can never disagree. Changing it needs a rebuild.
const cspHeader =
  process.env.CSP_ENFORCE === "1" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

// Static CSP for every prerendered page. 'unsafe-inline' is acceptable only because these pages render no user
// content and load no third-party script (Hero inline script, JSON-LD, global-error inline styles).
const staticCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// The static policy is the floor on every page route (incl. 404, metadata routes, and case variants like /APP that the
// case-sensitive proxy matcher misses). Where the proxy also runs, its header of the same name replaces this one.
const staticSource = "/((?!api/|_next/).*)";

const nextConfig: NextConfig = {
  env: { CSP_ENFORCE: process.env.CSP_ENFORCE === "1" ? "1" : "" },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=()" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      { source: staticSource, headers: [{ key: cspHeader, value: staticCsp }] },
      // Firebase popup sign-in needs window.opener to survive.
      { source: "/login", headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }] },
    ];
  },
};

export default nextConfig;
