import { Fact, markerClass } from "@/components/site/Fact";
import { legal, type LegalDate, type LegalDocument as Doc } from "@/content/legal";

// Shared layout for the /legal/* pages (T3-09). Server component, no client JS.
// Renders only what src/content/legal.ts holds: a null value shows "To be confirmed",
// a null section body shows a draft placeholder. Nothing is invented here.

const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "UTC" });

function formatDate(iso: LegalDate): string {
  const date = new Date(`${iso}T00:00:00Z`);
  // The round trip rejects dates that would roll over ("2026-02-31" becomes 3 March).
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new Error(`src/content/legal.ts: "${iso}" is not a valid date (use YYYY-MM-DD)`);
  }
  return dateFormat.format(date);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="font-semibold sm:w-48 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 whitespace-pre-line">{children}</dd>
    </div>
  );
}

export function LegalDocument({ doc, children }: { doc: Doc; children?: React.ReactNode }) {
  const { entity, contact, grievanceOfficer: officer } = legal;
  return (
    <div className="flex-1 bg-surface text-ink">
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-10 break-words px-gutter py-section">
        <header className="flex flex-col gap-3">
          <h1 className="text-heading font-bold tracking-tight">{doc.title}</h1>
          <p className="text-lead text-ink-muted">{doc.description}</p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-ink-muted">
            <span>
              Version: <Fact value={doc.version} />
            </span>
            <span>
              Effective date:{" "}
              {doc.effectiveDate === null ? (
                <Fact value={null} />
              ) : (
                <time dateTime={doc.effectiveDate}>{formatDate(doc.effectiveDate)}</time>
              )}
            </span>
          </p>
        </header>

        {children}

        {doc.sections.map((section) => (
          <section key={section.id} className="flex flex-col gap-3">
            <h2 id={section.id} className="text-title font-semibold">
              {section.heading}
            </h2>
            {section.body === null ? (
              <p className="rounded-card border border-dashed border-border-strong bg-surface-muted p-4 text-body-sm text-ink-muted">
                Draft placeholder. The text for this section has not been supplied yet.
              </p>
            ) : (
              <>
                {section.draft && (
                  <p className={`${markerClass} self-start`}>Draft. To be confirmed by counsel.</p>
                )}
                {section.body.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </>
            )}
          </section>
        ))}

        <section className="flex flex-col gap-3 border-t border-border pt-8">
          <h2 id="operator" className="text-title font-semibold">
            Who runs FullCharge
          </h2>
          <dl className="flex flex-col gap-2">
            <Row label="Legal entity">
              <Fact value={entity.name} />
            </Row>
            <Row label="Registered address">
              <Fact value={entity.registeredAddress} />
            </Row>
            <Row label="Support email">
              <Fact value={contact.supportEmail} email />
            </Row>
          </dl>
        </section>

        <section className="flex flex-col gap-3">
          <h2 id="grievance-officer" className="text-title font-semibold">
            Grievance officer
          </h2>
          <dl className="flex flex-col gap-2">
            <Row label="Name">
              <Fact value={officer.name} />
            </Row>
            <Row label="Email">
              <Fact value={officer.email} email />
            </Row>
            <Row label="Postal address">
              <Fact value={officer.postalAddress} />
            </Row>
            <Row label="Response time">
              <Fact value={officer.responseTime} />
            </Row>
          </dl>
        </section>
      </article>
    </div>
  );
}
