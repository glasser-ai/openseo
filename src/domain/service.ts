import { inspectEndpoint } from "../glasser/client.js";
import { idempotencyKey } from "../glasser/idempotency.js";
import { maxChargeMicros } from "../glasser/price.js";
import { runFailure } from "../glasser/runFailure.js";
import { dispatch } from "../glasser/runner.js";
import { getHistory, getKey, serialized, unresolvedRequest } from "../ledger/store.js";
import { type PanelEntry, readPanel, readStoredPanel } from "./cache.js";
import { epochFor, forgetEpoch } from "./epoch.js";
import { type KeywordRow, LOOKUPS, type LookupField, type LookupId } from "./lookups.js";
import { persistPanel } from "./persist.js";
import {
  extractTraffic,
  TRAFFIC_ENDPOINT,
  TRAFFIC_PROVIDER,
  type TrafficPanel,
} from "./traffic.js";

/**
 * Website traffic on Similarweb's terms, via apify's
 * `tri_angle/fast-similarweb-scraper`.
 *
 * The Endpoint looks up by domain, so a subdomain resolves on its own and does
 * not have to fall back to its registrable root, and the answer carries global
 * rank, country rank and visitor countries alongside the visit figures.
 *
 * The basis: this section measures **all-channel** visits, and the organic
 * estimate lives under Search.
 */
export { TRAFFIC_ENDPOINT, TRAFFIC_PROVIDER } from "./traffic.js";

/** The request is already running — not a failure. The panel shows a loading
    state and waits for storage to change. */
export type StillRunning = {
  readonly ok: false;
  readonly pending: true;
  readonly reason: string;
};

export type RunResult =
  | StillRunning
  | {
      readonly ok: false;
      readonly reason: string;
      readonly empty: true;
      readonly runUrl: string;
      readonly chargeUsd: string | null;
      readonly cached: boolean;
      readonly fetchedAt: number;
    }
  | {
      readonly ok: true;
      readonly fields: readonly LookupField[];
      readonly keywords?: readonly KeywordRow[];
      readonly runUrl: string;
      readonly chargeUsd: string | null;
      /** This copy came from the cache and cost nothing. */
      readonly cached: boolean;
      readonly fetchedAt: number;
    }
  | { readonly ok: false; readonly reason: string };

export type TrafficResult =
  | StillRunning
  | {
      readonly ok: false;
      readonly reason: string;
      /** The Provider explicitly answered "none" — this is cached, and we know
          what it cost. */
      readonly empty: true;
      readonly runUrl: string;
      readonly chargeUsd: string | null;
      readonly cached: boolean;
      readonly fetchedAt: number;
    }
  | {
      readonly ok: true;
      readonly panel: TrafficPanel;
      readonly runUrl: string;
      readonly chargeUsd: string | null;
      readonly cached: boolean;
      readonly fetchedAt: number;
    }
  | { readonly ok: false; readonly reason: string };

// Hold one queue per report across cache check, inspection and dispatch. Recovery
// can still complete while inspection is in progress, so recheck the cache below.
const reports = new Map<string, Promise<unknown>>();
function coordinate<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = reports.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  reports.set(key, next);
  void next
    .finally(() => {
      if (reports.get(key) === next) reports.delete(key);
    })
    .catch(() => undefined);
  return next;
}

export function runTraffic(domain: string, force = false): Promise<TrafficResult> {
  // The full hostname. Similarweb tracks subdomains separately and this
  // Endpoint resolves them, so there is nothing to gain by asking about the
  // registrable root instead.
  return coordinate(`traffic:${domain}`, () =>
    attemptTraffic(
      {
        provider: TRAFFIC_PROVIDER,
        endpoint: TRAFFIC_ENDPOINT,
        input: { website: domain },
      },
      extractTraffic,
      force,
    ),
  );
}

type Attempt = {
  readonly provider: string;
  readonly endpoint: string;
  readonly input: Record<string, unknown>;
};

/** One traffic lookup: read cache, inspect, dispatch, write cache. Both tiers
    share this path. */
