import { expect, it } from "vitest";
import { parseCompact } from "../traffic.js";

it.each([
  ["51.9M", 51_900_000],
  ["40.9M", 40_900_000],
  ["355.2K", 355_200],
  ["766", 766],
  ["14", 14],
  ["70.7K", 70_700],
  ["1,016,619", 1_016_619],
  ["6", 6],
  ["2.4B", 2_400_000_000],
])("reads %s back as %i", (text, expected) => {
  expect(parseCompact(text)).toBe(expected);
});

it.each(["—", "", "No record", "abc", "#3 · 12K/mo"])("gives up on %s", (text) => {
  expect(parseCompact(text)).toBeNaN();
});
