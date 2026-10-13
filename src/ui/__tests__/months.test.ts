import { expect, it } from "vitest";
import { withMissingMonths } from "../Traffic.jsx";

/** app.glasser.ai as saved before the fix: only September survived. */
it("puts back the zero months an older save dropped", () => {
  expect(withMissingMonths([{ date: "2026-09-01", visits: 274 }])).toEqual([
    { date: "2026-07-01", visits: 0 },
    { date: "2026-08-01", visits: 0 },
    { date: "2026-09-01", visits: 274 },
  ]);
});

it("fills a gap in the middle and crosses a year", () => {
  expect(
    withMissingMonths([
      { date: "2025-11-01", visits: 5 },
      { date: "2026-01-01", visits: 7 },
    ]),
  ).toEqual([
    { date: "2025-11-01", visits: 5 },
    { date: "2025-12-01", visits: 0 },
    { date: "2026-01-01", visits: 7 },
  ]);
});

it("leaves a complete series alone", () => {
  const full = [
    { date: "2026-07-01", visits: 1 },
    { date: "2026-08-01", visits: 2 },
    { date: "2026-09-01", visits: 3 },
  ];
  expect(withMissingMonths(full)).toEqual(full);
  expect(withMissingMonths([])).toEqual([]);
});
