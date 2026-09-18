import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { expect, it } from "vitest";
import { toneOf } from "../../domain/thresholds.js";
import { Donut, Meter, MonthlyLine } from "../charts.jsx";
import { assignSlots } from "../palette.js";

async function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container;
}

const CHANNELS = ["direct", "search", "referrals", "social", "paidReferrals", "mail"] as const;

const donutOf = (order: readonly string[]) => {
  const slots = assignSlots(order);
  return createElement(Donut, {
    slices: order.map((key) => {
      const slot = slots.get(key);
      // Share only sets arc length; this test is about colour, so split evenly.
      const base = { key, label: key, share: 1 / order.length };
      return slot === undefined ? base : { ...base, slot };
    }),
  });
};

const legendRows = (container: HTMLElement) =>
  [...container.querySelectorAll("li")].map((li) => li.textContent ?? "");

const CIRCUMFERENCE = 2 * Math.PI * ((104 - 18) / 2);

/** Each arc as [start, drawn length], read straight off dasharray and
    dashoffset. */
const arcExtents = (container: HTMLElement): readonly (readonly [number, number])[] =>
  [...container.querySelectorAll("circle")]
    .filter((circle) => circle.querySelector("title"))
    .map((circle) => [
      -Number(circle.getAttribute("stroke-dashoffset")),
      Number(circle.getAttribute("stroke-dasharray")?.split(" ")[0]),
    ]);

const arcClasses = (container: HTMLElement) =>
  new Map(
    [...container.querySelectorAll("circle")]
      .filter((circle) => circle.querySelector("title"))
      .map((circle) => [
        circle.querySelector("title")?.textContent?.split(" ")[0] ?? "",
        circle.getAttribute("class") ?? "",
      ]),
  );

/*
 * sources is **sorted by share**, so the same channel sits at a different index
 * for a different domain or a different month. Keyed by index, Search dropping
 * to third would change colour — while it is still Search.
 * This test pins colour to the key rather than the index.
 */
it("gives a channel the same colour no matter where it sorts", async () => {
  const first = arcClasses(await render(donutOf(CHANNELS)));
  const second = arcClasses(await render(donutOf([...CHANNELS].reverse())));

  expect(first.size).toBe(CHANNELS.length);
  for (const channel of CHANNELS) expect(second.get(channel)).toBe(first.get(channel));
  // And the six channels get six **different** slots.
  expect(new Set(first.values()).size).toBe(CHANNELS.length);
});

/* Caches outlive extension versions, and a Provider may add channels. An
   unfamiliar key still has to render. */
it("still renders a channel it has never seen", async () => {
  const container = await render(donutOf(["search", "someFutureChannel"]));
  const classes = [...arcClasses(container).values()];
  expect(classes).toHaveLength(2);
  for (const value of classes) expect(value).toMatch(/stroke-chart-[1-6]/);
});

it.each([
  [15, "neutral"],
  [45, "warn"],
  [75, "bad"],
])("shows a spam score of %i as %s", async (score, expected) => {
  const container = await render(
    createElement(Meter, {
      value: score,
      label: "Spam score",
      tone: toneOf("spam-score", score),
    }),
  );
  expect(container.querySelector("[role=meter]")?.getAttribute("data-tone")).toBe(expected);
});

/* Without an accessible name, a screen reader announces role="meter" as a bare
   number. */
it("names every meter", async () => {
  const container = await render(
    createElement(Meter, { value: 71, label: "Domain Rating", valueText: "71 out of 100" }),
  );
  const meter = container.querySelector("[role=meter]");
  expect(meter?.getAttribute("aria-label")).toBe("Domain Rating");
  expect(meter?.getAttribute("aria-valuetext")).toBe("71 out of 100");
});

const SERIES = [
  { date: "2026-06-01", visits: 2_530 },
  { date: "2026-07-01", visits: 98_120 },
  { date: "2026-08-01", visits: 135_820 },
];

const linePath = async (points: typeof SERIES) => {
  const container = await render(
    createElement(MonthlyLine, { points, format: (value: number) => String(value) }),
  );
  // The first path is the area, the second the line. The line has none of the
  // L segments back to the baseline.
  const paths = [...container.querySelectorAll("path")];
  return paths[1]?.getAttribute("d") ?? "";
};

