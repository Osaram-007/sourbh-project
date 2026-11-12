import { ButtonLink } from "@/components/ui/Button";
import { CONTAINER } from "./shared";

// Copy deck section 8 (teaser). Plain <a> links to the two marketing pages (WEB-B03).
export function WorkWithUs() {
  return (
    <section aria-labelledby="work-title" className="bg-mint">
      <div className={`${CONTAINER} flex flex-col gap-6 py-section md:flex-row md:items-center md:justify-between`}>
        <div className="max-w-xl">
          <h2 id="work-title" className="text-heading font-extrabold tracking-tight text-ink">Work with FullCharge.</h2>
          <p className="mt-3 text-lead text-ink-muted">Run a business or a charging network in India? Tell us about it.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/for-businesses">For Businesses</ButtonLink>
          <ButtonLink href="/for-operators" variant="secondary">For Charging Operators</ButtonLink>
        </div>
      </div>
    </section>
  );
}
