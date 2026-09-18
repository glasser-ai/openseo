import { decodeMicros, encodeMicros, usdToMicros } from "../ledger/micros.js";
import {
  allPending,
  dropPending,
  fingerprint,
  getKey,
  type PendingRecord,
  type Purpose,
  putPending,
  reserve,
  serialized,
  settleCharge,
  suspendPending,
  unresolvedRequest,
} from "../ledger/store.js";
import { createRun, getRun, type Outcome } from "./client.js";
import { runFailure } from "./runFailure.js";
import { isTerminal, type Run } from "./schema.js";

// Older versions suspended slow requests for this reason. They can safely resume
// with the original Key and request identity; other suspensions still need attention.
const LEGACY_POLL_TIMEOUT = "unresolved after repeated attempts";
const canRecover = (record: PendingRecord): boolean =>
  record.state === "in-flight" || record.reason === LEGACY_POLL_TIMEOUT;

export type DispatchInput = {
  readonly purpose?: Extract<Purpose, { kind: "panel" }>;
  readonly provider: string;
  readonly endpoint: string;
  readonly input: unknown;
  readonly domains: readonly string[];
  readonly maxChargeMicros: bigint;
  readonly idemKey: string;
  readonly endpointVersion?: number;
};

export type DispatchResult =
  | { readonly kind: "settled"; readonly run: Run }
  | { readonly kind: "running"; readonly runId: string }
  | { readonly kind: "refused"; readonly code: string; readonly message: string }
  | { readonly kind: "blocked"; readonly reason: string }
  /** The same question already has a pending record in flight — wait for it
      rather than sending again. */
  | { readonly kind: "inflight" }
  | { readonly kind: "uncertain"; readonly reason: string };

export async function dispatch(
  request: DispatchInput,
  persistResult?: (run: Run) => Promise<void>,
): Promise<DispatchResult> {
  const key = await getKey();
  if (key === undefined) return { kind: "blocked", reason: "no Key" };
  const print = await fingerprint(key);

  // The headroom check, the reservation and the pending record all happen inside
  // one serial section, with nothing else awaited in between — otherwise two
  // requests each read the same remaining headroom.
  const admitted = await serialized(async () => {
    if ((await getKey()) !== key) return { ok: false as const, reason: "Key changed. Try again." };

    // Reports for different endpoints are independent; identical pending requests share a Run.
    const open = await unresolvedRequest(request.provider, request.endpoint, request.input);
    if (open !== null) {
      return open.state === "suspended"
        ? { ok: false as const, reason: "An earlier request for this never finished." }
        : { ok: false as const, inflight: true as const, reason: "already running" };
    }
    if (!(await reserve(request.maxChargeMicros))) {
      return {
        ok: false as const,
        reason: "Estimated budget reached. Check estimated budgets in Settings.",
      };
    }
    // dispatchedAt is persisted **before** the fetch: otherwise a worker killed
    // after admission but before the marker is written would, on recovery, treat
    // a replay as a first dispatch — and a 4xx on a first dispatch releases the
    // reservation.
    await putPending({
      idemKey: request.idemKey,
      ...(request.purpose === undefined ? {} : { purpose: request.purpose }),
      provider: request.provider,
      endpoint: request.endpoint,
      ...(request.endpointVersion === undefined
        ? {}
        : { endpointVersion: request.endpointVersion }),
      input: request.input,
      domains: [...request.domains],
      keyFingerprint: print,
      reservedMicros: encodeMicros(request.maxChargeMicros),
      dispatchedAt: Date.now(),
      attempts: 1,
      state: "in-flight",
    });
    return { ok: true as const };
  });

  if (!admitted.ok) {
    return "inflight" in admitted
      ? { kind: "inflight" }
      : { kind: "blocked", reason: admitted.reason };
  }

  const outcome = await createRun(key, request.idemKey, {
    provider: request.provider,
    endpoint: request.endpoint,
    input: request.input,
    ...(request.endpointVersion === undefined ? {} : { endpoint_version: request.endpointVersion }),
  });

  // This is a first dispatch and we are **still alive** — only then does a
  // refusal mean there is no Run.
  return resolve(outcome, request.idemKey, request.maxChargeMicros, true, persistResult);
}

