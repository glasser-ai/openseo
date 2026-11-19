import { inspectEndpoint } from "../glasser/client.js";
import { idempotencyKey, timeoutRetryKey } from "../glasser/idempotency.js";
import { maxChargeMicros, typicalMicros, unsupportedRule } from "../glasser/price.js";
import { runFailure } from "../glasser/runFailure.js";
import { dispatch } from "../glasser/runner.js";
import { usdToMicros } from "../ledger/micros.js";
import {
  dropRetryIntent,
  fingerprint,
  getHistory,
  getKey,
  type PendingRecord,
  retryIntentFor,
  serialized,
  unresolvedRequest,
} from "../ledger/store.js";
import { type PanelEntry, readPanel, readStoredPanel } from "./cache.js";
import { epochFor, forgetEpoch } from "./epoch.js";
import {
  type KeywordRow,
  LOOKUPS,
  type LookupField,
  type LookupId,
  type RankedRow,
  type SeriesPoint,
} from "./lookups.js";
import { marketOf } from "./markets.js";
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
      readonly series?: readonly SeriesPoint[];
      readonly ranked?: readonly RankedRow[];
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
  rememberPrice(endpoint, detail.value.price);

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

  // Refused here, before any Run, because reserving a guessed ceiling is the
  // under-reserve bug: the spend would overshoot the cap the user set.
  const ceiling = maxChargeMicros(detail.value.price);
  if (ceiling === null) return { ok: false, reason: unsupportedRule(detail.value.price) };

  let panel: TrafficPanel | null = null;
  let runUrl = "";
  let chargeUsd: string | null = null;

  const result = await dispatch(
    {
      purpose: { kind: "panel" },
      key,
      typicalMicros: typicalMicros(detail.value.price),
      provider,
      endpoint,
      input,
      domains: [domainOf(input)],
      maxChargeMicros: ceiling,
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
export async function peekLookup(
  id: LookupId,
  domain: string,
  market?: string,
): Promise<PanelEntry | null> {
  const lookup = LOOKUPS.find((item) => item.id === id);
  return lookup
    ? readStoredPanel(lookup.endpoint, lookup.buildInput(domain, marketOf(market)))
    : null;
}

export const peekTraffic = (domain: string): Promise<PanelEntry | null> =>
  readStoredPanel(TRAFFIC_ENDPOINT, { website: domain });

/** market is a Market id; only lookups with byMarket read it. */
export function runLookup(
  id: LookupId,
  domain: string,
  force = false,
  market?: string,
  automatic?: Automatic,
): Promise<RunResult> {
  const chosen = marketOf(market);
  return coordinate(`${id}:${domain}:${chosen.id}`, () =>
    runLookupOnce(id, domain, force, chosen.id, automatic === undefined ? {} : { automatic }),
  );
}

/** A lookup the toolbar badge started for a tab, not a click. */
export type Automatic = {
  readonly tabId: number;
  /** See DispatchInput.admit. Asked again before the retry after a timeout;
      retry tells it that a refusal ends the lookup for good. */
  readonly admit: (attempt: { readonly retry: boolean }) => Promise<string | null>;
};

type Attempted = {
  /** Set on the one retry after a timeout: the Key the first Run used. */
  readonly retryKey?: string;
  /** Set on the one retry after a timeout: the first request's idempotency key. */
  readonly retryOf?: string;
  /** Set on the one retry after a timeout: when the first request was sent. */
  readonly firstSentAt?: number;
  readonly automatic?: Automatic;
};

async function runLookupOnce(
  id: LookupId,
  domain: string,
  force: boolean,
  market: string,
  attempted: Attempted = {},
): Promise<RunResult> {
  const { retryKey, automatic } = attempted;
  const lookup = LOOKUPS.find((item) => item.id === id);
  if (!lookup) return { ok: false, reason: "unknown lookup" };

  const cacheInput = lookup.buildInput(domain, marketOf(market));
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
        ...(cached.payload.series ? { series: cached.payload.series } : {}),
        ...(cached.payload.ranked ? { ranked: cached.payload.ranked } : {}),
        runUrl: cached.runUrl,
        chargeUsd: cached.chargeUsd,
        cached: true,
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  const key = await getKey();
  if (key === undefined) return { ok: false, reason: "no Key" };
  // A Key replaced while the first Run was out belongs to another Workspace;
  // the retry is not that Workspace's purchase.
  if (retryKey !== undefined && key !== retryKey) return { ok: false, reason: KEY_CHANGED };

  const detail = await inspectEndpoint(key, lookup.provider, lookup.endpoint);
  if (detail.kind !== "answered") {
    return { ok: false, reason: detail.kind === "refused" ? detail.message : detail.reason };
  }
  rememberPrice(lookup.endpoint, detail.value.price);

  if (!force && (await readPanel(lookup.endpoint, cacheInput)))
    return runLookupOnce(id, domain, false, market, attempted);
  const input = lookup.buildInput(domain, marketOf(market));
  // The retry's identity comes from the first request, so recovery and this
  // path name the same retry (see timeoutRetryKey).
  const idemKey =
    attempted.retryOf !== undefined
      ? await timeoutRetryKey(attempted.retryOf)
      : await idempotencyKey({
          provider: lookup.provider,
          endpoint: lookup.endpoint,
          endpointVersion: detail.value.endpoint_version,
          body: input,
          epoch: await serialized(async () => {
            if (force) await forgetEpoch(lookup.endpoint, input);
            return epochFor(lookup.endpoint, input);
          }),
        });

  const ceiling = maxChargeMicros(detail.value.price);
  if (ceiling === null) return { ok: false, reason: unsupportedRule(detail.value.price) };

  let fields: readonly LookupField[] = [];
  let keywords: readonly KeywordRow[] | undefined;
  let series: readonly SeriesPoint[] | undefined;
  let ranked: readonly RankedRow[] | undefined;
  let runUrl = "";
  let chargeUsd: string | null = null;

  const firstSentAt = Date.now();
  const result = await dispatch(
    {
      purpose: { kind: "panel" },
      key,
      ...(automatic === undefined ? {} : { automatic: { tabId: automatic.tabId } }),
      ...((automatic !== undefined || attempted.firstSentAt !== undefined) && {
        admit: async () =>
          (attempted.firstSentAt !== undefined &&
            (await savedSince(lookup.endpoint, input, attempted.firstSentAt))) ||
          (automatic ? automatic.admit({ retry: retryKey !== undefined }) : null),
      }),
      ...(retryKey === undefined ? {} : { timeoutRetry: true }),
      typicalMicros: typicalMicros(detail.value.price),
      provider: lookup.provider,
      endpoint: lookup.endpoint,
      input,
      domains: [domain],
      maxChargeMicros: ceiling,
      idemKey,
      endpointVersion: detail.value.endpoint_version,
    },
    // The result is persisted before the pending record is deleted — runner
    // guarantees that order, and this only supplies the contents.
    async (run) => {
      await persistPanel({ provider: lookup.provider, endpoint: lookup.endpoint, input }, run);
      fields = lookup.extract(run.output);
      keywords = lookup.extractKeywords?.(run.output);
      series = lookup.extractSeries?.(run.output);
      ranked = lookup.extractRanked?.(run.output);
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
    // The retry found the answer already saved, by recovery's retry or a click.
    if (result.kind === "blocked" && result.reason === ALREADY_SAVED)
      return runLookupOnce(id, domain, false, market);
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
  /*
   * One quiet retry after a Provider timeout.
   *
   * Measured 2026-11-18 on ranked_keywords for wikipedia.org: a cold query hit
   * the 20s limit (TIMED_OUT, charged $0.00), and the same query two seconds
   * later completed in 2s from the Provider's cache.
   *
   * The contract lets a Provider charge for a timeout, so the retry runs only
   * when this Run settled at exactly $0, and only with the same Key.
   */
  if (
    retryKey === undefined &&
    result.run.status === "FAILED" &&
    result.run.failure?.kind === "TIMED_OUT" &&
    chargedNothing(result.run.charge_usd)
  ) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_TIMEOUT_MS));
    // force gives the retry a new idempotency key; the failed one would only
    // return the same failed Run.
    return runLookupOnce(id, domain, true, market, {
      ...attempted,
      retryKey: key,
      retryOf: idemKey,
      firstSentAt,
    });
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
    ...(series?.length ? { series } : {}),
    ...(ranked ? { ranked } : {}),
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
export function readReportState(
  id: LookupId | "traffic",
  domain: string,
  market?: string,
): Promise<ReportState> {
  return serialized(async () => {
    const lookup = LOOKUPS.find((item) => item.id === id);
    const provider = id === "traffic" ? TRAFFIC_PROVIDER : lookup?.provider;
    const endpoint = id === "traffic" ? TRAFFIC_ENDPOINT : lookup?.endpoint;
    const input =
      id === "traffic" ? { website: domain } : lookup?.buildInput(domain, marketOf(market));
    if (!provider || !endpoint) throw new Error("Unknown report");
    const entry = await readStoredPanel(endpoint, input);
    const pending = await unresolvedRequest(provider, endpoint, input);
    // Between a timeout and its retry's own pending record.
    if (!pending && (await retryIntentFor(provider, endpoint, input)))
      return { entry, state: "running", error: null };
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

/** The site and page a panel shows, to find the requests it is waiting on. */
export type PriceSubject = {
  readonly domain: string;
  readonly page: string;
  readonly market?: string;
};

/** One report's price in micros, as decimal strings: what it usually costs, when
    the rule has such a figure, and the most it can cost. */
export type ReportPrice = { readonly typical: string | null; readonly max: string };

/**
 * Each report's price, keyed by report id. Read from inspect, which is free and
 * reports the price a Run will actually use, so the loading state can name the
 * cost before it is spent. A report whose price cannot be read is left out
 * rather than guessed.
 */
export async function priceCeilings(
  ids: readonly string[],
  subject?: PriceSubject,
): Promise<Record<string, ReportPrice>> {
  const key = await getKey();
  if (key === undefined) return {};
  const entries = await Promise.all(
    ids.map(async (id): Promise<[string, ReportPrice] | null> => {
      const lookup = LOOKUPS.find((item) => item.id === id);
      const target =
        id === "traffic"
          ? { provider: TRAFFIC_PROVIDER, endpoint: TRAFFIC_ENDPOINT }
          : lookup
            ? { provider: lookup.provider, endpoint: lookup.endpoint }
            : null;
      if (!target) return null;
      // A running request shows the price it was admitted with. The memo is
      // per endpoint, so another tab's later Run could otherwise change it.
      if (subject) {
        const about = lookup?.subject === "page" ? subject.page : subject.domain;
        const input =
          id === "traffic"
            ? { website: subject.domain }
            : about && lookup
              ? lookup.buildInput(about, marketOf(subject.market))
              : null;
        const open =
          input === null ? null : await unresolvedRequest(target.provider, target.endpoint, input);
        if (open?.estimate) return [id, open.estimate];
      }
      const cached = priceMemo.get(target.endpoint);
      if (cached && Date.now() - cached.at < PRICE_MEMO_MS) return [id, cached.price];
      const detail = await inspectEndpoint(key, target.provider, target.endpoint);
      if (detail.kind !== "answered") return null;
      rememberPrice(target.endpoint, detail.value.price);
      const remembered = priceMemo.get(target.endpoint);
      return remembered ? [id, remembered.price] : null;
    }),
  );
  return Object.fromEntries(
    entries.filter((entry): entry is [string, ReportPrice] => entry !== null),
  );
}

const RETRY_AFTER_TIMEOUT_MS = 2_000;
const KEY_CHANGED = "Key changed. Try again.";

/** A settled charge of exactly $0. An unknown or unreadable charge is not. */
function chargedNothing(charge: string | null): boolean {
  if (charge === null) return false;
  try {
    return usdToMicros(charge) === 0n;
  } catch {
    return false;
  }
}

/** Every inspection a Run uses replaces the memo, so the loading price shown
    for a running lookup is the price that Run was admitted with. */
function rememberPrice(endpoint: string, rule: Parameters<typeof maxChargeMicros>[0]): void {
  const ceiling = maxChargeMicros(rule);
  // An old estimate for a rule that has since changed is worse than none.
  if (ceiling === null) {
    priceMemo.delete(endpoint);
    return;
  }
  const typical = typicalMicros(rule);
  priceMemo.set(endpoint, {
    price: { typical: typical === null ? null : typical.toString(), max: ceiling.toString() },
    at: Date.now(),
  });
}

/** Prices change rarely; ten minutes keeps a section switch from re-asking. */
const PRICE_MEMO_MS = 10 * 60_000;
const priceMemo = new Map<string, { price: ReportPrice; at: number }>();

/** Retries this worker is working on, so a recovery pass that finds their
    stored intent again does not start a second one. */
const retrying = new Set<string>();

const ALREADY_SAVED = "A newer result is already saved.";

/** A result for this question saved at or after `since`, as a veto. A retry
    checks it right before its reservation: a click or the other retry path
    may have bought the answer in the meantime. */
async function savedSince(endpoint: string, input: unknown, since: number): Promise<string | null> {
  const entry = await readStoredPanel(endpoint, input);
  return entry && entry.fetchedAt >= since ? ALREADY_SAVED : null;
}

/**
 * The one retry for a zero-charge timeout that recovery found, because the
 * original response was lost. The same rule and the same path as the live
 * retry in runLookupOnce: the same Key, a fresh price check, the budgets, the
 * caller's admission check right before the first send, first-dispatch
 * handling of a refusal, and the shared retry identity.
 *
 * The runner stored a retry intent in place of the pending request, which
 * keeps the report locked and survives a restart. This drops it when the
 * retry has its own pending request or ends without one; the ledger write
 * wakes the panel and the badge.
 *
 * Synchronous on purpose (see OnTimedOut): it schedules the work, which waits
 * for the settlement section to finish.
 */
export function retryRecoveredTimeout(
  record: PendingRecord,
  admit?: () => Promise<string | null>,
): void {
  if (retrying.has(record.idemKey)) return;
  retrying.add(record.idemKey);
  void (async () => {
    try {
      const lookup = LOOKUPS.find(
        (item) => item.provider === record.provider && item.endpoint === record.endpoint,
      );
      // Traffic has no live retry, so it gets none here either.
      if (!lookup) return;
      const key = await getKey();
      if (key === undefined || (await fingerprint(key)) !== record.keyFingerprint) return;
      const detail = await inspectEndpoint(key, lookup.provider, lookup.endpoint);
      if (detail.kind !== "answered") return;
      rememberPrice(lookup.endpoint, detail.value.price);
      const ceiling = maxChargeMicros(detail.value.price);
      if (ceiling === null) return;
      await dispatch(
        {
          purpose: { kind: "panel" },
          key,
          admit: async () =>
            (await savedSince(record.endpoint, record.input, record.dispatchedAt)) ??
            (admit ? await admit() : null),
          ...(record.automatic ? { automatic: record.automatic } : {}),
          timeoutRetry: true,
          typicalMicros: typicalMicros(detail.value.price),
          provider: lookup.provider,
          endpoint: lookup.endpoint,
          input: record.input,
          domains: record.domains,
          maxChargeMicros: ceiling,
          idemKey: await timeoutRetryKey(record.idemKey),
          endpointVersion: detail.value.endpoint_version,
        },
        (run) => persistPanel(record, run),
      );
    } catch {
      // The timeout is already recorded; the panel shows it.
    } finally {
      await serialized(() => dropRetryIntent(record.idemKey)).catch(() => undefined);
      retrying.delete(record.idemKey);
    }
  })();
}
