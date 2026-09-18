/**
 * The single internal representation for money: integer micro-USD as a `bigint`
 * ($0.30 is 300_000n).
 *
 * There is no published package to take this from, so the rules are
 * implemented here, with both boundary disciplines they require:
 *
 * 1. Never do floating-point arithmetic on money. `Number("0.07") * 1e6` is
 *    70000.00000000001, and accumulated it leaves a remainder on the books that
 *    can never be reconciled. The contract supplies **exact decimal strings**, so
 *    they are parsed to integers as strings, touching no float at any point.
 * 2. JSON has no bigint. chrome.storage.local accepts only JSON-serialisable
 *    values and throws on a bigint written directly — that is the guard rail
 *    working. Everything crossing storage goes through encode/decode.
 */
export type Micros = bigint;

export const MICROS_PER_USD = 1_000_000n;

const USD_PATTERN = /^(-?)(\d+)(?:\.(\d{1,6}))?$/;
const MICROS_PATTERN = /^-?\d+$/;

/** An exact decimal USD string from the contract to Micros. Parsed as integers,
    never through Number. */
export function usdToMicros(usd: string): Micros {
  const match = USD_PATTERN.exec(usd.trim());
  if (!match) {
    throw new TypeError(`Not an exact USD amount: ${JSON.stringify(usd)}`);
  }
  const [, sign, whole, fraction = ""] = match;
  const scaled = `${whole}${fraction.padEnd(6, "0")}`;
  const magnitude = BigInt(scaled);
  return sign === "-" ? -magnitude : magnitude;
}

/** Micros to a decimal USD string for display. Called only at the moment of
    rendering. */
export function microsToUsd(micros: Micros): string {
  const negative = micros < 0n;
  const magnitude = negative ? -micros : micros;
  const whole = magnitude / MICROS_PER_USD;
  const fraction = (magnitude % MICROS_PER_USD).toString().padStart(6, "0").replace(/0+$/, "");
  const body = fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${body}` : body;
}

/**
 * Money formatted for people, **exactly**, to at least two decimal places:
 * $0.30, $1.25, $0.024, $0.0005.
 *
 * Anything over a cent used to go through `micros / 10_000n` and then divide by
 * 100 — and bigint division truncates, so $0.024 printed as $0.02, a fifth less.
 * Money cannot be cut that way: what was charged is what is written, padded to
 * two places and losing not one significant digit beyond them.
 */
export function formatUsd(micros: Micros): string {
  const negative = micros < 0n;
  const magnitude = negative ? -micros : micros;
  const [whole = "0", fraction = ""] = microsToUsd(magnitude).split(".");
  const padded = fraction.length < 2 ? fraction.padEnd(2, "0") : fraction;
  return `${negative ? "-" : ""}$${whole}.${padded}`;
}

/** Micros to its stored form, a decimal integer string. */
export function encodeMicros(micros: Micros): string {
  return micros.toString();
}

/**
 * The stored form back to Micros. Throws on the wrong shape and **never**
 * silently falls back to 0 — a reservation read as 0 is no reservation, and with
 * no reservation the cap is overshot.
 */
export function decodeMicros(stored: unknown): Micros {
  if (typeof stored !== "string" || !MICROS_PATTERN.test(stored)) {
    throw new TypeError(`Corrupt stored micros amount: ${JSON.stringify(stored)}`);
  }
  return BigInt(stored);
}

export function maxMicros(values: readonly Micros[]): Micros {
  if (values.length === 0) throw new TypeError("maxMicros needs at least one value");
  return values.reduce((a, b) => (b > a ? b : a));
}
