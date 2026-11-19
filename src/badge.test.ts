import { expect, it } from "vitest";
import { badgeHost, badgeLabel, canLookUp } from "./badge.js";
import type { PanelEntry } from "./domain/cache.js";

const entry = (payload: PanelEntry["payload"]): PanelEntry => ({
  payload,
  runUrl: "",
  chargeUsd: null,
  fetchedAt: 0,
});

it.each([
  ["https://www.example.com/path?q=1", "www.example.com"],
  ["http://example.com", "example.com"],
  ["chrome://extensions", null],
  ["file:///tmp/a.html", null],
  ["not a url", null],
  [undefined, null],
])("reads the host of %s", (url, expected) => {
  expect(badgeHost(url)).toBe(expected);
});

it("shows the cached Domain Rating", () => {
  expect(
    badgeLabel(entry({ kind: "fields", fields: [{ label: "Domain Rating", value: "97" }] })),
  ).toBe("97");
});

it("rounds a fractional rating to fit the badge", () => {
  expect(
    badgeLabel(entry({ kind: "fields", fields: [{ label: "Domain Rating", value: "42.6" }] })),
  ).toBe("43");
});

it("clears the badge when there is nothing to show", () => {
  expect(badgeLabel(null)).toBe("");
  expect(badgeLabel(entry({ kind: "none", reason: "no data" }))).toBe("");
  expect(badgeLabel(entry({ kind: "fields", fields: [] }))).toBe("");
  expect(
    badgeLabel(entry({ kind: "fields", fields: [{ label: "Domain Rating", value: "—" }] })),
  ).toBe("");
});

it.each([
  ["www.example.com", true],
  ["example.co.uk", true],
  ["localhost", false],
  ["127.0.0.1", false],
  ["intranet", false],
  ["hr.corp.local", false],
  ["wiki.internal", false],
  ["nas.lan", false],
  ["router.home.arpa", false],
  ["site.onion", false],
  ["app.localhost", false],
  ["dev.test", false],
])("decides whether %s can be looked up", (host, expected) => {
  expect(canLookUp(host)).toBe(expected);
});
