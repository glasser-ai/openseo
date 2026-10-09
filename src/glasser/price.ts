import { type Micros, maxMicros, usdToMicros } from "../ledger/micros.js";

/**
 * The Price as inspect reports it. Note this is not the same shape as the flat
 * trio on /public/catalog (price_usd / price_unit / price_cap_usd) and must not
 * be mixed with it — that trio is computed at build time, so a later price
 * change leaves it **stale**. inspect reports the Price a Run will actually use.
 */
export type KnownPriceRule =
  | { readonly type: "flat"; readonly amount_usd: string }
  | {
      readonly type: "per_result";
      readonly per_result_usd: string;
      readonly cap_usd: string;
      readonly partial_usd?: string;
    }
  | {
      readonly type: "per_token";
      readonly per_million_input_tokens_usd: string;
      readonly cap_usd: string;
    }
  | {
      readonly type: "base_plus_per_result";
      readonly base_usd: string;
      readonly included_results: number;
      readonly per_extra_result_usd: string;
      readonly cap_usd: string;
      readonly unit?: string;
    };

/** The contract's open member: a rule added upstream that this build does not
    know. It decodes, so the response stays readable, but its ceiling does not. */
export type UnknownPriceRule = { readonly type: string; readonly [key: string]: unknown };

export type PriceRule = KnownPriceRule | UnknownPriceRule;

/** The open member matches every `type`, so a switch cannot narrow `PriceRule`
    on its own; this hands back the rule as a closed union, or nothing. */
function known(rule: PriceRule): KnownPriceRule | null {
  switch (rule.type) {
    case "flat":
    case "per_result":
    case "per_token":
    case "base_plus_per_result":
      return rule as KnownPriceRule;
    default:
      return null;
  }
}

/** One clause for each of the four non-rule outcomes. A missing clause counts
    as 0. */
export type PriceCharges = {
  readonly NO_RESULT?: string;
  readonly PROVIDER_ERROR?: string;
  readonly TIMED_OUT?: string;
  readonly INTERNAL?: string;
};

/** The server's own one-line spelling of the price. */
export type PriceDisplay = {
  readonly amount_usd: string;
  readonly unit: string;
  readonly cap_usd?: string;
};

export type Price = {
  readonly rule: PriceRule;
  readonly display?: PriceDisplay;
  readonly charges: PriceCharges;
};

/**
 * The rule's own ceiling: for flat it is the amount, and for every capped rule
 * it is the hard cap rather than the unit price. `null` for a rule this build
 * cannot bound — the caller must refuse to run rather than reserve a guess,
 * because a reservation below the real ceiling is the under-reserve bug.
 */
export function ruleMaxMicros(rule: PriceRule): Micros | null {
  const r = known(rule);
  if (r === null) return null;
  return usdToMicros(r.type === "flat" ? r.amount_usd : r.cap_usd);
}

/**
 * The **largest** Charge a single Run can produce, or `null` when the rule is
 * one this build cannot bound.
 *
 * Not the `rule` ceiling — a clause can cost more than the rule does
 * (PROVIDER_ERROR, for instance). The server holds against max(rule ceiling,
 * every clause), so this has to compute the same maximum: reserving against the
 * rule alone **under-reserves**, and the real spend then overshoots our own cap.
 */
export function maxChargeMicros(price: Price): Micros | null {
  const ceiling = ruleMaxMicros(price.rule);
  if (ceiling === null) return null;
  const clauses = Object.values(price.charges)
    .filter((value): value is string => typeof value === "string")
    .map(usdToMicros);
  return maxMicros([ceiling, ...clauses]);
}

/** The reason to show when a Price cannot be bounded. */
export const unsupportedRule = (price: Price): string =>
  `this build cannot price a "${price.rule.type}" rule; update OpenSEO`;

/** The price as one line for the user: $0.30/run, or $0.02/result (up to
    $2.00). The server's `display` wins when present, since it already spells
    every rule shape; the rule itself is the fallback for the shapes known here. */
export function priceLine(price: Price): string {
  const { display } = price;
  if (display) {
    const unit = `${formatted(display.amount_usd)}/${display.unit}`;
    return display.cap_usd === undefined ? unit : `${unit} (up to ${formatted(display.cap_usd)})`;
  }
  const r = known(price.rule);
  if (r === null) return `${price.rule.type} rule`;
  switch (r.type) {
    case "flat":
      return `${formatted(r.amount_usd)}/run`;
    case "per_result":
      return `${formatted(r.per_result_usd)}/result (up to ${formatted(r.cap_usd)})`;
    case "per_token":
      return `${formatted(r.per_million_input_tokens_usd)}/M tokens (up to ${formatted(r.cap_usd)})`;
    case "base_plus_per_result":
      return `${formatted(r.base_usd)}/run, +${formatted(r.per_extra_result_usd)} per ${r.unit ?? "result"} (up to ${formatted(r.cap_usd)})`;
  }
}

/** The contract spells every amount once, canonically (2–6 decimals, no
    trailing zeros past the cent), so the string is shown as is: rounding
    "0.012" to "$0.01" would misstate a per-row price by a fifth. The parse is
    kept only to reject a string that is not an amount. */
function formatted(usd: string): string {
  usdToMicros(usd);
  return `$${usd}`;
}