it("draws the trend as a curve, not two straight segments", async () => {
  const d = await linePath(SERIES);
  expect(d).toContain("C");
  expect(d).not.toMatch(/\sL/);
});

/*
 * Smoothing must not **say more than the data does**.
 *
 * What matters is a series with **a turning point**: 52.8K -> 42.3K -> 137.9K
 * falls then rises, with the middle month at the trough. At that point
 * Catmull-Rom takes the tangent as the average of the slopes either side, so the
 * curve **carries on past the trough** before turning back — drawing a low point
 * below 42.3K that never happened. Monotone cubic interpolation pins the tangent
 * to zero at a turning point, so the curve stops at the trough.
 *
 * (A monotonically rising series cannot tell the two apart, which is why it
 * cannot be used to test this.)
 */
const DIP = [
  { date: "2026-06-01", visits: 52_800 },
  { date: "2026-07-01", visits: 42_300 },
  { date: "2026-08-01", visits: 137_900 },
];

it("never lets the curve overshoot a dip in the data", async () => {
  const d = await linePath(DIP);
  const ys = [...d.matchAll(/[-\d.]+,([-\d.]+)/g)].map((m) => Number(m[1]));
  expect(ys.length).toBeGreaterThan(3);

  const top = 22;
  const bottom = 78;
  const max = Math.max(...DIP.map((point) => point.visits));
  const pointYs = DIP.map((point) => bottom - (point.visits / max) * (bottom - top));

  for (const y of ys) {
    expect(y).toBeGreaterThanOrEqual(Math.min(...pointYs) - 0.05);
    // In SVG, larger y is lower. Passing the trough's y means drawing a lower
    // point that does not exist.
    expect(y).toBeLessThanOrEqual(Math.max(...pointYs) + 0.05);
  }
});

it("still draws a single point without a curve", async () => {
  const d = await linePath([SERIES[0] as (typeof SERIES)[number]]);
  expect(d).toMatch(/^M[\d.]+,[\d.]+$/);
});

/*
 * The Provider does not guarantee all six channels. The shortfall must **have a
 * name**.
 *
 * It used to be the track colour showing through: an unexplained gap in the ring
 * with no matching legend row — which simply looked like a rendering fault. It
 * now has a colour, a label and a percentage like any other segment.
 */
it("names the share the Provider did not attribute", async () => {
  const container = await render(
    createElement(Donut, {
      slices: [
        { key: "direct", label: "Direct", share: 0.7723, slot: 0 },
        { key: "referrals", label: "Referrals", share: 0.0805, slot: 2 },
        { key: "mail", label: "Mail", share: 0.0293, slot: 5 },
      ],
    }),
  );
  const rows = legendRows(container);
  expect(rows).toHaveLength(4);
  expect(rows[3]).toContain("Not attributed");
  expect(rows[3]).toContain("11.79%");

  // The ring closes as a result: four arcs, not three and a gap.
  expect(arcClasses(container).size).toBe(4);
});

it("leaves a complete whole alone", async () => {
  const container = await render(
    createElement(Donut, {
      slices: [
        { key: "direct", label: "Direct", share: 0.6, slot: 0 },
        { key: "search", label: "Search", share: 0.4, slot: 1 },
      ],
    }),
  );
  expect(legendRows(container)).toHaveLength(2);
});

it("ignores a rounding-sized remainder", async () => {
  const container = await render(
    createElement(Donut, {
      slices: [
        { key: "direct", label: "Direct", share: 0.6, slot: 0 },
        { key: "search", label: "Search", share: 0.3999, slot: 1 },
      ],
    }),
  );
  expect(legendRows(container)).toHaveLength(2);
});

/*
 * An unfamiliar channel **must not** collide with a known one's colour.
 *
 * This is exactly what the old slotOf got wrong: search takes its pinned slot 1,
 * while video is unfamiliar and falls back to index 1 — two arcs and two legend
 * dots in one colour, at which point colour is no longer identity.
 */
