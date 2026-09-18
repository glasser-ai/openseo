import { describe, expect, it } from "vitest";
import { type Metric, type Tone, toneOf } from "../thresholds.js";

describe.each([
  [
    "domain-rating" as Metric,
    [
      // The low end is the weak band. This was once inverted: DR 30 amber
      // while DR 8 stayed plain.
      [0, "warn"],
      [19, "warn"],
      [20, "neutral"],
      [49, "neutral"],
      [50, "good"],
      [100, "good"],
    ],
  ],
  [
    "spam-score" as Metric,
    [
      [0, "neutral"],
      [29, "neutral"],
      [30, "warn"],
      [59, "warn"],
      [60, "bad"],
      [100, "bad"],
    ],
  ],
  [
    "bounce-rate" as Metric,
    [
      [0, "good"],
      [0.4, "good"],
      [0.401, "neutral"],
      [0.7, "neutral"],
      [0.701, "warn"],
      [1, "warn"],
    ],
  ],
  [
    "keyword-position" as Metric,
    [
      [0, "neutral"],
      [1, "good"],
      [10, "good"],
      [11, "neutral"],
      [20, "neutral"],
      [21, "warn"],
      [250, "warn"],
    ],
  ],
  [
    "monthly-visits" as Metric,
    [
      [0, "bad"],
      [1, "warn"],
      [99, "warn"],
      [999, "warn"],
      [1_000, "neutral"],
      [99_999, "neutral"],
      [100_000, "good"],
    ],
  ],
  [
    "organic-visits" as Metric,
    [
      [0, "bad"],
      [1, "warn"],
      [14, "warn"],
      [99, "warn"],
      [100, "neutral"],
      [9_999, "neutral"],
      [10_000, "good"],
    ],
  ],
  [
    "ranking-keywords" as Metric,
    [
      [0, "bad"],
      [1, "warn"],
      [9, "warn"],
      [10, "neutral"],
      [999, "neutral"],
      [1_000, "good"],
    ],
  ],
  [
    "backlinks" as Metric,
    [
      [0, "bad"],
      [1, "warn"],
      [99, "warn"],
      [100, "neutral"],
      [766, "neutral"],
      [9_999, "neutral"],
      [10_000, "good"],
    ],
  ],
  [
    "referring-domains" as Metric,
    [
      [0, "bad"],
      [1, "warn"],
      [9, "warn"],
      [10, "neutral"],
      [999, "neutral"],
      [1_000, "good"],
    ],
  ],
  [
    "site-rank" as Metric,
    [
      [0, "neutral"],
      [1, "good"],
      [100_000, "good"],
      [100_001, "neutral"],
      [200_000, "neutral"],
      [274_290, "warn"],
    ],
  ],
  [
    "pages-per-visit" as Metric,
    [
      [1.49, "warn"],
      [1.5, "neutral"],
      [2.99, "neutral"],
      [3, "good"],
    ],
  ],
  [
    "visit-duration" as Metric,
    [
      [29, "warn"],
      [30, "neutral"],
      [104, "neutral"],
      [179, "neutral"],
      [180, "good"],
    ],
  ],
  [
    "domain-age" as Metric,
    [
      [5, "warn"],
      [6, "neutral"],
      [35, "neutral"],
      [36, "good"],
    ],
  ],
  [
    "budget-used" as Metric,
    [
      [0, "neutral"],
      [0.79, "neutral"],
      [0.8, "warn"],
      [0.999, "warn"],
      [1, "bad"],
      [2, "bad"],
    ],
  ],
])("%s", (metric, rows) => {
  it.each(rows)("%p is %s", (value, expected) => {
    expect(toneOf(metric, value as number)).toBe(expected);
  });
});

const SEVERITY: Record<Tone, number> = { good: 0, neutral: 1, warn: 2, bad: 3 };

const METRICS: readonly Metric[] = [
  "domain-rating",
  "spam-score",
  "bounce-rate",
  "keyword-position",
  "budget-used",
  "monthly-visits",
  "organic-visits",
  "ranking-keywords",
  "backlinks",
  "referring-domains",
  "site-rank",
  "pages-per-visit",
  "visit-duration",
  "domain-age",
];

it.each(METRICS)("%s never colours a value it cannot trust", (metric) => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -0.5])
    expect(toneOf(metric, value)).toBe("neutral");
});

/*
 * Red is reserved for two things: a spam score at or above 60, and a budget at
 * its cap with requests being refused. That is a product decision rather than an
 * implementation detail, so the whole domain is swept to pin it down. Anyone
 * later adding a red band to DR or bounce rate trips this.
 */
/*
 * The line for red is drawn by **whether the metric is relative to industry**,
 * not by how low the number is.
 *
 * These are all relative — Ahrefs says DR only means something against peers,
 * content sites run 70-90% bounce year-round and that is often a good sign, and
 * CTR decays smoothly down the ranking with no cliff. So they cap at amber: "this
 * one is weak" is allowed, "something here is broken" is not.
 */
it.each([
  ["domain-rating" as Metric, 0, 100, 1],
  ["bounce-rate" as Metric, 0, 1, 0.01],
  ["keyword-position" as Metric, 1, 300, 1],
  ["site-rank" as Metric, 1, 5_000_000, 9_973],
  ["pages-per-visit" as Metric, 0, 20, 0.1],
  ["visit-duration" as Metric, 0, 1_200, 7],
  ["domain-age" as Metric, 0, 300, 1],
])("%s stays comparative and never reaches bad", (metric, from, to, stepBy) => {
  for (let value = from; value <= to; value += stepBy)
    expect(toneOf(metric, Number(value.toFixed(4)))).not.toBe("bad");
});

