import { useState } from "react";
import type { Tone } from "../domain/thresholds.js";
import { percent } from "../domain/traffic.js";
import { arcClass, REST_ARC, REST_SWATCH, swatchClass, TONE_FILL } from "./palette.js";

/**
 * Chart components. The mark is chosen by **what the number is doing**, not by
 * what looks nice:
 *
 * | Data | What it is | Mark | Why not something else |
 * |---|---|---|---|
 * | Channel share (a fixed set of channels) | Part of a whole, **the whole closes** | Donut | It used to be an 8px stacked bar: a 0.05% segment was under one pixel and simply invisible |
 * | Visitor countries (a top few, not summing to 1) | Part of a whole, **the whole is incomplete** | Horizontal bars | A donut would imply this is everything, while the remaining countries are not listed — that is a lie |
 * | Three months of visits | Three discrete months | Line | What a reader wants is the **change**; bars sit side by side and leave you to join them up in your head |
 * | Domain Rating / Spam score | A bounded 0–100 score | Meter | A bare 71 has no denominator, so a reader cannot tell whether 71 is high or low |
 *
 * The colour rules, sorted by what the colour is saying:
 *
 *  - **Identity**: only for a **fixed, closed** set — the six channels, with
 *    slots pinned by key (see CHANNEL_SLOT in palette.ts). Countries do not
 *    qualify: that is an open set whose top five change with the domain, so a
 *    categorical colour there would encode an identity that does not exist.
 *  - **Magnitude**: country bars and the trend line, on one accent colour.
 *  - **State**: the meter, banded by toneOf.
 *
 * The previous version was **monochrome plus an opacity ramp**, on the grounds
 * that the theme's own --chart-1..5 are a single hue in dark mode and fail as
 * categorical colours under colour vision deficiency. That judgement was right
 * about **that palette**, not about colour itself — and it ended up discarding
 * colour as a channel altogether. The palette here is measured instead: 3.68:1
 * minimum in light, and deltaE76 16.7 between the closest pair under dichromat
 * simulation (see style.css and palette.test.ts). The opacity ramp is gone with
 * it: its lightest step sat at 1.24:1 on white, which was never visible.
 *
 * But **identity still rests on the adjacent label**. Colour is a redundant
 * second channel: remove all of it and these charts still read.
 */

/**
 * Donut — for the share across a **fixed set of channels**.
 *
 * Each segment is a stroked circle: dasharray sets its length, dashoffset its
 * start. Segments **abut with no gap** (see the overlap comment below).
 *
 * Summing to less than 1 is fine: the shortfall becomes a named "Not
 * attributed" segment, so the ring always closes. An **open set** like
 * countries still must not use this — use BarRows.
 */
