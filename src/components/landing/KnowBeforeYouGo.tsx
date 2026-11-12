import { StatusLegend } from "@/components/data/StatusLegend";
import { CONTAINER, Eyebrow } from "./shared";

// Copy deck section 6. The four cards and the footnote come from StatusLegend, which reads src/lib/status.ts (ADR-0020, WL-LAND-9).
export function KnowBeforeYouGo() {
  return (
    <section aria-labelledby="status-title" className="bg-mint">
      <div className={`${CONTAINER} py-section lg:py-24`}>
        <div className="max-w-3xl">
          <Eyebrow>KNOW BEFORE YOU GO</Eyebrow>
          <h2 id="status-title" className="mt-3 text-heading font-extrabold tracking-tight text-ink sm:text-display">
            See charger availability before you arrive, where networks share it.
          </h2>
          <p className="mt-5 text-lead text-ink-muted">
            FullCharge shows live status where available. Where it is not, the charger shows Status unknown.
          </p>
        </div>
        <StatusLegend variant="cards" className="mt-8" />
      </div>
    </section>
  );
}
