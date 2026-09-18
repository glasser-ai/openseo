import { type Micros, maxMicros, usdToMicros } from "../ledger/micros.js";

/**
 * The Price as inspect reports it. Note this is not the same shape as the flat
 * trio on /public/catalog (price_usd / price_unit / price_cap_usd) and must not
 * be mixed with it — that trio is computed at build time, so a later price
 * change leaves it **stale**. inspect reports the Price a Run will actually use.
 */
export type PriceRule =
  | { readonly type: "flat"; readonly amount_usd: string }
  | {
      readonly type: "per_result";
      readonly per_result_usd: string;
      readonly cap_usd: string;
      readonly partial_usd?: string;
    };

/** One clause for each of the four non-rule outcomes. A missing clause counts
    as 0. */
export type PriceCharges = {
  readonly NO_RESULT?: string;
  readonly PROVIDER_ERROR?: string;
  readonly TIMED_OUT?: string;
  readonly INTERNAL?: string;
};

export type Price = { readonly rule: PriceRule; readonly charges: PriceCharges };

/** The rule's own ceiling: for flat it is the amount, and for per_result it is
    the hard cap rather than the unit price. */
export function ruleMaxMicros(rule: PriceRule): Micros {
  return rule.type === "flat" ? usdToMicros(rule.amount_usd) : usdToMicros(rule.cap_usd);
}

/**
 * The **largest** Charge a single Run can produce.
 *
 * Not the `rule` ceiling — a clause can cost more than the rule does
 * (PROVIDER_ERROR, for instance). The server holds against max(rule ceiling,
 * every clause), so this has to compute the same maximum: reserving against the
 * rule alone **under-reserves**, and the real spend then overshoots our own cap.
 */
export function maxChargeMicros(price: Price): Micros {
  const clauses = Object.values(price.charges)
    .filter((value): value is string => typeof value === "string")
    .map(usdToMicros);
  return maxMicros([ruleMaxMicros(price.rule), ...clauses]);
}

/** The price as one line for the user: $0.30/run, or $0.02/result (up to
    $2.00). */
export function priceLine(price: Price): string {
  const { rule } = price;
  if (rule.type === "flat") return `${formatted(rule.amount_usd)}/run`;
  return `${formatted(rule.per_result_usd)}/result (up to ${formatted(rule.cap_usd)})`;
}

function formatted(usd: string): string {
  const micros = usdToMicros(usd);
  const cents = micros / 10_000n;
  return micros > 0n && cents === 0n
    ? `$${usd.replace(/0+$/, "")}`
    : `$${(Number(cents) / 100).toFixed(2)}`;
}
