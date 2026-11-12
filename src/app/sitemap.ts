import type { MetadataRoute } from "next";

// WL-SEO-2/7: indexable marketing + legal routes only; never /app, /admin, /api, /login, /account or stations.
// Fails closed like the root layout: needs APP_ORIGIN and SITE_NOINDEX=0, both read at build time.
const ROUTES = [
  "/",
  "/for-businesses",
  "/for-operators",
  "/about",
  "/legal/privacy",
  "/legal/terms",
  "/legal/disclaimer",
  "/legal/attributions",
  "/legal/delete-account",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = process.env.APP_ORIGIN;
  if (!origin || process.env.SITE_NOINDEX !== "0") return [];
  const base = new URL(origin).origin;
  return ROUTES.map((path) => ({ url: base + (path === "/" ? "" : path) }));
}
