// T3-09: the single source for legal facts, document versions and page structure.
// Read by src/app/(marketing)/legal/**, and later by the site footer (WEB-A05), About (WEB-B03)
// and the config endpoint (T1-16, versions and paths).
//
// NOTHING HERE IS LEGAL ADVICE OR APPROVED TEXT. Every founder fact is null until the founder
// supplies it (Q-C9 entity, address, contacts, grievance officer, versions, dates; Q-C10 retention).
// Section `body` is null until counsel supplies the text. Never put a guess in place of a null.
// A page shows "To be confirmed" for a null value and a draft placeholder for a null body.
//
// Production gate (WL-LEGAL-2): with APP_ENV=production, importing this module throws when any value
// is null, blank, or a section is still marked `draft`. `next build` imports it while prerendering
// /legal/*, so the production build fails with the list below. With APP_ENV unset (dev, staging, CI)
// nothing is checked.

export type LegalSlug = "privacy" | "terms" | "disclaimer" | "attributions" | "delete-account";

/** Calendar date as YYYY-MM-DD. */
export type LegalDate = `${number}-${number}-${number}`;

export interface LegalSection {
  /** Anchor id; also lets a build error name the section. */
  id: string;
  heading: string;
  /** Paragraphs approved by counsel, one string each. null = not supplied yet. */
  body: string[] | null;
  /** true = text written by the build team, not yet confirmed by counsel. Blocks a production build. */
  draft?: true;
}

export interface LegalDocument {
  title: string;
  description: string;
  path: `/legal/${LegalSlug}`;
  /** Version label used for consent records (T1-14). null until the text is approved. */
  version: string | null;
  /** Date the version takes effect. null until the text is approved. */
  effectiveDate: LegalDate | null;
  sections: LegalSection[];
}

export interface LegalConfig {
  entity: {
    /** Legal entity name. */
    name: string | null;
    registeredAddress: string | null;
  };
  contact: {
    /** Support email. Shown on every legal page and used by /legal/delete-account (DN-24). */
    supportEmail: string | null;
  };
  grievanceOfficer: {
    name: string | null;
    email: string | null;
    postalAddress: string | null;
    /** Response time as counsel words it. */
    responseTime: string | null;
  };
  documents: Record<LegalSlug, LegalDocument>;
}

export const legal: LegalConfig = {
  entity: { name: null, registeredAddress: null },
  contact: { supportEmail: null },
  grievanceOfficer: { name: null, email: null, postalAddress: null, responseTime: null },
  documents: {
    privacy: {
      title: "Privacy Policy",
      description: "How FullCharge handles your personal information.",
      path: "/legal/privacy",
      version: null,
      effectiveDate: null,
      // Headings are a skeleton for counsel to keep, rename or replace.
      sections: [
        { id: "information-we-collect", heading: "Information we collect", body: null },
        { id: "how-we-use-information", heading: "How we use information", body: null },
        { id: "sharing", heading: "Who we share information with", body: null },
        { id: "cookies-and-storage", heading: "Cookies and local storage", body: null },
        { id: "retention", heading: "How long we keep information", body: null }, // Q-C10
        { id: "your-choices", heading: "Your choices and rights", body: null },
        { id: "changes", heading: "Changes to this policy", body: null },
      ],
    },
    terms: {
      title: "Terms of Use",
      description: "The terms for using FullCharge.",
      path: "/legal/terms",
      version: null,
      effectiveDate: null,
      sections: [
        { id: "using-fullcharge", heading: "Using FullCharge", body: null },
        { id: "accounts", heading: "Accounts", body: null },
        { id: "reviews", heading: "Reviews", body: null },
        { id: "charger-information", heading: "Charger information", body: null },
        { id: "liability", heading: "Liability", body: null },
        { id: "governing-law", heading: "Governing law and jurisdiction", body: null },
        { id: "changes", heading: "Changes to these terms", body: null },
      ],
    },
    disclaimer: {
      title: "Disclaimer",
      description: "Limits on the charger information FullCharge shows.",
      path: "/legal/disclaimer",
      version: null,
      effectiveDate: null,
      sections: [
        {
          id: "charger-information",
          heading: "Charger information and availability",
          // Wording from the copy deck footer (docs/design/copy-deck.md section 8); not yet signed off.
          body: [
            "Charger details and status can be out of date. Check with the charger or network before you travel.",
          ],
          draft: true,
        },
        { id: "other-sources", heading: "Information from other sources", body: null },
        { id: "liability", heading: "Limitation of liability", body: null },
      ],
    },
    attributions: {
      title: "Attributions",
      description: "Where the charger and map data on FullCharge comes from.",
      path: "/legal/attributions",
      version: null,
      effectiveDate: null,
      sections: [
        {
          id: "public-data",
          heading: "Public data sources",
          // Wording from the copy deck footer. Exact wording and licence terms are for counsel (T-6, Q-C12).
          body: ["Charger data includes information from OpenStreetMap contributors and Open Charge Map."],
          draft: true,
        },
        // Pending the source classification (Q-C12). Name no operator until a source is approved (T-3).
        { id: "network-sources", heading: "Charging network data", body: null },
        { id: "map-data", heading: "Map data", body: null },
      ],
    },
    "delete-account": {
      title: "Delete your account",
      description: "How to delete your FullCharge account.",
      path: "/legal/delete-account",
      version: null,
      effectiveDate: null,
      // The in-app path and the support email are rendered by the page itself (DN-24).
      sections: [{ id: "what-happens", heading: "What happens to your information", body: null }], // Q-C10
    },
  },
};

const isBlank = (value: unknown) => value === null || (typeof value === "string" && value.trim() === "");

/** Where a value is missing: dotted paths of null, blank or empty values, plus sections still marked draft. */
export function pendingLegalItems(config: LegalConfig): string[] {
  const out: string[] = [];
  const walk = (value: unknown, path: string) => {
    // An empty array, or one whose entries are all blank, is as missing as null (a heading with no text).
    if (isBlank(value) || (Array.isArray(value) && value.every(isBlank))) out.push(`${path}: not set`);
    else if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        const id = (child as { id?: unknown } | null)?.id; // name sections by id, not array index
        walk(child, `${path}.${typeof id === "string" ? id : key}`);
      }
    }
  };
  walk(config, "legal");
  for (const [slug, doc] of Object.entries(config.documents)) {
    for (const section of doc.sections) {
      if (section.draft) out.push(`legal.documents.${slug}.sections.${section.id}: still marked draft`);
    }
  }
  return out;
}

/** Throws one error listing everything still missing. */
export function assertLegalReady(config: LegalConfig): void {
  const pending = pendingLegalItems(config);
  if (pending.length === 0) return;
  throw new Error(
    `Production build blocked: ${pending.length} legal value(s) in src/content/legal.ts are missing or still draft (APP_ENV=production).\n` +
      pending.map((item) => `  - ${item}`).join("\n") +
      "\nFill them in with the founder's facts (Q-C9, Q-C10) and counsel's texts, or build without APP_ENV=production.",
  );
}

if (process.env.APP_ENV === "production") assertLegalReady(legal);
