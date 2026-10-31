import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// ADR-0017: the root layout mounts no providers and reads no cookies/headers,
// so the marketing group can stay static. Providers live in the (app) and
// admin layouts.
//
// Data collection runs as a separate process — see `npm run sync:worker`
// and deploy/systemd/full-charge-sync.service — independent of the web app.

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Both values are read when the page is built (static routes), so changing
// either needs a rebuild.
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
// WL-SEO-8: the soft-launch switch. Fails closed: only an explicit SITE_NOINDEX=0 makes
// the site indexable; unset or any other value keeps every page out of search.
const siteNoIndex = process.env.SITE_NOINDEX !== "0";

export const metadata: Metadata = {
  metadataBase: new URL(APP_ORIGIN),
  title: "FullCharge | Find EV charging stations in India",
  description:
    "Find EV charging stations in India, with connector types and prices where they are available.",
  ...(siteNoIndex && { robots: { index: false, follow: false } }),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-IN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
