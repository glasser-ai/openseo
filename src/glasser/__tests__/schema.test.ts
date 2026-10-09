import { describe, expect, it } from "vitest";
import { maxChargeMicros } from "../price.js";
import { decodeEndpointDetail } from "../schema.js";

/** Captured with `glasser inspect -j` on 2026-10-09, after the contract gained
    `base_plus_per_result`. Three of the four lookups this extension makes are
    priced by it; a decoder that knows only flat and per_result fails every one
    of them before a Run exists. */
const LIVE = [
  {
    provider: "ahrefs",
    endpoint: "/v3/public/domain-rating-free",
    endpoint_version: 1,
    name: "Look Up the Domain Rating (DR) of a Domain or URL (Ahrefs)",
    run_mode: "sync",
    timeout_ms: 20000,
    price: {
      rule: {
        type: "flat",
        amount_usd: "0.0005",
      },
      display: {
        amount_usd: "0.0005",
        unit: "call",
      },
      charges: {
        NO_RESULT: "0.00",
        PROVIDER_ERROR: "0.00",
        TIMED_OUT: "0.00",
        INTERNAL: "0.00",
      },
    },
    description: "…",
    input_schema: {},
  },
  {
    provider: "dataforseo",
    endpoint: "/v3/dataforseo_labs/google/bulk_traffic_estimation/live",
    endpoint_version: 2,
    name: "Labs bulk_traffic_estimation live",
    run_mode: "sync",
    timeout_ms: 30000,
    price: {
      rule: {
        type: "base_plus_per_result",
        base_usd: "0.012",
        included_results: 0,
        per_extra_result_usd: "0.00012",
        cap_usd: "0.024",
        unit: "row",
      },
      display: {
        amount_usd: "0.012",
        unit: "call, +$0.00012 per row",
        cap_usd: "0.024",
      },
      charges: {
        NO_RESULT: "0.012",
        PROVIDER_ERROR: "0.00",
        TIMED_OUT: "0.00",
        INTERNAL: "0.00",
      },
    },
    description: "…",
    input_schema: {},
  },
  {
    provider: "dataforseo",
    endpoint: "/v3/dataforseo_labs/google/ranked_keywords/live",
    endpoint_version: 2,
    name: "List the Organic Keywords a Domain or URL Already Ranks For (DataForSEO)",
    run_mode: "sync",
    timeout_ms: 30000,
    price: {
      rule: {
        type: "base_plus_per_result",
        base_usd: "0.012",
        included_results: 0,
        per_extra_result_usd: "0.00012",
        cap_usd: "0.024",
        unit: "row",
      },
      display: {
        amount_usd: "0.012",
        unit: "call, +$0.00012 per row",
        cap_usd: "0.024",
      },
      charges: {
        NO_RESULT: "0.012",
        PROVIDER_ERROR: "0.00",
        TIMED_OUT: "0.00",
        INTERNAL: "0.00",
      },
    },
    description: "…",
    input_schema: {},
  },
  {
    provider: "dataforseo",
    endpoint: "/v3/backlinks/summary/live",
    endpoint_version: 2,
    name: "Get Backlink Totals and Domain Rank for a Domain or URL (DataForSEO)",
    run_mode: "sync",
    timeout_ms: 30000,
    price: {
      rule: {
        type: "base_plus_per_result",
        base_usd: "0.024",
        included_results: 0,
        per_extra_result_usd: "0.000036",
        cap_usd: "0.024036",
        unit: "row",
      },
      display: {
        amount_usd: "0.024",
        unit: "call, +$0.000036 per row",
        cap_usd: "0.024036",
      },
      charges: {
        NO_RESULT: "0.024",
        PROVIDER_ERROR: "0.00",
        TIMED_OUT: "0.00",
        INTERNAL: "0.00",
      },
    },
    description: "…",
    input_schema: {},
  },
] as const;

describe("decodeEndpointDetail", () => {
  it("decodes every rule shape the four lookups are priced by today", () => {
    for (const body of LIVE) {
      const detail = decodeEndpointDetail(body);
      expect(detail.price.rule.type).toBe(body.price.rule.type);
      expect(detail.price.display).toEqual(body.price.display);
    }
  });

  it("bounds base_plus_per_result by its cap, never by the base", () => {
    const detail = decodeEndpointDetail(LIVE[3]);
    expect(maxChargeMicros(detail.price)).toBe(24_036n);
  });

  it("decodes a rule shape this build has never seen, as the contract's open member requires", () => {
    const body = {
      ...LIVE[0],
      price: { ...LIVE[0].price, rule: { type: "per_page", page_usd: "0.01", cap_usd: "0.50" } },
    };
    const detail = decodeEndpointDetail(body);
    expect(detail.price.rule.type).toBe("per_page");
    expect(maxChargeMicros(detail.price)).toBeNull();
  });
});
