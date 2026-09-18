import { describe, expect, it } from "vitest";
import { maxChargeMicros, priceLine, ruleMaxMicros } from "../price.js";

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
});
