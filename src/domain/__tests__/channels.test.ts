import { expect, it } from "vitest";
import { extractTraffic } from "../traffic.js";

const run = (trafficSources: Record<string, number>) =>
  extractTraffic([
    { globalRank: { rank: 50 }, engagements: { visits: 649_320_000 }, trafficSources },
  ]);

/*
 * Whatever the Provider sends is taken.
 *
 * This used to read values for six field names and drop everything else — and
 * drop it silently: the share was absorbed into "Not attributed", which looked
 * like the Provider withholding it. The Provider does send channels outside
 * that six — Display Ads among them — so the whitelist was losing real data.
 */
it("keeps a channel it has no name for", () => {
  const panel = run({
    direct: 0.5261,
    search: 0.2456,
    referrals: 0.0956,
    social: 0.0954,
    displayAds: 0.0024,
    mail: 0.0115,
  });
  const labels = panel?.sources.map((slice) => slice.label) ?? [];
  expect(labels).toContain("Paid referrals"); // displayAds is recognised as the same thing
  expect(panel?.sources).toHaveLength(6);
  const total = panel?.sources.reduce((sum, slice) => sum + slice.share, 0) ?? 0;
  expect(total).toBeCloseTo(0.9766, 4);
});

it("shows a channel nobody has ever seen rather than swallowing it", () => {
  const panel = run({ direct: 0.6, aiAssistants: 0.4 });
  expect(panel?.sources.map((slice) => slice.label)).toEqual(["Direct", "Ai assistants"]);
});

it("merges two spellings of the same channel instead of dropping one", () => {
  const panel = run({ direct: 0.5, search: 0.2, organicSearch: 0.1 });
  const search = panel?.sources.find((slice) => slice.key === "search");
  expect(search?.share).toBeCloseTo(0.3, 6);
  expect(panel?.sources).toHaveLength(2);
});

/* "Other" is not a channel but the unclassified part — left to the shortfall
   Donut computes, rather than taking a grey row of its own. */
it("folds Other back into the unattributed remainder", () => {
  const panel = run({ direct: 0.5261, referrals: 0.0956, mail: 0.0115, other: 0.0234 });
  expect(panel?.sources.map((slice) => slice.key)).toEqual(["direct", "referrals", "mail"]);
});

it("still ignores channels the Provider reports as zero", () => {
  const panel = run({ direct: 1, search: 0, social: 0 });
  expect(panel?.sources).toHaveLength(1);
});
