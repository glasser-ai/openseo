import { useEffect, useRef, useState } from "react";
import { ageOf, isOutdated } from "../domain/cache.js";
import {
  type KeywordRow,
  LOOKUPS,
  type LookupField,
  type LookupId,
  REPORT_TITLE,
} from "../domain/lookups.js";
import { type Metric, type Tone, toneOf } from "../domain/thresholds.js";
import { compact, parseCompact } from "../domain/traffic.js";
import { formatUsd, usdToMicros } from "../ledger/micros.js";
import { Meter } from "./charts.jsx";
import { KeywordTable } from "./KeywordTable.jsx";
import type { Tab } from "./navigation.js";
import { TONE_TEXT } from "./palette.js";
import { Registration } from "./Registration.jsx";
import { Traffic } from "./Traffic.jsx";
import type { ReportId, ResultState, useReport } from "./useReport.js";

/** Which reports each section shows, and which of them it buys on open. */
const SECTIONS: Record<Tab, { readonly title: string; readonly ids: readonly ReportId[] }> = {
  /*
   * ids are the ones **bought automatically when the overview opens**, not
   * everything the overview shows.
   *
   * All five have to be displayed, or "At a glance" misses two and is not a
   * glance at anything. Only the three cheap ones are bought automatically:
   * backlinks at $0.024 and ranked keywords at $0.13 together cost seven times
   * the other three, so buying them here would spend $0.176 just to open the
   * panel. Those two are bought when their own section opens.
   */
  overview: { title: "Overview", ids: ["domain-rating", "traffic", "organic-traffic"] },
  traffic: { title: "Traffic", ids: ["traffic"] },
  search: { title: "Search", ids: ["organic-traffic", "ranked-keywords"] },
  backlinks: { title: "Backlinks", ids: ["domain-rating", "backlinks"] },
};

const TITLE = REPORT_TITLE;

/** The overview lists **all** five; SECTIONS.overview.ids above is only the
    subset bought automatically. */
const OVERVIEW_ROWS: readonly ReportId[] = [
  "domain-rating",
  "traffic",
  "organic-traffic",
  "backlinks",
  "ranked-keywords",
];

