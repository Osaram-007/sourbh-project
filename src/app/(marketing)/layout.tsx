import { SiteFooter } from "@/components/site/Footer";
import { SiteHeader } from "@/components/site/Header";
import { SkipLink } from "@/components/ui/SkipLink";

// Static group (ADR-0017): no providers, no session, no cookies()/headers(). Header and footer are server components.
// `body` is still dark until WEB-B14, so this group sets its own light surface.
// No `robots` anywhere in this group: the site-wide SITE_NOINDEX flag in the root layout decides (WL-SEO-8).
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-1 flex-col bg-surface text-ink">
      <SkipLink />
      <SiteHeader />
      {/* tabIndex -1 lets the skip link move focus here; main is not interactive, so it gets no outline. */}
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
