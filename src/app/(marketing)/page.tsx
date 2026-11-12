import type { Metadata } from "next";
import { BuiltForYourEv } from "@/components/landing/BuiltForYourEv";
import { Explore } from "@/components/landing/Explore";
import { Hero } from "@/components/landing/Hero";
import { KnowBeforeYouGo } from "@/components/landing/KnowBeforeYouGo";
import { Problem } from "@/components/landing/Problem";
import { Steps } from "@/components/landing/Steps";
import { WorkWithUs } from "@/components/landing/WorkWithUs";
import { alt as ogAlt, size as ogSize } from "../opengraph-image";

// WL-SEO-3. Name and URL only; no legal name, address or contact is invented. The URL is added only when APP_ORIGIN is set
// (read at build time, like the root layout). [FOUNDER: legal entity name and canonical domain, Q-C9, Q-A4.]
const origin = process.env.APP_ORIGIN;
const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "FullCharge",
  ...(origin && { url: new URL(origin).origin }),
};

// Copy deck section 13. Title and description are the root defaults (same words), so they are not repeated here.
// Canonical is set only with APP_ORIGIN, so an unset origin never emits a relative canonical.
// A page-level openGraph replaces the root one and drops the file-convention image, so it is named here.
// ponytail: the file convention's ?hash cache-buster cannot be referenced from metadata (it is made at build time), so the plain path is used.
export const metadata: Metadata = {
  ...(origin && { alternates: { canonical: "/" } }),
  openGraph: {
    siteName: "FullCharge",
    type: "website",
    locale: "en_IN",
    title: "FullCharge: Find EV chargers in India",
    description: "Find an EV charger and see the details before you go.",
    images: [{ url: "/opengraph-image", width: ogSize.width, height: ogSize.height, alt: ogAlt, type: "image/png" }],
  },
  twitter: { card: "summary_large_image", images: [{ url: "/opengraph-image", alt: ogAlt }] },
};

// Static page (WL-LAND-1): no cookies(), no session, no data fetching. Sections follow spec 8.6.
// No `robots` here: the site-wide SITE_NOINDEX flag decides (WL-SEO-8).
export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organization).replace(/</g, "\\u003c") }} />
      <Hero />
      <Steps />
      <Problem />
      <Explore />
      <KnowBeforeYouGo />
      <BuiltForYourEv />
      <WorkWithUs />
    </>
  );
}