async function resolve(
  outcome: Outcome<Run>,
  idemKey: string,
  reserved: bigint,
  firstDispatchInMemory: boolean,
  /** Persists the result (writes the cache). Must complete **before** the
      pending record is deleted — see settle. */
  persistResult?: (run: Run) => Promise<void>,
): Promise<DispatchResult> {
  if (outcome.kind === "uncertain") {
    return { kind: "uncertain", reason: outcome.reason };
  }

  if (outcome.kind === "refused") {
    if (!firstDispatchInMemory) {
      // On the replay path, endpoint_not_permitted may mean the policy narrowed
      // **after** admission, and a 404 from getRun may mean "exists but not
      // readable". Neither proves there is no Run.
      await serialized(() => suspendPending(idemKey, `${outcome.code}: ${outcome.message}`));
      return { kind: "refused", code: outcome.code, message: outcome.message };
    }
    // On a first dispatch these refusals all happen before admitRun, so there
    // is no Run and the reservation and the domain lock are both released.
    await serialized(async () => {
      await dropPending(idemKey);
    });
    return { kind: "refused", code: outcome.code, message: outcome.message };
  }

  const run = outcome.value;
  if (!isTerminal(run)) {
    // Still running: record the runId, so the next recovery calls getRun rather
    // than POSTing again.
    await serialized(async () => {
      const existing = (await allPending()).find((item) => item.idemKey === idemKey);
      if (existing) await putPending({ ...existing, runId: run.id, runUrl: run.run_url });
    });
    return { kind: "running", runId: run.id };
  }
  await settle(idemKey, run, reserved, persistResult);
  return { kind: "settled", run };
}

/**
 * Settlement order — the pending record is deleted **last**.
 *
 * It doubles as the lock saying "start no new Run for these domains", so
 * deleting it before the result is persisted makes the next visit mint a new
 * epoch and pay again. Being killed part-way is harmless: the record is still
 * there, and a replay fetches the same Run.
 */
async function settle(
  idemKey: string,
  run: Run,
  reserved: bigint,
  persistResult?: (run: Run) => Promise<void>,
): Promise<void> {
  // Parsing **outside** the serial section would let one unexpectedly formatted
  // amount trap the whole record in a replay loop.
  let charged = reserved;
  try {
    charged = run.charge_usd === null ? reserved : usdToMicros(run.charge_usd);
  } catch {
    charged = reserved;
  }
  await serialized(async () => {
    const pending = (await allPending()).find((record) => record.idemKey === idemKey);
    await settleCharge(idemKey, {
      ...(pending ? { domains: pending.domains } : {}),
      chargeReported: run.charge_usd !== null,
      ...(runFailure(run) ? { failure: runFailure(run)! } : {}),
      runId: run.id,
      runUrl: run.run_url,
      provider: run.provider,
      endpoint: run.endpoint,
      chargeMicros: encodeMicros(charged),
      at: Date.now(),
    });
    // 3. Write the cache — must complete before the record is deleted. Killed
    //    part-way: the record remains and a replay fetches the same Run.
    if (persistResult) await persistResult(run);
    // 4. Delete last. It doubles as the "no new Run for these domains" lock.
    await dropPending(idemKey);
  });
}

/**
 * Recovery, at startup and on the alarm.
 *
 * Every record read back from storage is **treated as a replay** — the record
 * existing means "may already have been admitted" — so no path here releases a
 * reservation on the strength of a 4xx.
 */
export async function recover(onSettled?: (record: PendingRecord, run: Run) => Promise<void>) {
  const key = await getKey();
  if (key === undefined) return;
  const print = await fingerprint(key);

  for (const record of await allPending()) {
    if (!canRecover(record)) continue;

    // The Key changed: idempotency bindings are scoped to a Workspace and /v1
    // has no whoami, so there is no way to tell whether it is the same one.
    // Everything is suspended — replaying into a different Workspace would
    // create **a second** billable Run.
    if (record.keyFingerprint !== print) {
      await serialized(() => suspendPending(record.idemKey, "the Key changed"));
      continue;
    }

    // A local timeout cannot prove that a paid Run has stopped. Keep checking the
    // same request on the existing panel timer/background alarm until it settles.
    const current = await serialized(async () => {
      const latest = (await allPending()).find((item) => item.idemKey === record.idemKey);
      if (!latest || !canRecover(latest)) return null;
      if ((await getKey()) !== key || latest.keyFingerprint !== print) return null;
      const next = { ...latest, state: "in-flight" as const, attempts: latest.attempts + 1 };
      delete next.reason;
      await putPending(next);
      return next;
    });
    if (!current) continue;
    const reserved = decodeMicros(current.reservedMicros);
    const outcome =
      current.runId === undefined
        ? await createRun(key, current.idemKey, {
            provider: current.provider,
            endpoint: current.endpoint,
            input: current.input,
            ...(current.endpointVersion === undefined
              ? {}
              : { endpoint_version: current.endpointVersion }),
          })
        : await getRun(key, current.runId);

    const result = await resolve(outcome, current.idemKey, reserved, false, (run) =>
      onSettled ? onSettled(current, run) : Promise.resolve(),
    );
    void result;
  }
}
