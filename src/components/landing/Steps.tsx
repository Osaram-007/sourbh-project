import { Icon, type IconName } from "./Icon";
import { CONTAINER } from "./shared";

// Copy deck section 3. [VERIFY: "Discover charging stations across India" needs the state-count check (T-1), so Find says "in India".]
const STEPS: { title: string; text: string; icon: IconName }[] = [
  { title: "Find", text: "Discover charging stations in India.", icon: "search" },
  { title: "Check", text: "Check the connector, speed, price where listed, and live status where available.", icon: "check" },
  { title: "Compare", text: "Sort and filter by distance, speed and price.", icon: "sliders" },
  { title: "Go", text: "Open directions in Google Maps.", icon: "navigation" },
];

export function Steps() {
  return (
    <section className="border-y border-border bg-surface">
      <ol className={`${CONTAINER} grid gap-6 py-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0`}>
        {STEPS.map((s) => (
          <li key={s.title} className="flex items-start gap-4 lg:px-6 lg:first:pl-0 lg:[&:not(:first-child)]:border-l lg:[&:not(:first-child)]:border-border">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-mint text-brand">
              <Icon name={s.icon} className="size-6" />
            </span>
            <div>
              <p className="text-title font-bold text-ink">{s.title}</p>
              <p className="mt-1 text-body-sm text-ink-muted">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
