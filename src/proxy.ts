import { NextRequest, NextResponse } from "next/server";

// ADR-0016: per-request nonce CSP for /app, /account, /login, /admin. Marketing/legal get a static CSP from
// next.config.ts. process.env.CSP_ENFORCE is inlined at build by next.config.ts `env`, same as the static half.
const headerName =
  process.env.CSP_ENFORCE === "1" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
const isDev = process.env.NODE_ENV === "development";

// Google Maps JS (Map.tsx: js-api-loader, base map only). Checked against
// https://developers.google.com/maps/documentation/javascript/content-security-policy (strict CSP + allowlist examples).
// Under 'strict-dynamic' the script-src host lists are a CSP2-browser fallback only; modern browsers ignore them.
const MAPS_SCRIPT = ["https://maps.googleapis.com", "https://maps.gstatic.com"];
// Left out of the guide's lists: https://*.ggpht.com in script-src and any *.googleapis.com wildcard in script-src/connect-src
// (the wildcard covers storage.googleapis.com, user-uploaded content); Street View / Places / Directions are unused.
const MAPS_IMG = ["https://*.googleapis.com", "https://*.gstatic.com", "https://*.google.com", "https://*.googleusercontent.com", "https://*.ggpht.com"];
const MAPS_CONNECT = ["https://maps.googleapis.com", "https://*.google.com", "https://*.gstatic.com", "data:", "blob:"];
const MAPS_FRAME = ["https://*.google.com"];
const MAPS_STYLE = ["https://fonts.googleapis.com"]; // Roboto stylesheet the API may inject
const MAPS_FONT = ["https://fonts.gstatic.com"];
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
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev || isApp ? " 'unsafe-eval'" : ""}${isApp ? " blob: " + MAPS_SCRIPT.join(" ") : ""}${isLogin ? " " + FIREBASE_SCRIPT.join(" ") : ""}`,
    // Guide wants a style nonce, but Maps injects inline <style> and Map.tsx is not nonce-aware, so /app needs 'unsafe-inline' (a nonce would make browsers ignore it). Elsewhere: nonce only.
    isApp ? `style-src 'self' 'unsafe-inline' ${MAPS_STYLE.join(" ")}` : `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'", // style="" attributes (admin charts); cannot run script
    `img-src 'self' data: blob:${isApp ? " " + MAPS_IMG.join(" ") : ""}`,
    `font-src 'self'${isApp ? " " + MAPS_FONT.join(" ") : ""}`,
    `connect-src 'self'${isApp ? " " + MAPS_CONNECT.join(" ") : ""}${isLogin ? " " + FIREBASE_CONNECT.join(" ") : ""}`,
    isApp ? "worker-src blob:" : "",
    isApp ? `frame-src ${MAPS_FRAME.join(" ")}` : "",
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
  requestHeaders.delete("content-security-policy");
  requestHeaders.delete("content-security-policy-report-only");
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(headerName, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(headerName, csp);
  return response;
}

// Prefetches are excluded (Next CSP guide): App Router prefetches send next-router-prefetch. One literal entry; it covers the bare prefix too.
export const config = {
  matcher: [
    {
      source: "/(app|account|login|admin)/:path*",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
