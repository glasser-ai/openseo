import { Schema } from "effect";

/**
 * Decoders for the `/v1` responses.
 *
 * Hand-written against the published contract in vendor/openapi.json, there
 * being no decoder package to depend on. effect is pinned to the version that
 * contract targets, so these definitions can be read line by line against it.
 */

const UsdAmount = Schema.String;

export const PriceRule = Schema.Union([
  Schema.Struct({ type: Schema.Literal("flat"), amount_usd: UsdAmount }),
  Schema.Struct({
    type: Schema.Literal("per_result"),
    per_result_usd: UsdAmount,
    cap_usd: UsdAmount,
    partial_usd: Schema.optionalKey(UsdAmount),
  }),
]);

export const PriceCharges = Schema.Struct({
  NO_RESULT: UsdAmount,
  PROVIDER_ERROR: UsdAmount,
  TIMED_OUT: UsdAmount,
  INTERNAL: UsdAmount,
});

export const Price = Schema.Struct({ rule: PriceRule, charges: PriceCharges });

export const RunStatus = Schema.Literals(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "STOPPED"]);

export const Run = Schema.Struct({
  id: Schema.String,
  run_url: Schema.String,
  provider: Schema.String,
  endpoint: Schema.String,
  endpoint_version: Schema.Int,
  status: RunStatus,
  failure: Schema.NullOr(
    Schema.Struct({ kind: Schema.Literals(["TIMED_OUT", "INTERNAL"]), message: Schema.String }),
  ),
  output: Schema.Unknown,
  /** null while unsettled, not "0.00" — the two mean different things and must
      not be merged. */
  charge_usd: Schema.NullOr(UsdAmount),
  charge_basis: Schema.NullOr(
    Schema.Struct({
      clause: Schema.Literals(["rule", "NO_RESULT", "PROVIDER_ERROR", "TIMED_OUT", "INTERNAL"]),
      quantity: Schema.NullOr(Schema.Int),
    }),
  ),
  stoppable: Schema.Boolean,
  created_at: Schema.String,
  completed_at: Schema.NullOr(Schema.String),
});
export type Run = typeof Run.Type;

export const BalanceResponse = Schema.Struct({
  balance_usd: UsdAmount,
  held_usd: UsdAmount,
  available_usd: UsdAmount,
});
export type BalanceResponse = typeof BalanceResponse.Type;

export const EndpointDetail = Schema.Struct({
  provider: Schema.String,
  endpoint: Schema.String,
  endpoint_version: Schema.Int,
  name: Schema.String,
  description: Schema.String,
  run_mode: Schema.Literals(["sync", "async"]),
  /** Present on sync only — an async endpoint's immediate response has no
      figure that could bound it. */
  timeout_ms: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  price: Price,
  input_schema: Schema.Unknown,
});
export type EndpointDetail = typeof EndpointDetail.Type;

/** The envelope shared by every error. A 429's wait is in `retry_after_ms`,
 **not in a response header**. */
export const ErrorEnvelope = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
    reason: Schema.optional(Schema.NullOr(Schema.String)),
    control: Schema.optional(Schema.NullOr(Schema.String)),
    retry_after_ms: Schema.optional(Schema.NullOr(Schema.Int)),
    details: Schema.optional(Schema.NullOr(Schema.Unknown)),
  }),
});

export const decodeRun = Schema.decodeUnknownSync(Run);
export const decodeBalance = Schema.decodeUnknownSync(BalanceResponse);
export const decodeEndpointDetail = Schema.decodeUnknownSync(EndpointDetail);
export const decodeErrorEnvelope = Schema.decodeUnknownSync(ErrorEnvelope);

export const isTerminal = (run: Run): boolean =>
  run.status === "COMPLETED" || run.status === "FAILED" || run.status === "STOPPED";
