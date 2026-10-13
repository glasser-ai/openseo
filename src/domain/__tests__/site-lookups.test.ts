import { expect, it } from "vitest";
import { LOOKUPS } from "../lookups.js";

const lookup = (id: string) => LOOKUPS.find((item) => item.id === id)!;

/*
 * Fixtures measured 2026-10-13 against dataforseo.com, one Run each:
 * ahrefs f67e9933, semrush 26dd54b5, dataforseo 7bbe97e6, hunter 9034a048.
 * These are the Providers' real shapes, so a rename upstream fails here rather
 * than as a silently empty card.
 */

const SEMRUSH = {
  data: [
    { Date: "20260915", Rank: "130393", "Organic Traffic": "14289", "Organic Keywords": "22193" },
    { Date: "20260815", Rank: "84455", "Organic Traffic": "23528", "Organic Keywords": "18743" },
    { Date: "20251015", Rank: "334235", "Organic Traffic": "4758", "Organic Keywords": "5358" },
  ],
};

it("reads the newest month's search traffic and the change since the oldest", () => {
  const fields = lookup("traffic-history").extract(SEMRUSH);
  expect(fields).toEqual([
    { label: "Organic visits / month", value: "14.3K" },
    { label: "Change over 3 months", value: "+200%" },
    { label: "Organic keywords", value: "22.2K" },
    { label: "Semrush rank", value: "#130.4K" },
  ]);
});

/** Semrush sends newest first; the chart reads oldest first, and the mid-month
    stamp is pinned to the first of its month. */
it("turns the rows into an oldest-first monthly series", () => {
  expect(lookup("traffic-history").extractSeries?.(SEMRUSH)).toEqual([
    { date: "2025-10-01", visits: 4758 },
    { date: "2026-08-01", visits: 23528 },
    { date: "2026-09-01", visits: 14289 },
  ]);
});

it("asks Semrush about the registrable domain, twelve rows at most", () => {
  expect(lookup("traffic-history").buildInput("docs.example.com")).toEqual({
    domain: "example.com",
    database: "us",
    display_limit: 12,
  });
});
