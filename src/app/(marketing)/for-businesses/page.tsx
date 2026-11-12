import type { Metadata } from "next";
import { ContactForm } from "@/components/contact/ContactForm";
import { CONTAINER } from "@/components/landing/shared";

// Copy deck sections 9, 13 and C. `absolute`: the root title template (WEB-B04) must not add a second suffix.
// [FOUNDER: one line on what FullCharge offers businesses] is left out: no copy is invented (Q-W13).
const description = "Tell FullCharge about your business. Send us a message through the contact form.";
export const metadata: Metadata = {
  title: { absolute: "For businesses | FullCharge" },
  description,
  alternates: { canonical: "/for-businesses" },
  openGraph: { title: "For businesses | FullCharge", description },
};

export default function ForBusinessesPage() {
  return (
    <div className={`${CONTAINER} py-section`}>
      <h1 className="text-display font-extrabold tracking-tight text-ink">For businesses</h1>
      <p className="mt-4 max-w-2xl text-lead text-ink-muted">Tell us about your business. We would like to hear from you.</p>
      <p className="mt-4 max-w-2xl text-body text-ink">
        FullCharge helps drivers in India find EV chargers. If your business is interested in EV charging, send us a message below.
      </p>
      <div className="mt-10">
        <ContactForm defaultType="BUSINESS" />
      </div>
    </div>
  );
}