/*
 * The converse needs pinning too: **only** these can turn red.
 * For the first five, red means zero — no backlinks at all, no ranked keywords at
 * all — and zero is zero for everyone, regardless of industry or age. The last
 * two are the Provider's own stated risk score, and a functional failure with
 * requests being refused.
 */
it("only lets absence and explicit failure turn red", () => {
  const reachesBad = METRICS.filter((metric) =>
    [0, 1, 5, 9, 60, 100, 1e6].some((value) => toneOf(metric, value) === "bad"),
  );
  expect(reachesBad.sort()).toEqual(
    [
      "backlinks",
      "budget-used",
      "monthly-visits",
      "organic-visits",
      "ranking-keywords",
      "referring-domains",
      "spam-score",
    ].sort(),
  );
});

/*
 * **Zero means zero, not "close to zero".**
 *
 * The test above probes a handful of points and stays green with the red floor
 * set at 100 visits, because 0 is red there too. This one asks something else:
 * whether the first **non-zero** value is still red. A floor above zero trips it
 * immediately.
 * monthly-visits was once < 100, and organic-visits and backlinks < 10, which
 * judged a four-month-old site with 40 visits as "something here is broken".
 */
it.each(["monthly-visits", "organic-visits", "ranking-keywords", "backlinks", "referring-domains"])(
  "%s turns red at zero and nowhere above it",
  (metric) => {
    expect(toneOf(metric as Metric, 0)).toBe("bad");
    for (const value of [1, 2, 5, 9, 10, 40, 99, 100])
      expect(toneOf(metric as Metric, value), `${metric} at ${value}`).not.toBe("bad");
  },
);

/*
 * Two metrics that contain one another must not be inverted **on red**.
 *
 * Organic visits are a subset of total visits. When all traffic is organic the
 * same number appears on both rows — and "Monthly visits 50" was once red while
 * its own subset "Organic 50" was only amber, leaving the contained one looking
 * the cleaner of the two.
 *
 * This test covers **red only** and does not require the two rows to match at
 * every level: organic traffic is harder to earn than total traffic, so its bar
 * is deliberately one step lower (500 organic visits is respectable, 500 total
 * visits is a small site). Red is different — it claims something is broken, and
 * a whole cannot be more broken than a part it contains.
 */
it("never calls a total broken while the subset inside it is not", () => {
  for (let value = 0; value <= 2_000; value += 7) {
    const total = toneOf("monthly-visits", value);
    const organic = toneOf("organic-visits", value);
    if (total === "bad") expect(organic, `${value} visits, all organic`).toBe("bad");
  }
});

/*
 * Direction. **Written from intent, not from the implementation.**
 *
 * The previous version of this was a table of the order the bands appear in, and
 * that table was transcribed from the code — so when domain-rating left the low
 * end plain and painted the middle amber (the weaker value looking cleaner than
 * the stronger), the table said the same thing, the two agreed, and the tests
 * stayed green.
 *
 * This asks nothing about band order, only one thing: **moving a number in its
 * good direction must never make the tone more alarming.** Severity runs good <
 * neutral < warn < bad. Invert a direction and this goes red at once.
 */

/** true means higher is better. */
const HIGHER_IS_BETTER: Record<Metric, boolean> = {
  "domain-rating": true,
  "monthly-visits": true,
  "organic-visits": true,
  "ranking-keywords": true,
  backlinks: true,
  "referring-domains": true,
  "pages-per-visit": true,
  "visit-duration": true,
  "domain-age": true,
  "spam-score": false,
  "bounce-rate": false,
  "budget-used": false,
  // Positions: lower is better.
  "keyword-position": false,
  "site-rank": false,
};

it.each([
  ["domain-rating" as Metric, 0, 100, 1],
  ["spam-score" as Metric, 0, 100, 1],
  ["bounce-rate" as Metric, 0, 1, 0.01],
  ["keyword-position" as Metric, 1, 300, 1],
  ["budget-used" as Metric, 0, 2, 0.01],
  ["monthly-visits" as Metric, 0, 500_000, 977],
  ["organic-visits" as Metric, 0, 50_000, 97],
  ["ranking-keywords" as Metric, 0, 5_000, 11],
  ["backlinks" as Metric, 0, 50_000, 97],
  ["referring-domains" as Metric, 0, 5_000, 11],
  ["site-rank" as Metric, 1, 500_000, 977],
  ["pages-per-visit" as Metric, 0, 20, 0.1],
  ["visit-duration" as Metric, 0, 1_200, 7],
  ["domain-age" as Metric, 0, 300, 1],
])("%s never gets more alarming as the number improves", (metric, from, to, stepBy) => {
  const better = HIGHER_IS_BETTER[metric];
  let previous: number | null = null;
  for (let value = from; value <= to; value += stepBy) {
    const here = SEVERITY[toneOf(metric, Number(value.toFixed(4)))];
    if (previous !== null) {
      // Higher-is-better: sweeping upward, severity may only fall or hold.
      // Higher-is-worse: it may only rise or hold.
      if (better) expect(here).toBeLessThanOrEqual(previous);
      else expect(here).toBeGreaterThanOrEqual(previous);
    }
    previous = here;
  }
});
