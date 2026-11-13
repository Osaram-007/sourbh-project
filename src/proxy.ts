import { NextRequest, NextResponse } from "next/server";

// ADR-0016: per-request nonce CSP for /app, /account, /login, /admin. Marketing/legal get a static CSP from
// next.config.ts. process.env.CSP_ENFORCE is inlined at build by next.config.ts `env`, same as the static half.
const headerName =
  process.env.CSP_ENFORCE === "1" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
const isDev = process.env.NODE_ENV === "development";

// Google Maps JS (Map.tsx loads it via @googlemaps/js-api-loader). Tiles/glyphs/styles come from these hosts.
const MAPS_SCRIPT = ["https://maps.googleapis.com", "https://maps.gstatic.com"];
const MAPS_IMG = [
  "https://maps.googleapis.com",
  "https://maps.gstatic.com",
  "https://*.googleapis.com",
  "https://*.gstatic.com",
  "https://*.ggpht.com",
  "https://*.googleusercontent.com",
];
const MAPS_CONNECT = ["https://maps.googleapis.com", "https://*.googleapis.com"];
// Firebase Auth popup/redirect + reCAPTCHA (ADR-0017, /login only).
const FIREBASE_SCRIPT = [
  "https://apis.google.com",
  "https://www.google.com/recaptcha/",
  "https://www.gstatic.com/recaptcha/",
];
const FIREBASE_CONNECT = [
  "https://identitytoolkit.googleapis.com",
  "https://securetoken.googleapis.com",
  "https://www.googleapis.com",
];
const FIREBASE_FRAME = [
  "https://*.firebaseapp.com",
  "https://accounts.google.com",
  "https://www.google.com/recaptcha/",
  "https://recaptcha.google.com",
];

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isApp = path === "/app" || path.startsWith("/app/");
  const isLogin = path === "/login";

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}${isApp ? " " + MAPS_SCRIPT.join(" ") : ""}${isLogin ? " " + FIREBASE_SCRIPT.join(" ") : ""}`,
    // Maps injects inline <style>, so /app needs 'unsafe-inline' (a nonce would make browsers ignore it). Elsewhere: nonce only.
    isApp ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'", // style="" attributes (admin charts); cannot run script
    `img-src 'self' data: blob:${isApp ? " " + MAPS_IMG.join(" ") : ""}`,
    "font-src 'self'",
    `connect-src 'self'${isApp ? " " + MAPS_CONNECT.join(" ") : ""}${isLogin ? " " + FIREBASE_CONNECT.join(" ") : ""}`,
    isApp ? "worker-src blob:" : "",
    isLogin ? `frame-src ${FIREBASE_FRAME.join(" ")}` : "",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ]
    .filter(Boolean)
    .join("; ");

  // Next reads the nonce from the request's CSP header while rendering; x-nonce is for our own components.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(headerName, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(headerName, csp);
  return response;
}

// Prefetches are excluded (Next CSP guide): they carry no document, so no nonce is needed.
export const config = {
  matcher: [
    {
      source: "/(app|account|login|admin)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      source: "/(app|account|login|admin)/:path*",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
