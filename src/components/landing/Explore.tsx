import { AvailabilityBadge } from "@/components/data/AvailabilityBadge";
import { ButtonLink } from "@/components/ui/Button";
import type { AvailabilityState } from "@/lib/status";
import { Icon, type IconName } from "./Icon";
import { CONTAINER, Eyebrow } from "./shared";

// Copy deck section 5.
// [VERIFY: the deck's H2 "Your next charger is closer than you think." is a proximity claim; left out. The H2 below is a plain restatement of the body.]
// [VERIFY: "across India" and the station/state counts (T-1); "in India" is used and no number appears (WDEC-12).]
// [VERIFY: at least two networks approved and served (G7, Q-C12); the single-network wording is used.]
// [FOUNDER: name the approved networks after registry approval (Q-C12, T-3).]
// [FOUNDER: preview map. None until a licensed map asset exists (T-5, LEGAL-6).]
const FEATURES: { title: string; text: string; icon: IconName }[] = [
  { title: "Location", text: "Find chargers near you, or in a city you search for.", icon: "pin" },
  { title: "Vehicle compatibility", text: "Add your vehicle to see chargers with a connector it supports.", icon: "car" },
  { title: "Charging networks", text: "Chargers from a charging network.", icon: "share" },
  { title: "Charger type", text: "AC or DC chargers.", icon: "plug" },
  { title: "Charging speed", text: "See the charging speed of each charger, where the network lists it.", icon: "gauge" },
  { title: "Advanced filters", text: "Filter by price (where listed), amenities and more.", icon: "sliders" },
];

const SAMPLES: { name: string; state: AvailabilityState; note?: string }[] = [
  { name: "Sample charging station A", state: "AVAILABLE" },
  { name: "Sample charging station B", state: "LIMITED" },
  { name: "Sample charging station C", state: "UNKNOWN", note: "Status unavailable. Update time unknown." },
];

/** Built from HTML, not an image: no photos, no operator names, no numbers, no prices, no scores (T-1, T-3, T-4, WDEC-12). Not interactive. */
function AppPreview() {
  return (
    <div className="relative min-w-0">
      <div aria-hidden="true" className="absolute -inset-3 rounded-sheet bg-mint lg:-inset-5" />
      <figure className="relative min-w-0 overflow-hidden rounded-card border border-border bg-surface shadow-popover">
        <figcaption className="border-b border-border bg-mint px-4 py-2 text-body-sm font-semibold text-ink">
          Example preview. Sample chargers only.
        </figcaption>
        <div className="space-y-3 p-3 sm:p-4">
          <div className="flex min-h-target items-center gap-2 rounded-control border border-border-strong px-3 text-body text-ink-muted">
            <Icon name="search" className="size-4" />
            Search a city, address or charger
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-body-sm">
            <p className="font-semibold text-ink">Chargers found near you</p>
            <p className="inline-flex items-center gap-1 rounded-control border border-border px-2 py-1 text-ink">
              Sort by: Distance
              <Icon name="chevronDown" className="size-4" />
            </p>
          </div>
          <ul className="space-y-3">
            {SAMPLES.map((s) => (
              <li key={s.name} className="flex items-start gap-3 rounded-card border border-border p-3">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-control bg-mint text-brand">
                  <Icon name="plug" className="size-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{s.name}</p>
                  <div className="mt-1.5">
                    <AvailabilityBadge state={s.state} />
                  </div>
                  <p className="mt-1.5 text-body-sm text-ink-muted">DC connector &middot; Price not listed</p>
                  {s.note ? <p className="text-body-sm text-ink-muted">{s.note}</p> : null}
                </div>
                <Icon name="heart" className="mt-1 size-5 text-ink-muted" />
              </li>
            ))}
          </ul>
        </div>
      </figure>
    </div>
  );
}

export function Explore() {
  return (
    <section aria-labelledby="explore-title" className="overflow-x-clip bg-surface">
      <div className={`${CONTAINER} grid items-center gap-12 py-section lg:grid-cols-2 lg:gap-16 lg:py-24`}>
        <div>
          <Eyebrow>EXPLORE CHARGERS</Eyebrow>
          <h2 id="explore-title" className="mt-3 text-heading font-extrabold tracking-tight text-ink sm:text-display">
            Find stations that match your needs.
          </h2>
          <p className="mt-5 text-lead text-ink-muted">Search charging locations in India.</p>
          <ul className="mt-8 grid gap-x-6 gap-y-5 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mint text-brand">
                  <Icon name={f.icon} className="size-5" />
                </span>
                <div>
                  <p className="font-bold text-ink">{f.title}</p>
                  <p className="text-body-sm text-ink-muted">{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <ButtonLink href="/app" className="mt-8">Explore Chargers</ButtonLink>
        </div>
        <AppPreview />
      </div>
    </section>
  );
}
