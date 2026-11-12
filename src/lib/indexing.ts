// One definition of "open to search engines" for layout.tsx, robots.ts and sitemap.ts (WL-SEO-2/8).
// Both env values are read at build time. Fails closed: indexing needs an explicit SITE_NOINDEX=0 AND an APP_ORIGIN.
export const APP_ORIGIN = process.env.APP_ORIGIN;
export const indexingOpen = process.env.SITE_NOINDEX === "0" && !!APP_ORIGIN;