async function attemptTraffic(
  attempt: Attempt,
  extract: (output: unknown) => TrafficPanel | null,
  force: boolean,
): Promise<TrafficResult> {
  const { provider, endpoint, input } = attempt;

  // The cache is used by default: this data moves on **a daily** scale, so
  // re-buying it hourly achieves nothing and costs money.
  if (!force) {
    const cached = await readPanel(endpoint, input);
    if (cached?.payload.kind === "none") {
      return {
        ok: false,
        reason: cached.payload.reason,
        runUrl: cached.runUrl,
        empty: true,
        chargeUsd: cached.chargeUsd,
        cached: true,
        fetchedAt: cached.fetchedAt,
      };
    }
    if (cached?.payload.kind === "traffic") {
      return {
        ok: true,
        panel: cached.payload.panel,
        runUrl: cached.runUrl,
        chargeUsd: cached.chargeUsd,
        cached: true,
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  const key = await getKey();
  if (key === undefined) return { ok: false, reason: "no Key" };
  const detail = await inspectEndpoint(key, provider, endpoint);
  if (detail.kind !== "answered") {
    return { ok: false, reason: detail.kind === "refused" ? detail.message : detail.reason };
  }

  if (!force && (await readPanel(endpoint, input))) return attemptTraffic(attempt, extract, false);
  const epoch = await serialized(async () => {
    if (force) await forgetEpoch(endpoint, input);
    return epochFor(endpoint, input);
  });
  const idemKey = await idempotencyKey({
    provider,
    endpoint,
    endpointVersion: detail.value.endpoint_version,
    body: input,
    epoch,
  });

  let panel: TrafficPanel | null = null;
  let runUrl = "";
  let chargeUsd: string | null = null;

  const result = await dispatch(
    {
      purpose: { kind: "panel" },
      provider,
      endpoint,
      input,
      domains: [domainOf(input)],
      maxChargeMicros: maxChargeMicros(detail.value.price),
      idemKey,
      endpointVersion: detail.value.endpoint_version,
    },
    async (run) => {
      await persistPanel({ provider, endpoint, input }, run);
      panel = extract(run.output);
      runUrl = run.run_url;
      chargeUsd = run.charge_usd;
    },
  );

  if (result.kind !== "settled") {
    // Neither inflight nor running is a failure: the request really is running
    // and the panel should show a loading state. On settlement the recovery path
    // writes the cache, and the panel lights up from the storage change.
    if (result.kind === "inflight" || result.kind === "running") {
      return { ok: false, pending: true, reason: "Fetching" };
    }
    return {
      ok: false,
      reason:
        result.kind === "blocked"
          ? result.reason
          : result.kind === "refused"
            ? result.message
            : result.reason,
    };
  }
  const failure = runFailure(result.run);
  if (failure) return { ok: false, reason: failure };
  if (panel === null) {
    const reason = "this Provider has no data for this domain";
    return {
      ok: false,
      reason,
      empty: true,
      runUrl,
      chargeUsd,
      cached: false,
      fetchedAt: Date.now(),
    };
  }
  return { ok: true, panel, runUrl, chargeUsd, cached: false, fetchedAt: Date.now() };
}

/** The two tiers have different input shapes, but the ledger locks by domain,
    so the domain has to be recoverable from either. */
function domainOf(input: Record<string, unknown>): string {
  const website = input["website"];
  if (typeof website === "string") return website;
  const domains = input["domains"];
  return Array.isArray(domains) && typeof domains[0] === "string" ? domains[0] : "";
}

/** Cache reads only — used when the panel mounts: no request, no charge, and no
    Key needed. */
export async function peekLookup(id: LookupId, domain: string): Promise<PanelEntry | null> {
  const lookup = LOOKUPS.find((item) => item.id === id);
  return lookup ? readStoredPanel(lookup.endpoint, lookup.buildInput(domain)) : null;
}

export const peekTraffic = (domain: string): Promise<PanelEntry | null> =>
  readStoredPanel(TRAFFIC_ENDPOINT, { website: domain });

export function runLookup(id: LookupId, domain: string, force = false): Promise<RunResult> {
  return coordinate(`${id}:${domain}`, () => runLookupOnce(id, domain, force));
}

async function runLookupOnce(id: LookupId, domain: string, force = false): Promise<RunResult> {
  const lookup = LOOKUPS.find((item) => item.id === id);
  if (!lookup) return { ok: false, reason: "unknown lookup" };

  const cacheInput = lookup.buildInput(domain);
  if (!force) {
    const cached = await readPanel(lookup.endpoint, cacheInput);
    if (cached?.payload.kind === "none") {
      return {
        ok: false,
        reason: cached.payload.reason,
        runUrl: cached.runUrl,
        empty: true,
        chargeUsd: cached.chargeUsd,
        cached: true,
        fetchedAt: cached.fetchedAt,
      };
    }
    if (cached?.payload.kind === "fields") {
      return {
        ok: true,
        fields: cached.payload.fields,
        ...(cached.payload.keywords ? { keywords: cached.payload.keywords } : {}),
        runUrl: cached.runUrl,
        chargeUsd: cached.chargeUsd,
        cached: true,
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  const key = await getKey();
  if (key === undefined) return { ok: false, reason: "no Key" };

  const detail = await inspectEndpoint(key, lookup.provider, lookup.endpoint);
  if (detail.kind !== "answered") {
    return { ok: false, reason: detail.kind === "refused" ? detail.message : detail.reason };
  }

  if (!force && (await readPanel(lookup.endpoint, cacheInput)))
    return runLookupOnce(id, domain, false);
  const input = lookup.buildInput(domain);
  const epoch = await serialized(async () => {
    if (force) await forgetEpoch(lookup.endpoint, input);
    return epochFor(lookup.endpoint, input);
  });
  const idemKey = await idempotencyKey({
    provider: lookup.provider,
    endpoint: lookup.endpoint,
    endpointVersion: detail.value.endpoint_version,
    body: input,
    epoch,
  });

  let fields: readonly LookupField[] = [];
  let keywords: readonly KeywordRow[] | undefined;
  let runUrl = "";
  let chargeUsd: string | null = null;

  const result = await dispatch(
    {
      purpose: { kind: "panel" },
      provider: lookup.provider,
      endpoint: lookup.endpoint,
      input,
      domains: [domain],
      maxChargeMicros: maxChargeMicros(detail.value.price),
      idemKey,
      endpointVersion: detail.value.endpoint_version,
    },
    // The result is persisted before the pending record is deleted — runner
    // guarantees that order, and this only supplies the contents.
    async (run) => {
      await persistPanel({ provider: lookup.provider, endpoint: lookup.endpoint, input }, run);
      fields = lookup.extract(run.output);
      keywords = lookup.extractKeywords?.(run.output);
      runUrl = run.run_url;
      chargeUsd = run.charge_usd;
    },
  );

  if (result.kind !== "settled") {
    // Neither inflight nor running is a failure: the request really is running
    // and the panel should show a loading state. On settlement the recovery path
    // writes the cache, and the panel lights up from the storage change.
    if (result.kind === "inflight" || result.kind === "running") {
      return { ok: false, pending: true, reason: "Fetching" };
    }
    return {
      ok: false,
      reason:
        result.kind === "blocked"
          ? result.reason
          : result.kind === "refused"
            ? result.message
            : result.reason,
    };
  }
  const failure = runFailure(result.run);
  if (failure) return { ok: false, reason: failure };
  if (fields.length === 0) {
    // Several Endpoints price their NO_RESULT clause the same as a success — not
    // caching it means paying in full again on every click.
    const reason = "this Provider has no data for this domain";
    return {
      ok: false,
      reason,
      empty: true,
      runUrl,
      chargeUsd,
      cached: false,
      fetchedAt: Date.now(),
    };
  }
  return {
    ok: true,
    fields,
    ...(keywords ? { keywords } : {}),
    runUrl,
    chargeUsd,
    cached: false,
    fetchedAt: Date.now(),
  };
}

export type ReportState = {
  entry: PanelEntry | null;
  state: "idle" | "running" | "failed";
  error: string | null;
};

/** A consistent local snapshot; no API request and no purchase. */
export function readReportState(id: LookupId | "traffic", domain: string): Promise<ReportState> {
  return serialized(async () => {
    const lookup = LOOKUPS.find((item) => item.id === id);
    const provider = id === "traffic" ? TRAFFIC_PROVIDER : lookup?.provider;
    const endpoint = id === "traffic" ? TRAFFIC_ENDPOINT : lookup?.endpoint;
    const input = id === "traffic" ? { website: domain } : lookup?.buildInput(domain);
    if (!provider || !endpoint) throw new Error("Unknown report");
    const entry = await readStoredPanel(endpoint, input);
    const pending = await unresolvedRequest(provider, endpoint, input);
    if (pending)
      return {
        entry,
        state: pending.state === "in-flight" ? "running" : "failed",
        error:
          pending.state === "suspended"
            ? `${pending.reason ?? "Request suspended"}. Check Activity in Settings.`
            : null,
      };
    const last = (await getHistory()).find(
      (row) =>
        row.provider === provider && row.endpoint === endpoint && row.domains?.includes(domain),
    );
    const error = last?.failure && (!entry || last.at >= entry.fetchedAt) ? last.failure : null;
    return { entry, state: error ? "failed" : "idle", error };
  });
}
