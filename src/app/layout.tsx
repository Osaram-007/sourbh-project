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
// either needs a rebuild. APP_ORIGIN has no fallback: unset means no metadataBase,
// so a forgotten value never produces localhost URLs.
const APP_ORIGIN = process.env.APP_ORIGIN;
// WL-SEO-8: the soft-launch switch. Fails closed: only an explicit SITE_NOINDEX=0 makes
// the site indexable; unset or any other value keeps every page out of search.
const siteNoIndex = process.env.SITE_NOINDEX !== "0";

export const metadata: Metadata = {
  metadataBase: APP_ORIGIN ? new URL(APP_ORIGIN) : undefined,
  // Copy deck section 13. WL-SEO-5: no "real-time" or "all major networks" (WL-LAND-5, T-2, T-3).
  // A page that sets its own openGraph replaces this object, so it repeats siteName/type.
  title: { default: "FullCharge: Find EV chargers in India", template: "%s | FullCharge" },
  description:
    "Search EV chargers in India by city, address or charger name. See connector types, price where listed, and availability where networks share it.",
  openGraph: { siteName: "FullCharge", type: "website", locale: "en_IN" },
  twitter: { card: "summary_large_image" },
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
