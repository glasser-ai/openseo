import { toneOf } from "../domain/thresholds.js";
import {
  compact,
  duration,
  type MonthlyPoint,
  monthLabel,
  percent,
  type SourceSlice,
  type TrafficPanel,
} from "../domain/traffic.js";
import { BarRows, Donut, Meter, MonthlyLine } from "./charts.jsx";
import { assignSlots } from "./palette.js";
import { Figure } from "./primitives.jsx";

/**
 * The traffic panel.
 *
 * Colour serves three purposes here, under the rules in the charts.tsx header:
 *  - **Channels** are a fixed, closed set of six, so they get categorical
 *    colours with slots pinned by key;
 *  - **Countries** are an open set (the top five change with the domain), so
 *    they get one accent colour;
 *  - **Bounce rate** is bounded and directional, so it gets a state colour —
 *    but it **never reaches red**, because Similarweb says what counts as good
 *    depends on the site's category, and a documentation site at 80% is normal.
 *
 * Identity always rests on the adjacent label; colour is the redundant second
 * channel.
 */
/** "Jun – Aug 2026". Within one year the year is written once. */
function monthRange(points: readonly { date: string }[]): string {
  const label = (iso: string, withYear: boolean) => {
    const date = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(date.getTime())
      ? iso
      : date.toLocaleString("en-US", {
          month: "short",
          timeZone: "UTC",
          ...(withYear ? { year: "numeric" } : {}),
        });
  };
  const first = points[0]?.date ?? "";
  const last = points.at(-1)?.date ?? "";
  if (first === last) return label(first, true);
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return `${label(first, !sameYear)} – ${label(last, true)}`;
}

export function Traffic({ panel }: { readonly panel: TrafficPanel }) {
  const { engagement } = panel;
  // These four were added later. Under the same Endpoint, a panel cached by an
  // earlier version does not carry them, and `undefined !== null` is true — so
  // without a fallback this calls undefined.toLocaleString() and white-screens
  // the panel. Caches live across versions, so the component has to accommodate
  // the older shape.
  const sources = panel.sources ?? [];
  const monthly = panel.monthly ?? [];
  const countries = panel.countries ?? [];
  const globalRank = panel.globalRank ?? null;
  const countryRank = panel.countryRank ?? null;
  // Slots are assigned across **the whole channel set**, so an unfamiliar
  // channel cannot collide with a known one's colour.
  const slotMap = assignSlots(sources.map((slice) => slice.key));
  return (
    <>
      {/*
        Fixed columns rather than flex-wrap: the captions differ in width, so
        flex breaks on content and lays six figures out as 2 / 3 / 1, with no two
        rows sharing a left edge. A grid pins the columns instead.
        The lead figure takes a row of its own, since its type is a step larger
        than the rest anyway.
      */}
      <div className="mt-3">
        <Figure
          hero
          value={engagement.visits === null ? "No data" : compact(engagement.visits)}
          caption={engagement.period ? `Monthly visits · ${engagement.period}` : "Monthly visits"}
          {...(engagement.visits === null
            ? {}
            : { tone: toneOf("monthly-visits", engagement.visits) })}
        />
      </div>
      {/* Two columns, not three: the content column is 356px, which leaves about
          110px per cell across three — and `#1,016,619` is that wide on its own.
          Better one column fewer than a number broken or pushed out. */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
        {engagement.bounceRate !== null && (
          <div>
            {/* The figure and the meter take **the same** tone — computed twice,
                the two would eventually disagree. */}
            <Figure
              value={percent(engagement.bounceRate)}
              caption="Bounce rate"
              tone={toneOf("bounce-rate", engagement.bounceRate)}
            />
            <Meter
              value={engagement.bounceRate * 100}
              label="Bounce rate"
              valueText={percent(engagement.bounceRate)}
              tone={toneOf("bounce-rate", engagement.bounceRate)}
            />
          </div>
        )}
        {engagement.pagesPerVisit !== null && (
          <Figure
            value={engagement.pagesPerVisit.toFixed(2)}
            caption="Pages per visit"
            tone={toneOf("pages-per-visit", engagement.pagesPerVisit)}
          />
        )}
        {engagement.timeOnSite !== null && (
          <Figure
            value={duration(engagement.timeOnSite)}
            caption="Visit duration"
            // toneOf takes **seconds**, the same unit duration() does.
            tone={toneOf("visit-duration", engagement.timeOnSite)}
          />
        )}
        {/* Rank only became available with the move to Similarweb — the panel
            used to say no Endpoint in the catalog could answer it. */}
        {globalRank !== null && (
          <Figure
            value={`#${globalRank.toLocaleString("en-US")}`}
            caption="Global rank"
            tone={toneOf("site-rank", globalRank)}
          />
        )}
        {countryRank && (
          <Figure
            value={`#${countryRank.rank.toLocaleString("en-US")}`}
            caption={`Rank in ${countryRank.code}`}
            tone={toneOf("site-rank", countryRank.rank)}
          />
        )}
      </div>

      {monthly.length > 0 && (
        <div className="mt-6 border-t border-border pt-4">
          {/*
            State the range. This lookup returns three months only (the Actor's
            input is just websites, with no parameter controlling how much
            history), so "why only three months" should be answerable from the
            chart rather than leaving a reader to wonder whether we truncated it.
          */}
          <div className="flex items-baseline gap-2">
            <h3 className="text-body font-semibold">Visits by month</h3>
            {monthly.length > 0 && (
              <span className="ml-auto text-small text-muted-foreground">
                {monthRange(monthly)}
              </span>
            )}
          </div>
          <div className="mt-3">
            <MonthlyLine points={monthly} format={compact} />
          </div>
        </div>
      )}

      {sources.length > 0 && (
        <div className="mt-6 border-t border-border pt-4">
          <h3 className="text-body font-semibold">Where visits come from</h3>
          <div className="mt-3">
            {/*
              A donut, but **the whole is not necessarily complete**.
              This used to claim the six channels sum to exactly 1, which is
              false against real data: measured, openai.com returned only direct,
              referrals and mail, totalling 55.6%.
              Donut turns the shortfall into a named "Not attributed" segment, so
              the ring closes and that share carries a label and a percentage —
              no longer an unexplained gap.
            */}
            {/*
              Slots are **keyed by name, not by index**: sources is sorted by
              share, so come a different month Search drops to third and an
              index-keyed colour changes with it — while it is still the same
              channel.
            */}
            <Donut
              slices={sources.map((slice) => {
                // Past six channels slotMap has no entry — Donut renders it in
                // the neutral grey rather than borrowing a known channel's
                // colour.
                const slot = slotMap.get(slice.key);
                return { ...slice, ...(slot === undefined ? {} : { slot }) };
              })}
            />
          </div>
        </div>
      )}
      {countries.length > 0 && (
        <div className="mt-6 border-t border-border pt-4">
          {/* This section used to have no heading, with its caption **below** the
              list — so a reader reached the country names without yet knowing
              what the column was. */}
          <h3 className="text-body font-semibold">Visitors by country</h3>
          {/* Only the top few, summing to **less than** 1 — so not a donut,
              which would imply this is everything. */}
          <div className="mt-3">
            <BarRows
              rows={countries.map((country) => ({
                key: country.code,
                label: country.name,
                share: country.share,
              }))}
            />
          </div>
          <p className="mt-3 text-small text-muted-foreground">Top countries only</p>
        </div>
      )}
    </>
  );
}
