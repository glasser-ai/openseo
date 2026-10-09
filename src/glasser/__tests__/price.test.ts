import { describe, expect, it } from "vitest";
import { maxChargeMicros, priceLine, ruleMaxMicros, unsupportedRule } from "../price.js";

describe("maxChargeMicros", () => {
  it("uses the rule when it is the largest", () => {
    expect(
      maxChargeMicros({
        rule: { type: "flat", amount_usd: "0.30" },
        charges: { NO_RESULT: "0.00", PROVIDER_ERROR: "0.05" },
      }),
    ).toBe(300_000n);
  });

  it("uses a clause when the clause exceeds the rule — the under-reserve bug", () => {
    expect(
      maxChargeMicros({
        rule: { type: "flat", amount_usd: "0.30" },
        charges: { PROVIDER_ERROR: "0.95", TIMED_OUT: "0.10" },
      }),
    ).toBe(950_000n);
  });

  it("uses the cap, never the per-result unit, for a per_result rule", () => {
    const price = {
      rule: { type: "per_result" as const, per_result_usd: "0.02", cap_usd: "2.00" },
      charges: { NO_RESULT: "0.00" },
    };
    expect(ruleMaxMicros(price.rule)).toBe(2_000_000n);
    expect(maxChargeMicros(price)).toBe(2_000_000n);
  });

  it("uses the cap for per_token and base_plus_per_result too", () => {
    expect(
      ruleMaxMicros({ type: "per_token", per_million_input_tokens_usd: "1.50", cap_usd: "0.40" }),
    ).toBe(400_000n);
    expect(
      ruleMaxMicros({
        type: "base_plus_per_result",
        base_usd: "0.012",
        included_results: 0,
        per_extra_result_usd: "0.00012",
        cap_usd: "0.024",
      }),
    ).toBe(24_000n);
  });

  it("refuses to bound a rule it does not know, instead of guessing", () => {
    const price = { rule: { type: "per_page", cap_usd: "9.00" }, charges: { NO_RESULT: "0.01" } };
    expect(ruleMaxMicros(price.rule)).toBeNull();
    expect(maxChargeMicros(price)).toBeNull();
    expect(unsupportedRule(price)).toContain('"per_page"');
  });

  it("treats absent clauses as zero rather than throwing", () => {
    expect(maxChargeMicros({ rule: { type: "flat", amount_usd: "0.10" }, charges: {} })).toBe(
      100_000n,
    );
  });
});

describe("priceLine", () => {
  it("names the unit, because half the catalog is per_result", () => {
    expect(priceLine({ rule: { type: "flat", amount_usd: "0.30" }, charges: {} })).toBe(
      "$0.30/run",
    );
    expect(
      priceLine({
        rule: { type: "per_result", per_result_usd: "0.02", cap_usd: "2.00" },
        charges: {},
      }),
    ).toBe("$0.02/result (up to $2.00)");
  });

  it("spells the rules the contract added after 0.1.1", () => {
    expect(
      priceLine({
        rule: {
          type: "base_plus_per_result",
          base_usd: "0.012",
          included_results: 0,
          per_extra_result_usd: "0.00012",
          cap_usd: "0.024",
          unit: "row",
        },
        charges: {},
      }),
    ).toBe("$0.012/run, +$0.00012 per row (up to $0.024)");
    expect(
      priceLine({
        rule: { type: "per_token", per_million_input_tokens_usd: "1.50", cap_usd: "0.40" },
        charges: {},
      }),
    ).toBe("$1.50/M tokens (up to $0.40)");
  });

  it("prefers the server's own display line, which covers rules this build cannot spell", () => {
    expect(
      priceLine({
        rule: { type: "per_page", page_usd: "0.01" },
        display: { amount_usd: "0.01", unit: "page", cap_usd: "0.50" },
        charges: {},
      }),
    ).toBe("$0.01/page (up to $0.50)");
  });
});
