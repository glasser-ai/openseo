import { type Check, indexing, onPage, pathOf } from "../domain/page.js";
import { TONE_TEXT } from "./palette.js";
import type { PageScan } from "./usePage.js";

/** The Page section: whether Google can index the open page, then what it
    finds on it. Read from the page itself, so it is free and needs no Key. */
export function PageChecks({ scan }: { readonly scan: PageScan }) {
  if (scan.kind !== "ok") return <ScanState scan={scan} title="This page" />;
  const { verdict, checks } = indexing(scan.facts);
  const path = pathOf(scan.facts.url);
  return (
    <>
      <section className="report-card">
        <CardTitle title="Indexing" note={`${path} · free`} />
        <p className={`mt-3 text-figure font-semibold leading-tight ${TONE_TEXT[verdict.tone]}`}>
          {verdict.value}
        </p>
        <CheckList checks={checks} />
      </section>
      <section className="report-card">
        <CardTitle title="On the page" note="as it is now in this tab" />
        <CheckList checks={onPage(scan.facts)} />
      </section>
    </>
  );
}

export function CardTitle({ title, note }: { readonly title: string; readonly note: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <h2 className="text-section font-semibold tracking-tight">{title}</h2>
      <span className="min-w-0 break-all text-small text-muted-foreground">{note}</span>
    </div>
  );
}

/** One row per check. The value carries the tone; the note says why. */
export function CheckList({ checks }: { readonly checks: readonly Check[] }) {
  return (
    <dl className="check-list mt-3">
      {checks.map((check) => (
        <div key={check.label}>
          <dt>{check.label}</dt>
          <dd>
            <span className={`font-medium ${TONE_TEXT[check.tone]}`}>{check.value}</span>
            {check.note && (
              <span className="block text-small text-muted-foreground">{check.note}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ScanState({ scan, title }: { readonly scan: PageScan; readonly title: string }) {
  return (
    <section className="report-card">
      <CardTitle title={title} note="free" />
      {scan.kind === "failed" ? (
        <p role="alert" className="mt-3 text-bad-text">
          {scan.reason}
        </p>
      ) : (
        <div role="status" aria-label="Reading this page" className="mt-3 flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-4 w-full animate-pulse rounded-sm bg-muted" />
          ))}
        </div>
      )}
    </section>
  );
}
