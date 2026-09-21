import { expect, it } from "vitest";
import { categoryLabel, extractTraffic } from "../traffic.js";

/*
 * Measured 2026-09-21 from run dc72563c (www.npmjs.com, $0.008).
 *
 * categoryRank and topKeywords were on the wire from the first traffic lookup
 * and went unread for months, while the panel bought ranked-keywords
 * separately at $0.13 for keywords with volume and CPC. This fixture is the
 * Actor's real shape, so a rename upstream shows up here rather than as two
 * silently empty sections.
 */
const ROW = {
  globalRank: { rank: 14504 },
  countryRank: { rank: 6270, countryCode: "IN" },
  category: "computers_electronics_and_technology/computers_electronics_and_technology",
  categoryRank: {
    rank: 191,
    category: "Computers_Electronics_and_Technology/Computers_Electronics_and_Technology",
  },
  engagements: { visits: 4172149, bounceRate: 0.5175, timeOnSite: 139.57, pagePerVisit: 3.07 },
  topKeywords: [
    { cpc: 1.75, name: "npm", volume: 223360, estimatedValue: 204320 },
    { cpc: 0, name: "npm install", volume: 62470, estimatedValue: 22300 },
  ],
};

it("reads the category rank and keywords the same Run already paid for", () => {
  const panel = extractTraffic([ROW]);
  expect(panel?.categoryRank).toEqual({
    rank: 191,
    category: "Computers electronics and technology",
  });
  expect(panel?.keywords).toEqual([
    { keyword: "npm", volume: 223360, cpc: 1.75 },
    // A zero CPC is measured — nobody bids on that term — so it must survive as
    // 0 rather than collapse to null and print as "no such figure".
    { keyword: "npm install", volume: 62470, cpc: 0 },
  ]);
});

/** A miss pushes a structurally complete row of zeros, and #0 in a category is
    not a rank. */
it("treats a zero category rank as absent", () => {
  const panel = extractTraffic([{ ...ROW, categoryRank: { rank: 0, category: "x" } }]);
  expect(panel?.categoryRank).toBeNull();
});

/** The Actor repeats the parent when there is no subcategory; printed whole it
    reads as a stutter, not a hierarchy. */
it("collapses a repeated category path and keeps a real one", () => {
  expect(
    categoryLabel("Computers_Electronics_and_Technology/Computers_Electronics_and_Technology"),
  ).toBe("Computers electronics and technology");
  expect(
    categoryLabel("Computers_Electronics_and_Technology/Programming_and_Developer_Software"),
  ).toBe("Computers electronics and technology · Programming and developer software");
});

/** A keyword with no name is not a keyword; the rest of the list still stands. */
it("drops a nameless keyword rather than rendering an empty row", () => {
  const panel = extractTraffic([
    {
      ...ROW,
      topKeywords: [
        { name: "", volume: 5 },
        { name: "npm", volume: 10, cpc: null },
      ],
    },
  ]);
  expect(panel?.keywords).toEqual([{ keyword: "npm", volume: 10, cpc: null }]);
});
