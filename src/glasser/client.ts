import {
  type BalanceResponse,
  decodeBalance,
  decodeEndpointDetail,
  decodeErrorEnvelope,
  decodeRun,
  type EndpointDetail,
  type Run,
} from "./schema.js";

export const API_BASE = "https://api.glasser.ai";

/**
 * Call outcomes are split into three, because **they mean entirely different
 * things for money**:
 *
 * - refused: the server refused explicitly, and did so **before** a Run was
 *   created — there is no Run and nothing is charged.
 * - answered: a response body came back.
 * - uncertain: a network error, a killed worker, a 5xx — whether it was admitted
 *   is unknown. Only this class may be replayed.
 *
 * Note that refused means "there is no Run" only on **a first dispatch**. On the
 * replay path the same status code means the opposite (the policy narrowed after
 * admission), so this only reports the facts and leaves the judgement to the
 * ledger.
 */
export type Outcome<T> =
  | { readonly kind: "answered"; readonly value: T; readonly requestId: string | null }
  | {
      readonly kind: "refused";
      readonly code: string;
      readonly message: string;
      readonly retryAfterMs: number | null;
      readonly status: number;
      readonly requestId: string | null;
    }
  | { readonly kind: "uncertain"; readonly reason: string; readonly requestId: string | null };

type Request = {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly key: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
};

async function call<T>(request: Request, decode: (raw: unknown) => T): Promise<Outcome<T>> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${request.key}`,
    accept: "application/json",
  };
  if (request.body !== undefined) headers["content-type"] = "application/json";
  // Required on runs-create; replaying the same key returns the same Run and is
  // not charged twice.
  if (request.idempotencyKey !== undefined) headers["idempotency-key"] = request.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${request.path}`, {
      method: request.method,
      headers,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
  } catch (error) {
    return {
      kind: "uncertain",
      reason: error instanceof Error ? error.message : String(error),
      requestId: null,
    };
  }

  // Present on every response, and surfaced to the user on failure — support can
  // find the Run from it.
  const requestId = response.headers.get("x-request-id");

  if (response.ok) {
    try {
      return { kind: "answered", value: decode(await response.json()), requestId };
    } catch (error) {
      // A decode failure usually means the contract moved ahead of us — not that
      // nothing ran, so it counts as uncertain.
      return {
        kind: "uncertain",
        reason: `could not decode the response: ${error instanceof Error ? error.message : String(error)}`,
        requestId,
      };
    }
  }

  // A 5xx or a 408 is "unknown", not "refused".
  if (response.status >= 500 || response.status === 408) {
    return { kind: "uncertain", reason: `server returned ${response.status}`, requestId };
  }

  try {
    const envelope = decodeErrorEnvelope(await response.json());
    return {
      kind: "refused",
      code: envelope.error.code,
      message: envelope.error.message,
      retryAfterMs: envelope.error.retry_after_ms ?? null,
      status: response.status,
      requestId,
    };
  } catch {
    return { kind: "uncertain", reason: `unreadable ${response.status} response`, requestId };
  }
}

export const getBalance = (key: string): Promise<Outcome<BalanceResponse>> =>
  call({ path: "/v1/balance", method: "GET", key }, decodeBalance);

export const inspectEndpoint = (
  key: string,
  provider: string,
  endpoint: string,
): Promise<Outcome<EndpointDetail>> =>
  call(
    { path: "/v1/endpoints/inspect", method: "POST", key, body: { provider, endpoint } },
    decodeEndpointDetail,
  );

export const createRun = (
  key: string,
  idempotencyKey: string,
  body: { provider: string; endpoint: string; input: unknown; endpoint_version?: number },
  signal?: AbortSignal,
): Promise<Outcome<Run>> =>
  call(
    { path: "/v1/runs", method: "POST", key, body, idempotencyKey, ...(signal ? { signal } : {}) },
    decodeRun,
  );

export const getRun = (key: string, runId: string): Promise<Outcome<Run>> =>
  call({ path: `/v1/runs/${encodeURIComponent(runId)}`, method: "GET", key }, decodeRun);

/** /health is public and needs no Key. Used to check whether the contract we
    shipped with is still the one in production. */
export async function getDeployedContractHash(): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    if (!response.ok) return null;
    const body = (await response.json()) as { contract?: unknown };
    return typeof body.contract === "string" ? body.contract : null;
  } catch {
    return null;
  }
}
