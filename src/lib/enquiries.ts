// Request contract for POST /api/v1/enquiries (WL-LAND-14). Shared by ContactForm (WEB-B03) and the route (WEB-D07).
// Plain constants and types only: no zod, so the client bundle stays small. D07 builds its zod schema from these.
// The caps are conservative picks (the spec gives none); change them here and both sides follow.

export const ENQUIRY_TYPES = ["BUSINESS", "OPERATOR", "OTHER"] as const;
export type EnquiryType = (typeof ENQUIRY_TYPES)[number];

export const ENQUIRY_MAX = { name: 100, email: 254, organisation: 150, message: 2000 } as const;

/** Honeypot: a hidden input that real users never fill. A honeypot hit must return the same 2xx as a real success and store nothing. */
export const ENQUIRY_HONEYPOT = "website";

export interface EnquiryRequest {
  name: string;
  email: string;
  /** Optional: sent as "" when blank. */
  organisation: string;
  type: EnquiryType;
  /** Optional: sent as "" when blank (the deck has no "enter a message" error). */
  message: string;
  /** Must be true (z.literal(true) on the server). */
  consent: true;
  /** Honeypot ("website"): always "" from a real user. */
  website: string;
}

/**
 * Optional 400 body: which fields failed. The form maps these to inline errors; anything else shows the generic error.
 * `fields` deliberately has no `organisation` or `type` key: the form cannot get those wrong in normal use, so an error
 * on either falls back to the generic error.
 */
export interface EnquiryErrorBody {
  fields?: Partial<Record<"name" | "email" | "message" | "consent", string>>;
}
