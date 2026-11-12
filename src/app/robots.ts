import type { MetadataRoute } from "next";

// WL-SEO-2/8. Same fail-closed rule as the root layout (build-time env).
export default function robots(): MetadataRoute.Robots {
  const origin = process.env.APP_ORIGIN;
  if (process.env.SITE_NOINDEX !== "0") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/admin", "/api", "/login", "/account"] },
    ...(origin && { sitemap: `${new URL(origin).origin}/sitemap.xml` }),
  };
}
