import type { Metadata } from "next";
import { ContactForm } from "@/components/contact/ContactForm";
import { CONTAINER } from "@/components/landing/shared";

// Copy deck sections 11, 13 and C. The root title template (WEB-B04) adds " | FullCharge"; OG fields come from the root defaults and the file-based image.
// Left out, not invented (all [FOUNDER], Q-C9 / Q-W12 open): paragraph 3 ("does not run charging stations", needs
// confirmation), "Who runs FullCharge" (legal entity, address) and "Grievance officer" (#grievance-officer).
const description = "What FullCharge is, where its charger information comes from, and how to get in touch.";
export const metadata: Metadata = {
  title: "About",
  description,
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <div className={`${CONTAINER} py-section`}>
      <h1 className="text-display font-extrabold tracking-tight text-ink">About FullCharge</h1>
      <div className="mt-6 flex max-w-2xl flex-col gap-4 text-body text-ink">
        <p>
          FullCharge helps drivers in India find EV chargers. Search by city, address or charger name. See connector types,
          price where listed, and availability where networks share it.
        </p>
        <p>
          Our charger information comes from public sources and from charging networks that share their data. We show what
          each source gives us. Where a source gives us nothing, we say so.
        </p>
        <p>Charger details and status can be out of date. Check with the charger or network before you travel.</p>
        <p>
          <a href="/legal/attributions" className="font-semibold underline">Read our attributions</a>
        </p>
      </div>
      <section id="contact" aria-labelledby="contact-title" className="mt-12 scroll-mt-24">
        <h2 id="contact-title" className="text-heading font-extrabold tracking-tight text-ink">Contact us</h2>
        <p className="mt-3 text-body text-ink">Send us a message using the form below.</p>
        <div className="mt-6">
          <ContactForm defaultType="OTHER" />
        </div>
      </section>
    </div>
  );
}
