import { ButtonLink } from "@/components/ui/Button";
import { Icon } from "./Icon";
import { CONTAINER, Eyebrow, ExampleTag } from "./shared";

// Copy deck section 7. Ship gate: the My Vehicle catalogue (W4, WL-APP-12); the labelled example itself can ship earlier.
// [FOUNDER: licensed car image, or none (T-4, trademark). None is used: a generic inline car icon stands in.]
function VehicleExample() {
  return (
    <div className="rounded-card border border-border bg-surface p-5 shadow-popover">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold text-ink">Your vehicle</p>
        <ExampleTag />
      </div>
      <div className="mt-4 flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-mint text-brand">
          <Icon name="car" className="size-8" />
        </span>
        <p className="text-title font-bold text-ink">Example compact EV</p>
      </div>
      <div className="mt-5 rounded-control border border-border p-4">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <Icon name="check" className="size-4 text-brand" />
          Compatible chargers
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-body-sm text-ink">
          <li className="flex items-center gap-2"><Icon name="plug" className="size-4 text-brand" />CCS2</li>
          <li className="flex items-center gap-2"><Icon name="plug" className="size-4 text-brand" />DC connector</li>
        </ul>
      </div>
      <ButtonLink href="/app?vehicle=pick" variant="secondary" className="mt-5 w-full sm:w-auto">
        View Compatible Chargers
        <Icon name="arrowRight" className="size-4" />
      </ButtonLink>
    </div>
  );
}

export function BuiltForYourEv() {
  return (
    <section aria-labelledby="ev-title" className="bg-surface">
      <div className={`${CONTAINER} grid items-center gap-10 py-section lg:grid-cols-2 lg:gap-16 lg:py-24`}>
        <div>
          <Eyebrow>BUILT AROUND YOUR EV</Eyebrow>
          <h2 id="ev-title" className="mt-3 text-heading font-extrabold tracking-tight text-ink sm:text-display">
            Find chargers that match your vehicle.
          </h2>
          <p className="mt-5 text-lead text-ink-muted">
            Add your vehicle and see the chargers that have a connector your vehicle supports. We match connector types only, so we do not promise a charging speed for your car.
          </p>
          <ButtonLink href="/app?vehicle=pick" className="mt-7">Add Your Vehicle</ButtonLink>
        </div>
        <div>
          <VehicleExample />
          <p className="mt-4 text-body-sm text-ink-muted">
            Compatible means the charger has a connector your vehicle supports. It does not mean the charger will charge your car at full speed.
          </p>
        </div>
      </div>
    </section>
  );
}
