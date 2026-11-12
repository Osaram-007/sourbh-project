import type { MetadataRoute } from "next";
import { APP_ORIGIN, indexingOpen } from "@/lib/indexing";

// WL-SEO-2/8. Rules match by prefix, so "Disallow: /app" would also block /apple-icon; the longer Allow wins.
export default function robots(): MetadataRoute.Robots {
  if (!indexingOpen) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: ["/", "/apple-icon"], disallow: ["/app", "/admin", "/api", "/login", "/account"] },
    sitemap: `${new URL(APP_ORIGIN!).origin}/sitemap.xml`,
  };
}
