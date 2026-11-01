import type { Metadata } from "next";
import Link from "next/link";
import { legal } from "@/content/legal";
import { Fact, LegalDocument, linkClass } from "../_components/LegalDocument";

const doc = legal.documents["delete-account"];

// No `robots` here: the site-wide SITE_NOINDEX flag in the root layout decides (WL-SEO-8).
export const metadata: Metadata = { title: doc.title, description: doc.description };

// DN-24: a static instructions page. The in-app path plus the support email; no form here.
export default function Page() {
  return (
    <LegalDocument doc={doc}>
      <section className="flex flex-col gap-3">
        <h2 id="in-app" className="text-title font-semibold">
          Delete your account in FullCharge
        </h2>
        <p>
          Log in, then open your{" "}
          <Link href="/account" prefetch={false} className={linkClass}>
            account page
          </Link>{" "}
          and use the option to delete your account.
        </p>
        {/* Wording follows copy-deck section 12 (same-method notice, DN-13): signing in the other way opens a different account. */}
        <p>
          Log in with the same method you used to create the account. A phone number and a Google account make
          separate FullCharge accounts. If you log in with the other method, you open a different account, and
          deleting it does not delete the first one.
        </p>
      </section>
      <section className="flex flex-col gap-3">
        <h2 id="help" className="text-title font-semibold">
          Need help?
        </h2>
        <p>
          Contact support at <Fact value={legal.contact.supportEmail} email />.
        </p>
      </section>
    </LegalDocument>
  );
}
