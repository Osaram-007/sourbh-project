import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { Logo } from "./Logo";
import { FIND_A_CHARGER, HEADER_NAV, LOG_IN, OPEN_THE_MAP } from "./nav";

/**
 * Marketing header (WL-LAND-3). Server component: no "use client", no client JS, because `/` has under 1 KB of JS budget left.
 * Every link is a plain <a>, so a link to /app can never be prefetched, and following any link reloads the page,
 * which also closes the mobile menu. The menu is a native <details> (never a Dialog).
 * Below `xl` (1280px) the inline nav is hidden and the menu button is shown: the 5 links + 2 buttons wrap at 1024px.
 */

// Inline script, run before the header is painted. The static marketing CSP allows 'unsafe-inline' (ADR-0016).
//  1. fc_hint=1 (set and cleared with the session, ADR-0017): mark <html data-fc-hint>. CSS then shows "Open the map"
//     in place of "Log in". An inline script costs 0 bytes of first-load JS; a client island costs bytes the landing page does not have.
//     Known limit: a client-side navigation into / from /app does not run it. Links from the app to / must be plain <a>.
//  2. Escape, a click outside, or coming back to the page from the back-forward cache closes the mobile menu.
//     <details> does none of these by itself.
const SCRIPT =
  '(function(d){' +
  '/(^|; )fc_hint=1(;|$)/.test(d.cookie)&&d.documentElement.setAttribute("data-fc-hint","");' +
  'function o(){var m=d.getElementById("site-menu");return m&&m.open?m:null}' +
  'd.addEventListener("keydown",function(e){var m=o();if(m&&e.key==="Escape"){m.open=false;m.firstElementChild.focus()}});' +
  'd.addEventListener("click",function(e){var m=o();if(m&&!m.contains(e.target))m.open=false});' +
  'addEventListener("pageshow",function(){var m=o();if(m)m.open=false})' +
  '})(document)';

const navLink =
  "inline-flex min-h-target items-center rounded-control px-3 text-body-sm font-semibold text-ink hover:bg-mint active:bg-ink/10 focus-ring";

// The two labels share one slot. Both are in the HTML; with data-fc-hint on <html>, CSS swaps them.
// The wrapper has no display class of its own, so `hidden` and `contents` cannot fight over it.
const HIDE_WITH_HINT = "[html[data-fc-hint]_&]:hidden";
const SHOW_WITH_HINT = "hidden [html[data-fc-hint]_&]:contents";

function LogInOrOpenTheMap() {
  return (
    <>
      <ButtonLink href={LOG_IN.href} variant="secondary" className={HIDE_WITH_HINT}>
        {LOG_IN.label}
      </ButtonLink>
      <span className={SHOW_WITH_HINT}>
        <ButtonLink href={OPEN_THE_MAP.href} variant="secondary">
          {OPEN_THE_MAP.label}
        </ButtonLink>
      </span>
    </>
  );
}

export function SiteHeader() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
      <header className="relative z-40 border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-gutter lg:h-18 lg:px-8">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- plain <a> on purpose: no client JS, no prefetch, and a page load also closes the mobile menu */}
          <a href="/" className="inline-flex min-h-target items-center rounded-control focus-ring">
            <Logo />
          </a>

          <nav aria-label="Primary" className="hidden items-center gap-1 xl:flex">
            {HEADER_NAV.map((link) => (
              <a key={link.href} href={link.href} className={navLink}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 xl:flex">
            <LogInOrOpenTheMap />
            <ButtonLink href={FIND_A_CHARGER.href}>{FIND_A_CHARGER.label}</ButtonLink>
          </div>

          <details id="site-menu" className="group xl:hidden">
            <summary
              className={`${buttonClass({ variant: "secondary" })} cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-5 group-open:hidden" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="hidden size-5 group-open:block" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
              {/* The visible text is the accessible name, so it changes with the state. */}
              <span className="group-open:hidden">Menu</span>
              <span className="hidden group-open:inline">Close menu</span>
            </summary>
            <nav
              aria-label="Mobile menu"
              className="absolute inset-x-0 top-full max-h-[calc(100dvh-5rem)] overflow-y-auto border-b border-border bg-surface p-gutter shadow-popover sm:inset-x-auto sm:right-gutter sm:mt-2 sm:w-80 sm:rounded-card sm:border lg:right-8"
            >
              <ul className="flex flex-col gap-1">
                {HEADER_NAV.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} className={`${navLink} w-full text-body`}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
                <LogInOrOpenTheMap />
                <ButtonLink href={FIND_A_CHARGER.href}>{FIND_A_CHARGER.label}</ButtonLink>
              </div>
            </nav>
          </details>
        </div>
      </header>
    </>
  );
}