export function Report({
  domain,
  hasKey,
  tab,
  onTab,
  onSettings,
  report,
}: {
  readonly domain: string;
  readonly hasKey: boolean;
  readonly tab: Tab;
  readonly onTab: (next: Tab) => void;
  /** Settings now lives inside the panel, so these entry points no longer send
      anyone to another tab. */
  readonly onSettings: () => void;
  /** Keep requests alive while Settings is open. */
  readonly report: ReturnType<typeof useReport>;
}) {
  const { results, run } = report;
  const ids = SECTIONS[tab].ids;

  const overviewLong = useLongWait(ids.some((id) => results[id]?.running === true));

  // Read saved results first. Attempt each missing or outdated report only once
  // per domain; failures require an explicit retry. The worker checks budgets.
  const fired = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!hasKey) return;
    for (const id of ids) {
      const state = results[id];
      if (!state || state.loading || state.running || state.error) continue;
      // An outdated cache counts as none: the panel renders readStoredPanel,
      // which ignores the TTL, so the check has to happen here or that copy
      // hangs around and never refreshes.
      if (state.entry !== null && !isOutdated(state.entry)) continue;
      const gate = `${domain}:${id}`;
      if (fired.current.has(gate)) continue;
      fired.current.add(gate);
      void run(id);
    }
  });

  if (tab === "overview") {
    const anyRunning = OVERVIEW_ROWS.some((id) => results[id]?.running === true);
    const firstFailure = OVERVIEW_ROWS.map((id) => results[id]?.error).find(
      (reason): reason is string => typeof reason === "string",
    );
    // Refresh only reports with saved results. Each explicit lookup gets a new identity.
    const refreshable = OVERVIEW_ROWS.filter((id) => results[id]?.entry != null);
    const savedLoading = OVERVIEW_ROWS.some((id) => results[id].loading);
    return (
      <div className="flex flex-col gap-4 py-4">
        {!hasKey && <ConnectKey onSettings={onSettings} />}
        {/* The free block, so it comes first — it is here without a Key too. */}
        <Registration domain={domain} />
        <section className="report-card">
          <h2 className="text-section font-semibold tracking-tight">At a glance</h2>
          <ul className="m-0 mt-3 list-none p-0">
            {OVERVIEW_ROWS.map((id, index) => {
              const state = results[id];
              const line = headline(id, state);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onTab(TAB_OF[id])}
                    className={`flex w-full items-baseline gap-3 py-3 text-left transition-colors hover:bg-muted ${
                      index === 0 ? "" : "border-t border-border"
                    }`}
                  >
                    <span className="min-w-0 flex-1">{line.label}</span>
                    {/* Summary rows need a loading state too — the word
                      "fetching" neither looks like motion nor sits anywhere
                      other than where the real number goes. */}
                    {line.busy ? (
                      <span className="h-5 w-16 shrink-0 animate-pulse rounded-sm bg-muted" />
                    ) : line.failed ? (
                      <span className="shrink-0 whitespace-nowrap text-right text-small text-bad-text">
                        Failed
                      </span>
                    ) : (
                      /*
                       * No fixed width, and no wrapping.
                       *
                       * It was w-24 (96px): at 20px semibold both `No record`
                       * and `#2 · 50/mo` are wider than that, so they broke
                       * across two lines, raising the row and throwing every
                       * baseline off. Sized to its content, what gets squeezed
                       * is the truncatable label on the left, not the number.
                       */
                      <span
                        className={`shrink-0 whitespace-nowrap text-right leading-none ${
                          line.quiet
                            ? "text-small text-muted-foreground"
                            : `text-figure font-semibold tabular-nums ${TONE_TEXT[line.tone]}`
                        }`}
                      >
                        {line.value}
                      </span>
                    )}
                    <span
                      className={`w-20 shrink-0 whitespace-nowrap text-right text-small ${
                        line.stale ? "text-warn-text" : "text-muted-foreground"
                      }`}
                    >
                      {line.busy ? "" : line.age}
                    </span>
                    {/* Clicking the row jumps to its section. Apart from the
                        hover background there was no hint of that before. */}
                    <span aria-hidden className="shrink-0 text-small text-muted-foreground">
                      ›
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {firstFailure && (
            <p className="mt-3 text-small text-bad-text" role="alert">
              {firstFailure}{" "}
              <button type="button" className="underline underline-offset-2" onClick={onSettings}>
                Settings
              </button>
            </p>
          )}
          <ActivityRow
            busy={anyRunning}
            long={overviewLong}
            label="Refresh"
            canRefresh={hasKey && !savedLoading && refreshable.length > 0}
            onRefresh={() => {
              for (const id of refreshable) void run(id, true);
            }}
          />
        </section>
        <p className="text-small text-muted-foreground">
          Each section fetches missing or outdated results on open. Saved results are reused until
          they are outdated.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      {!hasKey && <ConnectKey onSettings={onSettings} />}
      {ids.map((id) => (
        <Panel
          key={id}
          id={id}
          hasKey={hasKey}
          state={results[id]}
          onRun={() => void run(id, true)}
        />
      ))}
    </div>
  );
}

function ConnectKey({ onSettings }: { readonly onSettings: () => void }) {
  return (
    <section className="report-card">
      <h2 className="text-section font-semibold tracking-tight">Add your glasser Key</h2>
      <p className="mt-2 max-w-[62ch] text-muted-foreground">
        OpenSEO automatically fetches missing or outdated results when you open a section. Paid
        lookups use your glasser balance.
      </p>
      <button type="button" className="button button-primary mt-4" onClick={onSettings}>
        Add a Key
      </button>
    </section>
  );
}

/** The best position in the keyword list. Prefers the structured position and
    falls back to parsing "#3 · 12K/mo". */
function bestPosition(
  fields: readonly LookupField[],
  keywords?: readonly KeywordRow[],
): number | null {
  const positions = keywords
    ? keywords.map((row) => row.position)
    : fields.map((field) => Number(/^#(\d+)/.exec(field.value)?.[1]));
  const valid = positions.filter((value) => Number.isFinite(value) && value > 0);
  return valid.length > 0 ? Math.min(...valid) : null;
}

/** Which section buys each summary row — clicking one goes there. */
const TAB_OF: Record<ReportId, Tab> = {
  traffic: "traffic",
  "domain-rating": "backlinks",
  backlinks: "backlinks",
  "organic-traffic": "search",
  "ranked-keywords": "search",
};

/** One summary row: name, number, age. If it was never bought, say so rather
    than invent a figure. */
function headline(id: ReportId, state: ResultState | undefined) {
  const entry = state?.entry;
  const payload = entry?.payload;
  const age = entry ? ageOf(entry.fetchedAt) : "—";
  const stale = entry ? isOutdated(entry) : false;
  const busy = !entry && (state?.running === true || state?.loading === true);
  // Failure has to be visible. This looked only at entry and running, so "cap
  // reached" and "never bought" were the same em dash on the overview, and the
  // reason string never reached the DOM at all.
  const failed = !entry && typeof state?.error === "string" ? state.error : null;
  if (payload?.kind === "traffic") {
    // panel can be missing: a settled Run came back in the wrong shape, or the
    // cache was written by an earlier version. This cell is a summary, so say it
    // is missing rather than white-screening the whole panel.
    const visits = payload.panel?.engagement?.visits ?? null;
    return {
      label: TITLE[id],
      value: visits === null ? "—" : compact(visits),
      age,
      stale,
      busy,
      failed,
      quiet: false,
      // This row has the raw number in hand and needs no parseCompact.
      tone: visits === null ? ("neutral" as Tone) : toneOf("monthly-visits", visits),
    };
  }
  if (payload?.kind === "fields") {
    /*
     * The ranked-keywords lookup returns **a list of keywords**, so fields[0] is
     * the first keyword's "#2 · 50/mo". Printing that as the summary put a
     * subjectless `#2 · 50/mo` on the overview. This cell wants one sentence
     * about the whole table, so it takes the best position.
     */
    if (id === "ranked-keywords") {
      const best = bestPosition(payload.fields, payload.keywords);
      return {
        label: "Best keyword position",
        value: best === null ? "—" : `#${best}`,
        age,
        stale,
        busy,
        failed,
        quiet: best === null,
        tone: toneOf("keyword-position", best ?? Number.NaN),
      };
    }
    const field =
      id === "backlinks"
        ? payload.fields.find((field) => field.label === "Backlinks")
        : payload.fields[0];
    // Summary rows print the compact string ("51.9M"), and parseCompact reads it
    // back, so Backlinks and Est. organic visits / month get banded too.
    const metric = field ? FIELD_METRIC[field.label] : undefined;
    const score = metric === undefined ? Number.NaN : fieldValue(metric, field?.value ?? "");
    return {
      label: TITLE[id],
      value: field?.value ?? "—",
      age,
      stale,
      busy,
      failed,
      quiet: false,
      tone: metric !== undefined && Number.isFinite(score) ? toneOf(metric, score) : "neutral",
    };
  }
  // "No record" is not a number, so it must not take the number's type size —
  // No record at 20px semibold is the loudest thing on screen, and what it
  // stands for is the absence of anything.
  if (payload?.kind === "none")
    return {
      label: TITLE[id],
      value: "No record",
      age,
      stale,
      busy,
      failed,
      quiet: true,
      tone: "neutral" as Tone,
    };
  return {
    label: TITLE[id],
    value: "—",
    age,
    stale,
    busy,
    failed,
    quiet: true,
    tone: "neutral" as Tone,
  };
}

/**
 * Which figures get banded, and against which thresholds.
 *
 * A bare 71, or a bare 766, leaves a reader unable to tell high from low. A
 * bounded score gets its denominator from the meter; an unbounded magnitude gets
 * "where does this sit" from **colour**, banded by order of magnitude (see
 * thresholds.ts).
 *
 * Three bands at most, and **none of them reach red**: red is reserved for a
 * spam score at or above 60 and for a budget cap that is refusing lookups.
 * Amber says "this one is weak", not "something here is broken".
 *
 * Note this table is keyed on the **display label**, which comes from the
 * extract functions in lookups.ts. Change a literal there and this silently
 * stops matching, taking the colour and the meter with it — report.test.ts has a
 * canary for exactly that.
 */
const FIELD_METRIC: Record<string, Metric> = {
  // Bounded 0–100 scores.
  "Domain Rating": "domain-rating",
  "Spam score": "spam-score",
  // Magnitudes, banded by order of magnitude; see thresholds.ts.
  Backlinks: "backlinks",
  "Referring domains": "referring-domains",
  "Referring pages": "backlinks",
  "Referring IPs": "referring-domains",
  "Est. organic visits / month": "organic-visits",
  "Ranking keywords": "ranking-keywords",
};

/**
 * Broken backlinks want **a denominator**, not a colour.
 *
 * 82.2M broken links reads as alarming on its own, but it is 2.6% of that
 * domain's 3.1B — and Ahrefs' own link-rot study finds 66.5% of sampled links
 * have rotted since 2013. Broken links are the normal state of the web, not a
 * fault, and the sources deliberately **decline** to name an acceptable ratio,
 * advising instead that individual links be prioritised by value.
 *
 * So this one is not banded — inventing a threshold would be dressing a guess as
 * research — and the denominator goes next to the label instead. A reader can
 * tell 2.6% from 62% unaided. That is the rule the whole panel runs on: a number
 * without a denominator cannot be read.
 */
const brokenShare = (fields: readonly LookupField[], value: string): string | null => {
  const total = fields.find((field) => field.label === "Backlinks")?.value;
  if (total === undefined) return null;
  const [broken, all] = [parseCompact(value), parseCompact(total)];
  if (!Number.isFinite(broken) || !Number.isFinite(all) || all <= 0) return null;
  // Just the percentage: the adjacent label already says Broken backlinks, so it
  // reads as "0.3% of the backlinks are broken". Writing "0.3% of all" widened
  // the cell enough to push Spam score onto a row of its own.
  return `${((broken / all) * 100).toFixed(1)}%`;
};

/**
 * Only these two get a meter.
 *
 * A meter draws **the denominator**, so it only holds for a bounded 0–100 score.
 * Drawing an X%-full bar for "51.9M backlinks" would be drawing nothing: nobody
 * knows what 100% is there. Unbounded magnitudes get colour and no bar.
 *
 * Broken backlinks and Est. paid visits / month are **deliberately unbanded**:
 * the first is meaningless without the total it is a fraction of (140K broken
 * out of 51.9M is not the same thing as 140K out of 766), and the second
 * measures money spent, where more is not better.
 */
const BOUNDED: ReadonlySet<Metric> = new Set<Metric>(["domain-rating", "spam-score"]);

/** Bounded scores are bare numbers; the magnitudes print a compact string and
    have to be read back. */
const fieldValue = (metric: Metric, text: string): number =>
  BOUNDED.has(metric) ? Number(text) : parseCompact(text);

/**
 * The inline refresh.
 *
 * This used to be the generic .button: a 40px-tall block with 16px sides and a
 * gap of 12 — far too heavy for a secondary action like "buy this again", and
 * louder inside the card than any of the numbers. It now follows the age and
 * charge line instead: same small size, icon plus word, quiet until wanted.
 */
/**
 * **One activity row, shared everywhere.**
 *
 * The same event used to have five appearances: the grey bar on the overview,
 * the refresh at the foot of the overview, "Fetching…" at the top of a card,
 * "Fetching a fresh result" under the data inside a card, and the shell's
 * skeleton. A reader had to learn "this is loading" five separate times.
 *
 * There is one rule: **the left is what we know, the right is what you can do.**
 *  - Running: a spinner and status on the left (with a sentence added once it
 *    drags), nothing on the right — something already refreshing has no "refresh
 *    again" to offer.
 *  - Done: age · charge · attribution · Run link on the left, refresh on the
 *    right.
 * Position, size and spacing match in all three, so it is the same object on
 * whichever card it appears.
 */
function ActivityRow({
  busy,
  long,
  meta,
  label,
  canRefresh,
  onRefresh,
}: {
  readonly busy: boolean;
  readonly long?: boolean;
  readonly meta?: React.ReactNode;
  readonly label: string;
  readonly canRefresh: boolean;
  readonly onRefresh: () => void;
}) {
  return (
    <div className="mt-4 border-t border-border pt-3 text-small text-muted-foreground">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1 pt-1.5">
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Spinner />
              Fetching…
            </span>
          ) : (
            meta
          )}
        </span>
        {!busy && canRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            /*
             * Looks like an actual button: a border, a background, and text in
             * the normal foreground colour.
             *
             * It had no border and no background, at the same size and colour as
             * the grey metadata line beside it — a control that spends money
             * reading as a footnote. The other extreme is wrong too: a solid
             * 40px block is a secondary action outweighing the number above it.
             * A 32px outlined button is the value in between.
             */
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border bg-background px-2.5 font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-3 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden
            >
              <path
                d="M13.5 8a5.5 5.5 0 1 1-1.7-4M13 1.5V5H9.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {label}
          </button>
        )}
      </div>
      {busy && long && (
        <p className="mt-1.5">
          Still going. This Provider runs the lookup as a job, so it can take a little longer.
        </p>
      )}
    </div>
  );
}

/** The spinner. During a refresh the data is still on screen, so this wants a
    small indicator rather than a full placeholder. */
const Spinner = () => (
  <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 animate-spin" aria-hidden>
    <circle
      cx="8"
      cy="8"
      r="6.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      opacity="0.25"
    />
    <path
      d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * A placeholder shaped like the real content: one lead figure above a row of
 * supporting ones. A placeholder rather than the word "Fetching…" so the card's
 * height does not jump when the data arrives.
 */
/** Shape only. The status belongs to the activity row — said in two places it
    becomes two accounts of the same thing. */
function Placeholder() {
  return (
    <div className="mt-3" aria-hidden>
      <div className="h-7 w-28 animate-pulse rounded-sm bg-muted" />
      <div className="mt-2 h-3 w-20 animate-pulse rounded-sm bg-muted" />
      <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-4">
        {[0, 1, 2].map((index) => (
          <div key={index}>
            <div className="h-5 w-14 animate-pulse rounded-sm bg-muted" />
            <div className="mt-2 h-3 w-16 animate-pulse rounded-sm bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** After 8 seconds, add a sentence — these Endpoints run asynchronous jobs, and
    a long silence reads as a hang. */
function useLongWait(busy: boolean): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!busy) {
      setLong(false);
      return;
    }
    const timer = setTimeout(() => setLong(true), 8000);
    return () => clearTimeout(timer);
  }, [busy]);
  return long;
}

function Panel({
  id,
  hasKey,
  state,
  onRun,
}: {
  readonly id: ReportId;
  readonly hasKey: boolean;
  readonly state: ResultState | undefined;
  readonly onRun: () => void;
}) {
  const longWait = useLongWait(state?.running === true || state?.loading === true);
  if (!state) return null;
  const entry = state.entry;
  const payload = entry?.payload;

  return (
    <section className="report-card">
      <div className="flex items-baseline gap-2">
        <h2 className="text-section font-semibold tracking-tight">{TITLE[id]}</h2>
      </div>

      {/*
        During a refresh, **do not** replace the number already on screen with
        "Fetching…". The copy in hand was paid for and has to stay while the new
        one is on its way — taking it away means confiscating what you already
        bought in order to wait for what you are buying.
      */}
      {state.loading || (state.running && !payload) ? (
        <Placeholder />
      ) : payload?.kind === "traffic" ? (
        // When panel is missing (a cache from an earlier version, or a settled
        // Run in the wrong shape) drawing nothing is not an option: a card with
        // only a heading and a footer looks broken. Say so, and let refresh
        // fetch a fresh one.
        payload.panel ? (
          <Traffic panel={payload.panel} />
        ) : (
          <p className="mt-3 text-muted-foreground">
            This result was saved by an older version. Refresh to fetch it again.
          </p>
        )
      ) : payload?.kind === "fields" ? (
        // Ranked keywords render **only** as a table. This used to lay all 25 out
        // as 25 KPI-sized figures (with the keyword itself shrunk to a caption)
        // and then repeat them as a table below — the same data drawn twice, the
        // first time in the typography reserved for lead figures.
        id === "ranked-keywords" ? (
          <KeywordTable
            rows={payload.fields}
            {...(payload.keywords ? { keywords: payload.keywords } : {})}
          />
        ) : (
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-4">
            {payload.fields.map((field) => {
              const metric = FIELD_METRIC[field.label];
              const score = metric === undefined ? Number.NaN : fieldValue(metric, field.value);
              const scored = metric !== undefined && Number.isFinite(score);
              const tone = scored ? toneOf(metric, score) : "neutral";
              const bounded = scored && BOUNDED.has(metric);
              const share =
                field.label === "Broken backlinks"
                  ? brokenShare(payload.fields, field.value)
                  : null;
              return (
                <div key={field.label} className="min-w-0">
                  <div
                    className={`text-figure font-semibold leading-none tabular-nums ${TONE_TEXT[tone]}`}
                  >
                    {field.value}
                  </div>
                  {/* When a section has one figure and its name is the section's
                      name, do not print it twice. "Domain Rating / 71 / Domain
                      Rating" reads like a fault. */}
                  {!(payload.fields.length === 1 && field.label === TITLE[id]) && (
                    <div className="mt-1 text-small text-muted-foreground">
                      {field.label}
                      {share && ` · ${share}`}
                    </div>
                  )}
                  {/* The meter goes **after** the caption. Between the figure and
                      the caption it pushes the other cells' captions down and
                      throws the whole row's baselines off. */}
                  {bounded && (
                    <Meter
                      value={score}
                      label={field.label}
                      // This is a **score** out of 100, not a percentage.
                      // Announcing it as "95%" would be wrong.
                      valueText={`${score} out of 100`}
                      tone={tone}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : payload?.kind === "none" ? (
        <p className="mt-3 text-muted-foreground">{payload.reason}</p>
      ) : !hasKey ? (
        <p className="mt-3 text-muted-foreground">Add a Key in Settings to fetch this.</p>
      ) : null}

      {/*
        Status and actions live on this one row — see ActivityRow.
        **Do not hide the whole row on hasKey**: the age, the charge and above all
        the attribution belong to the number that was already bought, and should
        show with it even without a Key — attribution is a licence condition.
        Only the refresh action needs a Key, so only that button is gated on the
        Key and the request state.
      */}
      {(entry || state.running || state.loading) && (
        <ActivityRow
          busy={state.running || state.loading}
          long={longWait}
          label="Refresh"
          canRefresh={hasKey && !state.loading && entry !== null}
          onRefresh={onRun}
          meta={
            entry ? (
              <>
                {isOutdated(entry) ? (
                  <span className="text-warn-text">Outdated · {ageOf(entry.fetchedAt)}</span>
                ) : (
                  ageOf(entry.fetchedAt)
                )}{" "}
                ·{" "}
                {/* null is not zero: the contract returns null while unsettled,
                     and a settled Run that cost nothing returns "0.00". */}
                {entry.chargeUsd === null
                  ? "Charge unknown"
                  : /* A zero charge says Free. $0.00 reads as "rounded down to
                       zero", when it genuinely cost nothing. */
                    usdToMicros(entry.chargeUsd) === 0n
                    ? "Free"
                    : formatUsd(usdToMicros(entry.chargeUsd))}
                {attributionFor(id) && (
                  <>
                    {" · "}
                    <a
                      href={attributionFor(id)?.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-muted-foreground/50 underline-offset-3 hover:text-foreground hover:decoration-current"
                    >
                      {attributionFor(id)?.label}
                    </a>
                  </>
                )}
                {entry.runUrl && (
                  <>
                    {" · "}
                    <a
                      href={entry.runUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block whitespace-nowrap underline decoration-muted-foreground/50 underline-offset-3 hover:text-foreground hover:decoration-current"
                      title="View this lookup's Run in glasser"
                    >
                      View Run ↗
                    </a>
                  </>
                )}
              </>
            ) : null
          }
        />
      )}

      {state.error && (
        <div className="mt-3">
          <p className="text-bad-text">{state.error}</p>
          {hasKey && (
            <button
              type="button"
              className="button button-secondary mt-3"
              disabled={state.loading || state.running}
              onClick={onRun}
            >
              Try again
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function attributionFor(id: ReportId) {
  if (id === "traffic") return { label: "Similarweb data", href: "https://www.similarweb.com/" };
  return LOOKUPS.find((lookup) => lookup.id === (id as LookupId))?.attribution ?? null;
}
