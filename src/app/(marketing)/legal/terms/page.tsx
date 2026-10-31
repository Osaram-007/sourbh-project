import type { Metadata } from "next";
import { legal } from "@/content/legal";
import { LegalDocument } from "../_components/LegalDocument";

const doc = legal.documents.terms;

// No `robots` here: the site-wide SITE_NOINDEX flag in the root layout decides (WL-SEO-8).
export const metadata: Metadata = { title: doc.title, description: doc.description };

export default function Page() {
  return <LegalDocument doc={doc} />;
}
