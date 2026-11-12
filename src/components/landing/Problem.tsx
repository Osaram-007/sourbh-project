import { ButtonLink } from "@/components/ui/Button";
import { CONTAINER, Eyebrow } from "./shared";

const FRAGMENTS = ["Networks", "Apps", "Speeds", "Prices"];

// Copy deck section 4. [FOUNDER: own or licensed photo of an EV on a road (T-4). The reference photo is not used.]
// A navy panel of four placeholder cards stands in for it: type and shapes from tokens only. Decorative, hidden from assistive tech.
function FragmentPanel() {
  return (
    <div aria-hidden="true" className="relative overflow-hidden rounded-sheet bg-ink p-6 sm:p-10">
      <div className="absolute -right-16 -top-16 size-64 rounded-full border border-surface/15" />
      <div className="absolute -bottom-28 -left-12 size-72 rounded-full bg-brand/40" />
      <div className="relative grid grid-cols-2 gap-3 sm:gap-4">
        {FRAGMENTS.map((f, i) => (
          <div key={f} className={`rounded-card bg-surface p-4 shadow-popover ${i % 2 ? "translate-y-4" : ""}`}>
            <p className="text-body-sm font-bold text-ink">{f}</p>
            <div className="mt-3 h-2 w-3/4 rounded-full bg-border" />
            <div className="mt-2 h-2 w-1/2 rounded-full bg-border" />
            <div className="mt-4 h-6 w-16 rounded-control bg-mint" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Problem() {
  return (
    <section aria-labelledby="problem-title" className="bg-mint">
      <div className={`${CONTAINER} grid items-center gap-10 py-section lg:grid-cols-2 lg:gap-16 lg:py-24`}>
        <FragmentPanel />
        <div>
          <Eyebrow>EV CHARGING SHOULD BE SIMPLE.</Eyebrow>
          <h2 id="problem-title" className="mt-3 text-heading font-extrabold tracking-tight text-ink sm:text-display">
            Finding a charger shouldn&apos;t be a gamble.
          </h2>
          <p className="mt-5 text-lead text-ink-muted">
            Different networks. Different apps. Different charging speeds. Different prices. And sometimes, the biggest question is simply:
          </p>
          <blockquote className="mt-4 rounded-card bg-surface px-5 py-4 text-title font-semibold text-ink shadow-card">
            <p>&ldquo;Will the charger actually work when I get there?&rdquo;</p>
          </blockquote>
          <p className="mt-4 text-lead text-ink-muted">
            FullCharge brings the information together so you can make a better charging decision before you arrive.
          </p>
          <ButtonLink href="/app" className="mt-7">Explore Chargers</ButtonLink>
        </div>
      </div>
    </section>
  );
}
