import { BuiltForYourEv } from "@/components/landing/BuiltForYourEv";
import { Explore } from "@/components/landing/Explore";
import { Hero } from "@/components/landing/Hero";
import { KnowBeforeYouGo } from "@/components/landing/KnowBeforeYouGo";
import { Problem } from "@/components/landing/Problem";
import { Steps } from "@/components/landing/Steps";
import { WorkWithUs } from "@/components/landing/WorkWithUs";

// WL-SEO-3. Name and URL only; no legal name, address or contact is invented. The URL is added only when APP_ORIGIN is set
// (read at build time, like the root layout). [FOUNDER: legal entity name and canonical domain, Q-C9, Q-A4.]
const origin = process.env.APP_ORIGIN;
const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "FullCharge",
  ...(origin && { url: new URL(origin).origin }),
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