export function Donut({
  slices,
  size = 104,
  restLabel = "Not attributed",
}: {
  readonly slices: readonly {
    key: string;
    label: string;
    share: number;
    /** Colour slot. Absent means the palette ran out; see the arc comment. */
    slot?: number;
  }[];
  readonly size?: number;
  readonly restLabel?: string;
}) {
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  /*
   * **No gap between segments.**
   *
   * There used to be 5px. Back when the chart was monochrome, neighbouring
   * segments were otherwise indistinguishable and the gap was the only thing
   * separating them. Now each segment has its own colour (the closest pair is
   * over deltaE 15 apart under dichromat simulation), so the gap carries no
   * information — it only cuts white slits into a ring that is continuous.
   *
   * So the arcs abut, each drawing 0.6px extra to cover the join, which keeps
   * antialiasing from leaving a hairline there.
   */
  const overlap = 0.6;
  const [active, setActive] = useState<string | null>(null);

  /*
   * The shortfall becomes **a named category**, not a hole.
   *
   * The Provider does not guarantee all six channels: measured on openai.com it
   * returned three, totalling 55.6%. That share used to be the track ring
   * showing through — no name, no percentage, absent from the legend — so the
   * gap looked like a rendering fault rather than like "this part is not
   * attributed". It now has a colour, a label and a percentage like any other
   * segment, and the ring closes again.
   */
  const known = slices.reduce((sum, slice) => sum + slice.share, 0);
  const rest = 1 - known;
  const REST = "\u0000rest";
  const shown = [
    ...slices.map((slice) => ({
      ...slice,
      // No slot means the palette ran out (past six channels). Render it in the
      // neutral grey rather than impersonating a known channel.
      arc: slice.slot === undefined ? REST_ARC : arcClass(slice.slot),
      swatch: slice.slot === undefined ? REST_SWATCH : swatchClass(slice.slot),
    })),
    // Under 0.05% is not worth a row: that much shortfall is rounding rather
    // than genuinely unattributed traffic.
    ...(rest > 0.0005
      ? [{ key: REST, label: restLabel, share: rest, arc: REST_ARC, swatch: REST_SWATCH }]
      : []),
  ];

  const summary = `Share of visits by channel: ${shown
    .map((slice) => `${slice.label} ${percent(slice.share)}`)
    .join(", ")}`;

  let offset = 0;
  return (
    <div className="channel-chart flex flex-wrap items-center gap-4">
      {/*
        role="img" plus an aria-label that names every segment.
        Hover is **purely additive**: the labels and percentages are already in
        the legend to the right, so the arcs deliberately take no tabIndex —
        focusable elements with no action behind them burden keyboard users
        rather than help them.
      */}
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0"
        style={{ width: size, height: size }}
        role="img"
        aria-label={summary}
        onPointerLeave={() => setActive(null)}
      >
        <title>{summary}</title>
        {shown.map((slice) => {
          // A 0.03% segment is under 1px and vanishes without a floor. The floor
          // only affects segments too small to read as a proportion anyway, and
          // their true share is printed in the legend beside them.
          //
          // The second clamp keeps the ring **inside one turn**. Shares come
          // from the Provider, and since fields stopped being whitelisted they
          // can sum past 1 (an aggregate sent alongside its own components, for
          // instance). Past the turn, later arcs would paint over earlier ones
          // with nothing on screen to show it.
          //
          // Clamp **the share term**, not the finished length. Clamped on the
          // outside, the last segment is pinned to exactly its own remaining
          // space: shares sum to 1 (the shortfall is appended as a segment), so
          // room equals that segment's own arc length, and both the floor and
          // the 0.6px overlap are stripped from it. Sorted by share, the last
          // segment is **by construction the smallest** — the one that needs the
          // floor most — and the closing seam at 12 o'clock reopens with it.
          const room = Math.max(0, c - offset);
          const length = Math.max(1.5, Math.min(slice.share * c, room)) + overlap;
          const dash = `${length} ${c - length}`;
          const dim = active !== null && active !== slice.key;
          const node = (
            <circle
              key={slice.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              className={slice.arc}
              strokeWidth={stroke}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              opacity={dim ? 0.28 : 1}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              onPointerEnter={() => setActive(slice.key)}
            >
              <title>{`${slice.label} ${percent(slice.share)}`}</title>
            </circle>
          );
          offset = Math.min(c, offset + slice.share * c);
          return node;
        })}
        {/* Whichever segment you are on, its share prints in the middle, so the
            eye does not have to travel between ring and legend to match them up. */}
        {active !== null && (
          <text
            x={size / 2}
            y={size / 2}
            textAnchor="middle"
            dominantBaseline="central"
            className="mono fill-foreground text-body font-semibold"
          >
            {percent(shown.find((slice) => slice.key === active)?.share ?? 0)}
          </text>
        )}
      </svg>

      <ul
        className="m-0 flex min-w-[180px] flex-1 list-none flex-col gap-1 p-0"
        onPointerLeave={() => setActive(null)}
      >
        {shown.map((slice) => (
          <li
            key={slice.key}
            className={`-mx-1.5 flex items-baseline gap-2.5 rounded-sm px-1.5 py-1 text-body ${
              active === slice.key ? "bg-muted" : ""
            }`}
            onPointerEnter={() => setActive(slice.key)}
          >
            <span
              aria-hidden
              className={`chart-swatch size-2 shrink-0 rounded-full ${slice.swatch}`}
            />
            {/* Never truncated: colour is the redundant channel and this label
                carries the identity. Cut it and nothing is left. */}
            <span className="min-w-0">{slice.label}</span>
            <span className="mono ml-auto shrink-0 tabular-nums text-muted-foreground">
              {percent(slice.share)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Horizontal bars — for an **incomplete** whole (the top five countries, with
 * more not listed).
 */
export function BarRows({
  rows,
}: {
  readonly rows: readonly { key: string; label: string; share: number }[];
}) {
  // Normalised to 100%, not to the largest row. Against the largest, the first
  // row is always a full bar, so 44.73% would draw as the whole width and read
  // as everything.
  //
  // One colour throughout, **not categorical**. Countries are an open set whose
  // top five change with the domain, so colour could encode no identity here;
  // and five more colours would compete with the donut's six for the same
  // channel. No opacity ramp either: rank is already stated three times over by
  // bar length, row order and the printed percentage, and that ramp's lightest
  // step sat at 1.24:1 on white.
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {rows.map((row) => (
        <li key={row.key} className="-mx-1.5 rounded-sm px-1.5 py-0.5 hover:bg-muted">
          <div className="flex items-baseline gap-2.5 text-body">
            <span className="min-w-0">{row.label}</span>
            <span className="mono ml-auto shrink-0 tabular-nums text-muted-foreground">
              {percent(row.share)}
            </span>
          </div>
          <div className="bar-track mt-1 h-1.5 w-full rounded-full bg-border">
            <div
              className="bar-fill h-full rounded-full bg-accent"
              style={{ width: `${row.share * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Monthly visits — a **line**.
 *
 * This used to be bars, on the grounds that three months are three discrete
 * periods. Against real data that reasoning does not hold: on 52.8K -> 42.3K ->
 * 137.9K what a reader wants is the **change** (a drop, then a tripling), and
 * bars sit side by side leaving you to join them up in your head.
 *
 * The baseline still starts at 0, so there is nothing to apologise for about a
 * non-zero baseline: the heights are the true ratios.
 *
 * The line and points take the accent colour, and **the numbers take none** —
 * those two rows are the data itself and want maximum contrast, not a
 * decorative tint.
 *
 * The line is smoothed (see smoothPath): three points drawn as two straight
 * segments put a hard corner at the middle month, and that corner is an
 * artifact of the drawing rather than an event in the data.
 */
/**
 * The path for the smoothed line.
 *
 * **Monotone** cubic interpolation (Fritsch-Carlson), not Catmull-Rom. The
 * difference shows on real data: on a series that dips and recovers, 52.8K ->
 * 42.3K -> 137.9K, Catmull-Rom carries the curve **past the trough** and back,
 * drawing a low point below 42.3K that never happened. Monotone interpolation
 * keeps the curve within the two points it joins, so it only rounds the corner
 * and never says anything the data did not.
 *
 * The tangents then become cubic Beziers: control points at a third of the run,
 * with the slope taken from that point's tangent.
 */
function smoothPath(pts: readonly { x: number; y: number }[]): string {
  const first = pts[0];
  if (!first) return "";
  if (pts.length === 1) return `M${first.x.toFixed(1)},${first.y.toFixed(1)}`;

  const n = pts.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const run = b.x - a.x;
    dx.push(run);
    slope.push(run === 0 ? 0 : (b.y - a.y) / run);
  }

  // Endpoints take the neighbouring segment's slope; an interior point whose
  // neighbours slope **in opposite directions** is pinned to zero, and that is
  // exactly where the no-overshoot guarantee comes from.
  const m: number[] = [slope[0] ?? 0];
  for (let i = 1; i < n - 1; i++) {
    const back = slope[i - 1] ?? 0;
    const fwd = slope[i] ?? 0;
    if (back * fwd <= 0) {
      m.push(0);
      continue;
    }
    const w1 = 2 * (dx[i] ?? 0) + (dx[i - 1] ?? 0);
    const w2 = (dx[i] ?? 0) + 2 * (dx[i - 1] ?? 0);
    m.push((w1 + w2) / (w1 / back + w2 / fwd));
  }
  m.push(slope[n - 2] ?? 0);

  let d = `M${first.x.toFixed(1)},${first.y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const run = (dx[i] ?? 0) / 3;
    const c1y = a.y + (m[i] ?? 0) * run;
    const c2y = b.y - (m[i + 1] ?? 0) * run;
    d += ` C${(a.x + run).toFixed(1)},${c1y.toFixed(1)} ${(b.x - run).toFixed(1)},${c2y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  }
  return d;
}

export function MonthlyLine({
  points,
  format,
}: {
  readonly points: readonly { date: string; visits: number }[];
  readonly format: (value: number) => string;
}) {
  const [hot, setHot] = useState<string | null>(null);
  const W = 300;
  const H = 108;
  const top = 22;
  const bottom = 78;
  const left = 6;
  const right = W - 6;
  const max = Math.max(...points.map((point) => point.visits), 1);

  const x = (index: number) =>
    points.length <= 1 ? (left + right) / 2 : left + (index * (right - left)) / (points.length - 1);
  // Zero baseline: y maps straight from value / max, with no compressed range.
  const y = (value: number) => bottom - (value / max) * (bottom - top);

  const coords = points.map((point, index) => ({ x: x(index), y: y(point.visits) }));
  const line = smoothPath(coords);
  const area = `${line} L${x(points.length - 1).toFixed(1)},${bottom} L${x(0).toFixed(1)},${bottom} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`Monthly visits: ${points
        .map((point) => `${monthLabel(point.date)} ${point.visits.toLocaleString("en-US")}`)
        .join(", ")}`}
      onPointerLeave={() => setHot(null)}
    >
      <title>Monthly visits</title>
      <line
        x1={left}
        y1={bottom}
        x2={right}
        y2={bottom}
        stroke="currentColor"
        strokeWidth="1"
        className="text-border"
      />
      {/*
        The area fill uses a tuned light token rather than accent plus opacity.
        What translucency produces depends on what is behind it: in dark mode the
        same 8% foreground muddies into grey, whereas --color-accent-soft has its
        own value in each scheme.
      */}
      <path d={area} className="fill-accent-soft" />
      <path
        d={line}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-accent"
      />
      {points.map((point, index) => (
        <g key={point.date}>
          {/* A halo in the card colour, to lift the point off the line. */}
          <circle cx={x(index)} cy={y(point.visits)} r="4.5" className="fill-card" />
          <circle
            cx={x(index)}
            cy={y(point.visits)}
            r={hot === point.date ? "4.5" : "3"}
            className="fill-accent"
          />
          {/*
            Hovering a point swaps in the **exact figure**. The label normally
            prints the compact form ("204.34M"), which is right for scanning but
            cannot answer "how many exactly".
            The hit area is a radius-12 circle, because a 3px dot is not aimable.
          */}
          <circle
            cx={x(index)}
            cy={y(point.visits)}
            r="12"
            fill="transparent"
            onPointerEnter={() => setHot(point.date)}
          />
          <text
            x={x(index)}
            y={y(point.visits) - 11}
            textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
            className="fill-foreground text-small font-semibold"
          >
            {hot === point.date ? point.visits.toLocaleString("en-US") : format(point.visits)}
          </text>
          <text
            x={x(index)}
            y={H - 4}
            textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
            className="fill-muted-foreground text-small"
          >
            {monthLabel(point.date)}
          </text>
        </g>
      ))}
    </svg>
  );
}

const monthLabel = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
};

/**
 * A bounded 0–100 score.
 *
 * A bare 71 has no denominator, so a reader cannot tell whether it is high or
 * low; the meter draws the denominator. The banding is not decided here: `tone`
 * comes from toneOf in domain/thresholds.ts. The previous `risk` boolean inlined
 * the thresholds here while the question of which fields deserve a meter lived
 * in a separate table in Report.tsx — one judgement split across two places,
 * where changing one side left the other behind.
 */
export function Meter({
  value,
  label,
  valueText,
  tone = "neutral",
}: {
  readonly value: number;
  /**
   * role="meter" needs an accessible name, so this is **required**.
   * There was none before, and a screen reader announced a bare "71"; once
   * Settings shows a daily and a monthly meter side by side, two bare numbers
   * are indistinguishable.
   */
  readonly label: string;
  /**
   * The value announced to assistive technology. **Not always a percentage** —
   * Domain Rating 95 is a score out of 100, not 95% — so the caller supplies it.
   */
  readonly valueText?: string;
  readonly tone?: Tone;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className="meter-track mt-2 h-1.5 w-24 rounded-full bg-border"
      role="meter"
      aria-label={label}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(valueText ? { "aria-valuetext": valueText } : {})}
      data-tone={tone}
    >
      <div
        className={`meter-fill h-full rounded-full ${TONE_FILL[tone]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
