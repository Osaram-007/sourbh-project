import type { Metadata } from "next";
import { ContactForm } from "@/components/contact/ContactForm";
import { CONTAINER } from "@/components/landing/shared";

// Copy deck sections 10, 13 and C. The root title template (WEB-B04) adds " | FullCharge"; OG fields come from the root defaults and the file-based image.
// Left out, not invented: the [VERIFY] source-approval sentence (true only once G7/Q-C12 are live) and the
// [FOUNDER: one line on what FullCharge offers operators] line.
const description = "Tell FullCharge about your charging stations or network. Send us a message through the contact form.";
export const metadata: Metadata = {
  title: "For charging operators",
  description,
  alternates: { canonical: "/for-operators" },
};

export default function ForOperatorsPage() {
  return (
    <div className={`${CONTAINER} py-section`}>
      <h1 className="text-display font-extrabold tracking-tight text-ink">For charging operators</h1>
      <p className="mt-4 max-w-2xl text-lead text-ink-muted">Run EV charging stations in India? We would like to hear from you.</p>
      <p className="mt-4 max-w-2xl text-body text-ink">
        Tell us about your stations or your network, and what you would like to discuss.
      </p>
      <div className="mt-10">
        <ContactForm defaultType="OPERATOR" />
      </div>
    </div>
  );
}