it("never gives two channels the same colour", async () => {
  for (const order of [
    ["search", "video"],
    ["direct", "search", "aiAssistants"],
    ["mail", "unknownOne", "unknownTwo", "direct"],
  ]) {
    const classes = [...arcClasses(await render(donutOf(order))).values()];
    expect(new Set(classes).size, order.join("+")).toBe(order.length);
  }
});

/* The same set of channels gets the same colours whatever order they arrive in. */
it("assigns the same colours regardless of input order", () => {
  const keys = ["direct", "mail", "somethingNew", "search"];
  const a = assignSlots(keys);
  const b = assignSlots([...keys].reverse());
  for (const key of keys) expect(b.get(key)).toBe(a.get(key));
});

/*
 * The palette has six colours. A seventh channel **must not borrow** a known
 * one's.
 *
 * assignSlots' loop used to exit once every slot was taken and write the current
 * next anyway — so with six known channels holding 0-5, aiAssistants received
 * slot 0 and was painted Direct's blue. It now gets no slot and Donut renders it
 * in the neutral grey, which says "this one has no colour of its own" rather
 * than impersonating Direct. Its name and share stay in the legend as before.
 */
it("never lends a known channel's colour to an overflow one", async () => {
  const order = [
    "direct",
    "search",
    "referrals",
    "social",
    "paidReferrals",
    "mail",
    "aiAssistants",
    "affiliate",
  ];
  const classes = arcClasses(await render(donutOf(order)));
  expect(classes.size).toBe(order.length);

  const named = order.slice(0, 6).map((key) => classes.get(key));
  // The six known channels each get their own colour, with no repeats.
  expect(new Set(named).size).toBe(6);
  for (const overflow of ["aiAssistants", "affiliate"]) {
    expect(classes.get(overflow), overflow).toBe("stroke-chart-rest");
    expect(named, overflow).not.toContain(classes.get(overflow));
  }
});

/* When shares sum past 1, the arcs must not **wrap** around and paint over the
   earlier ones. */
it("keeps the ring from wrapping when shares overflow", async () => {
  const container = await render(
    createElement(Donut, {
      slices: [
        { key: "a", label: "a", share: 0.8, slot: 0 },
        { key: "b", label: "b", share: 0.8, slot: 1 },
        { key: "c", label: "c", share: 0.8, slot: 2 },
      ],
    }),
  );
  // The tolerance is the 1.5 floor plus the 0.6 overlap: once the space is used
  // up each segment still draws its minimum visible length, but they stop at 12
  // o'clock rather than wrapping. What has to be prevented is **unbounded**
  // overrun, not these 2.1px.
  for (const [start, drawn] of arcExtents(container))
    expect(start + drawn).toBeLessThanOrEqual(CIRCUMFERENCE + 1.5 + 0.6 + 0.01);
});

/*
 * The last segment is **the smallest** (sorted by share descending, with the
 * shortfall appended last), so it is the one that needs the floor most.
 *
 * Clamped on the outside, room pins it to exactly its own remaining space: with
 * shares summing to 1, room equals that segment's own arc length, so the 1.5px
 * floor and the 0.6px overlap are both stripped — a 0.2% channel draws at
 * 0.54px, invisible, while the legend still prints its percentage.
 */
it("keeps the minimum arc length on the smallest, last slice", async () => {
  const container = await render(
    createElement(Donut, {
      slices: [
        { key: "big", label: "big", share: 0.998, slot: 0 },
        { key: "tiny", label: "tiny", share: 0.002, slot: 1 },
      ],
    }),
  );
  const drawn = [...arcExtents(container)].map(([, length]) => length);
  expect(drawn).toHaveLength(2);
  // 0.2% is only 0.54px; the floor lifts it to something visible.
  expect(drawn[1]).toBeGreaterThanOrEqual(1.5);
});

/* The closing seam must not reopen because of the clamp either: the last
   segment keeps its 0.6px overlap. */
it("keeps the closing seam covered on the last slice", async () => {
  const container = await render(
    createElement(Donut, {
      slices: [
        { key: "a", label: "a", share: 0.5, slot: 0 },
        { key: "b", label: "b", share: 0.5, slot: 1 },
      ],
    }),
  );
  const drawn = [...arcExtents(container)].map(([, length]) => length);
  for (const length of drawn) expect(length).toBeGreaterThan(CIRCUMFERENCE / 2);
});
