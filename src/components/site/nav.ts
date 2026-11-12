// Links for the marketing header and footer (WEB-A05). One list, so the two never drift.
// Wording and targets follow the copy deck, sections 1 and 8. WL-LAND-3: no Trip Planner.
// /for-businesses, /for-operators and /about exist (WEB-B03). /login does not exist yet (WEB-B06).

export interface SiteLink {
  label: string;
  href: string;
}

const findChargers = { label: "Find Chargers", href: "/app" };
// An anonymous visitor picks a vehicle in the in-app dialog (WEB-B16).
const vehicles = { label: "Vehicles", href: "/app?vehicle=pick" };
const forBusinesses = { label: "For Businesses", href: "/for-businesses" };
const forOperators = { label: "For Charging Operators", href: "/for-operators" };
const about = { label: "About", href: "/about" };

/** The header navigation, in WL-LAND-3 order. */
export const HEADER_NAV: SiteLink[] = [findChargers, vehicles, forBusinesses, forOperators, about];

/** "Log in" goes through /login, which sends a signed-in visitor straight on to `next`. */
export const LOG_IN: SiteLink = { label: "Log in", href: "/login?next=/app" };
/** Shown in place of "Log in" once the fc_hint cookie is present (ADR-0017). */
export const OPEN_THE_MAP: SiteLink = { label: "Open the map", href: "/app" };
export const FIND_A_CHARGER: SiteLink = { label: "Find a Charger", href: "/app" };

export const FOOTER_GROUPS: { title: string; links: SiteLink[] }[] = [
  { title: "Find", links: [findChargers, vehicles] },
  { title: "Work with us", links: [forBusinesses, forOperators] },
  {
    title: "Company",
    links: [
      about,
      { label: "Contact", href: "/about#contact" },
      { label: "Grievance officer", href: "/about#grievance-officer" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "/legal/privacy" },
      { label: "Terms of Use", href: "/legal/terms" },
      { label: "Disclaimer", href: "/legal/disclaimer" },
      { label: "Attributions", href: "/legal/attributions" },
      { label: "Delete your account", href: "/legal/delete-account" },
    ],
  },
];
