import { AvailabilityBadge } from "@/components/data/AvailabilityBadge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Icon } from "./Icon";
import { CONTAINER, Eyebrow, ExampleTag } from "./shared";

// "Use my location": a plain link to /app that works with no JS. The inline script (same approach as the header:
// 0 bytes of first-load JS; the static marketing CSP allows it, ADR-0016) asks for the position ONLY on click, then
// hands it to /app through sessionStorage key "fc_geo", never the URL (WL-LAND-6). Value: {lat,lng,t} or {error:code} (1 denied, 2 unavailable, 3 timeout).
// The /app page (WEB-B13) should read it once and remove it; error 1 means "default centre plus the location-off message".
const LOCATE_SCRIPT =
  '(function(d){var a=d.getElementById("fc-locate");if(!a)return;' +
  'a.addEventListener("click",function(e){if(!navigator.geolocation||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();if(a.getAttribute("aria-busy")==="true")return;a.setAttribute("aria-busy","true");setTimeout(function(){a.removeAttribute("aria-busy")},15e3);' +
  'function g(v){try{sessionStorage.setItem("fc_geo",JSON.stringify(v))}catch(x){}location.assign("/app")}' +
  'navigator.geolocation.getCurrentPosition(function(p){g({lat:p.coords.latitude,lng:p.coords.longitude,t:Date.now()})},function(e){g({error:e.code})},{timeout:10000,maximumAge:60000})});' +
  'addEventListener("pageshow",function(){a.removeAttribute("aria-busy")})})(document)';

/**
 * Example card (T-1, T-3, T-4): labelled, generic name, no operator brand, logo, photo, score, number or price.
 * [FOUNDER: neutral placeholder or licensed photo (T-4)]: the plug tile is a neutral stand-in.
 * The deck's "Close example" button is left out on purpose: it would be a control that does nothing.
 */
function ExampleCard() {
  return (
    <div className="w-full max-w-sm rounded-card border border-border bg-surface p-4 shadow-popover">
      <div className="flex h-24 items-center justify-center rounded-control bg-mint text-brand">
        <Icon name="plug" className="size-10" />
      </div>
      <div className="mt-4 flex items-start justify-between gap-3">
        <p className="text-title font-bold leading-snug text-ink">Example charging station</p>
        <ExampleTag />
      </div>
      <div className="mt-3">
        <AvailabilityBadge state="AVAILABLE" />
      </div>
      <ul className="mt-4 space-y-2 text-body-sm text-ink-muted">
        <li className="flex items-center gap-2"><Icon name="plug" className="size-4" />DC connector</li>
        <li className="flex items-center gap-2">Price not listed</li>
      </ul>
      <ButtonLink href="/app" className="mt-4 w-full">View Details</ButtonLink>
    </div>
  );
}

/** Rings and a dot grid from tokens only: depth without a photo (T-4) or a map (T-5, LEGAL-6). Decorative. */
function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -right-24 top-1/2 size-[34rem] -translate-y-1/2 rounded-full border border-brand/15 bg-brand/5" />
      <div className="absolute -right-4 top-1/2 size-[22rem] -translate-y-1/2 rounded-full border border-brand/20 bg-brand/5" />
      <div className="absolute right-12 top-1/2 size-[11rem] -translate-y-1/2 rounded-full border border-brand/25 bg-brand/10" />
      <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(var(--color-brand)_1px,transparent_1px)] opacity-10 [background-size:22px_22px] [mask-image:linear-gradient(to_left,black,transparent)]" />
    </div>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden bg-gradient-to-br from-mint via-surface to-mint">
      <HeroBackdrop />
      <div className={`${CONTAINER} relative grid items-center gap-10 py-section lg:grid-cols-[1.2fr_1fr] lg:gap-12 lg:py-20`}>
        <div>
          <Eyebrow>INDIA&apos;S EV CHARGING COMPANION</Eyebrow>
          {/* [FOUNDER: pick the headline, copy deck A. The recommended one is used for now.] */}
          <h1 id="hero-title" className="mt-3 text-display font-extrabold tracking-tight text-ink">
            Find an EV charger and <span className="text-brand">see the details before you go.</span>
          </h1>
          <p className="mt-5 text-title font-semibold text-ink">Find the right EV charger for your journey.</p>
          <p className="mt-2 max-w-xl text-lead text-ink-muted">
            Discover charging stations in India. Check availability where networks share it, speed, price where listed, and compatibility with your vehicle.
          </p>

          <form action="/app" method="get" role="search" className="mt-7 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end">
            <Input id="hero-q" name="q" type="search" label="Find a charger" placeholder="Search a city, address or charger" className="min-w-0 flex-1" />
            <Button type="submit" className="sm:shrink-0">
              <Icon name="search" className="size-4" />
              Search
            </Button>
          </form>

          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink id="fc-locate" href="/app" variant="secondary" className="aria-busy:cursor-progress aria-busy:opacity-60">
              <Icon name="pin" className="size-4" />
              Use my location
            </ButtonLink>
            <ButtonLink href="/app">Find a Charger</ButtonLink>
            <ButtonLink href="/app?vehicle=pick" variant="secondary">Add Your Vehicle</ButtonLink>
          </div>
          <script dangerouslySetInnerHTML={{ __html: LOCATE_SCRIPT }} />
          {/* [VERIFY: caption "Explore charging stations across India." needs the state-count check (T-1). Left out.] */}
          {/* [FOUNDER: hero map image. None until a licensed official-boundary asset exists (LEGAL-6, WDEC-12).] */}
        </div>

        <div className="flex justify-center lg:justify-end">
          <ExampleCard />
        </div>
      </div>
    </section>
  );
}
