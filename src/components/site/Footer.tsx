import { legal } from "@/content/legal";
import { Fact } from "./Fact";
import { Logo } from "./Logo";
import { FOOTER_GROUPS } from "./nav";

/**
 * Marketing footer (WL-LAND-10). Server component, no client JS. Plain <a> links, so nothing is prefetched.
 * Founder facts come from src/content/legal.ts through Fact: a null shows "To be confirmed", never a guess.
 * The deck's two one-line notices (data attribution, disclaimer) are not repeated here: they live on the
 * Attributions and Disclaimer pages, where the production gate in legal.ts checks them.
 */

const footerLink =
  "inline-flex min-h-8 items-center rounded-control text-body-sm text-ink-muted hover:text-ink hover:underline hover:underline-offset-4 focus-ring";

export function SiteFooter() {
  const { entity } = legal;
  return (
    <footer className="border-t border-border bg-surface-muted">
      <div className="mx-auto max-w-7xl px-gutter py-12 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
          <div className="flex flex-col gap-3">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- plain <a> on purpose: no client JS, no prefetch, and a page load also closes the mobile menu */}
            <a href="/" className="inline-flex min-h-target w-fit items-center rounded-control focus-ring">
              <Logo />
            </a>
            <p className="max-w-xs text-body-sm text-ink-muted">Find EV chargers in India.</p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
            {FOOTER_GROUPS.map((group) => (
              <div key={group.title}>
                <h2 className="mb-2 text-body-sm font-semibold text-ink">{group.title}</h2>
                <ul className="flex flex-col">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <a href={link.href} className={footerLink}>
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 text-body-sm text-ink-muted">
          <dl className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-8">
            <div className="min-w-0">
              <dt className="inline font-semibold text-ink">Legal entity: </dt>
              <dd className="inline break-words">
                <Fact value={entity.name} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="inline font-semibold text-ink">Registered address: </dt>
              <dd className="inline whitespace-pre-line break-words">
                <Fact value={entity.registeredAddress} />
              </dd>
            </div>
          </dl>
          {/* No year: legal.ts holds none, and a year computed at build time goes stale until the next deploy. */}
          <p>&copy; {entity.name?.trim() || "FullCharge"}</p>
        </div>
      </div>
    </footer>
  );
}
