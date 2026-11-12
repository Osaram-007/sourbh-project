import type { MetadataRoute } from "next";
import { APP_ORIGIN, indexingOpen } from "@/lib/indexing";

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
  if (!indexingOpen) return [];
  const base = new URL(APP_ORIGIN!).origin;
  return ROUTES.map((path) => ({ url: base + (path === "/" ? "" : path) }));
}
