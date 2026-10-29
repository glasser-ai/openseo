import { expect, it } from "vitest";
import { LOOKUPS, type LookupId, marketFor } from "../lookups.js";
import { DEFAULT_MARKET, MARKETS, marketOf, WORLDWIDE } from "../markets.js";

const lookup = (id: LookupId) => LOOKUPS.find((item) => item.id === id)!;
const brazil = marketOf("br");
const us = marketOf("us");

it("starts on all countries", () => {
  expect(DEFAULT_MARKET).toBe(WORLDWIDE);
  expect(marketOf("zz")).toBe(WORLDWIDE);
});

/* Search was US-only before markets. The cache keys on the input, so the US
   input must stay what it was or every saved US report is bought again. */
it("builds the same US input as before markets existed", () => {
  expect(lookup("organic-traffic").buildInput("example.com", us)).toEqual({
    targets: ["example.com"],
    location_code: 2840,
    language_code: "en",
  });
  expect(lookup("ranked-keywords").buildInput("example.com", us)).toEqual({
    target: "example.com",
    location_code: 2840,
    language_code: "en",
    limit: 25,
  });
  expect(lookup("traffic-history").buildInput("example.com", us)).toEqual({
    domain: "example.com",
    database: "us",
    display_limit: 12,
  });
});

/* Measured 2026-10-29: DataForSEO Labs answered traffic and ranked keywords
   with no location (location_code null). Semrush history has no all-countries
   database. */
it("sends no location for all countries where the Provider reads every country", () => {
  expect(lookup("organic-traffic").buildInput("example.com", WORLDWIDE)).toEqual({
    targets: ["example.com"],
  });
  expect(lookup("ranked-keywords").buildInput("example.com", WORLDWIDE)).toEqual({
    target: "example.com",
    limit: 25,
  });
});

it("reads the fallback country, and says so, where there is no worldwide answer", () => {
  for (const item of LOOKUPS.filter((entry) => entry.byMarket)) {
    const read = marketFor(item, WORLDWIDE);
    expect(item.buildInput("example.com", WORLDWIDE)).toEqual(item.buildInput("example.com", read));
    expect(read === WORLDWIDE).toBe(item.worldwide === true);
  }
  expect(marketFor(lookup("traffic-history"), WORLDWIDE)).toBe(us);
  expect(marketFor(lookup("traffic-history"), brazil)).toBe(brazil);
});

it("reads another country's Google with that country's language", () => {
  expect(lookup("organic-traffic").buildInput("example.com", brazil)).toEqual({
    targets: ["example.com"],
    location_code: 2076,
    language_code: "pt",
  });
  expect(lookup("traffic-history").buildInput("example.com", brazil)).toMatchObject({
    database: "br",
  });
});

it("keeps one input for reports that do not depend on the country", () => {
  for (const item of LOOKUPS.filter((entry) => !entry.byMarket)) {
    expect(item.buildInput("example.com", brazil)).toEqual(
      item.buildInput("example.com", DEFAULT_MARKET),
    );
  }
});

it("reads an unknown market id as the default", () => {
  expect(marketOf(undefined)).toBe(DEFAULT_MARKET);
  expect(new Set(MARKETS.map((market) => market.id)).size).toBe(MARKETS.length);
});

/* Measured 2026-10-29: an all-countries answer repeats a keyword once per
   country. The limit cuts the list, so the rows are a sample of countries:
   the table shows one country's figures and names it, and adds nothing up. */
it("shows each keyword once, for its best country, without a sum", () => {
  const row = (location: number, volume: number, position: number, etv: number) => ({
    keyword_data: {
      keyword: "anthropic ai assistant",
      location_code: location,
      keyword_info: { search_volume: volume, cpc: 1 },
    },
    ranked_serp_element: { serp_item: { rank_absolute: position, etv } },
  });
  const answer = (location_code: number | null) => ({
    tasks: [
      {
        result: [
          {
            location_code,
            items: [row(2036, 1_900, 1, 577), row(2840, 14_800, 2, 4_499), row(2826, 110, 3, 33)],
          },
        ],
      },
    ],
  });
  expect(lookup("ranked-keywords").extractKeywords?.(answer(null))).toEqual([
    {
      keyword: "anthropic ai assistant",
      position: 2,
      monthlyVolume: 14_800,
      traffic: 4_499,
      cpc: 1,
      country: "United States",
    },
  ]);
  // One country asked for: no country under each keyword.
  expect(lookup("ranked-keywords").extractKeywords?.(answer(2840))?.[0]).not.toHaveProperty(
    "country",
  );
});
