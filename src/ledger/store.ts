import { decodeMicros, encodeMicros, type Micros } from "./micros.js";

/**
 * The local ledger.
 *
 * Three disciplines, each answering a real way to lose money:
 *
 * 1. **Every read-modify-write goes through one serial queue.** The worker is
 *    single-threaded, but `await` interleaves: two panel Runs can each read the
 *    same remaining headroom, each conclude there is room, and both dispatch —
 *    overshooting a cap that both of them respected.
 * 2. **The pending record is deleted last.** It is not only a retry credential
 *    but also the lock saying "start no new Run for these domains". Delete it
 *    before the result is persisted and the next visit finds neither a cache nor
 *    a pending record, so it mints a new epoch and pays again — and runId
 *    idempotency cannot help, because a new epoch is by definition a different
 *    Idempotency-Key.
 * 3. **When in doubt, assume it was charged.** A reservation is released only on
 *    certain information.
 */

const KEY = "openseo:key";
const SETTINGS = "openseo:settings";
const SPEND = "openseo:spend";
const LEDGER = "openseo:ledger";
const PENDING_PREFIX = "openseo:pending:";
const HISTORY = "openseo:history";

export type PendingState = "in-flight" | "suspended";

/**
 * Where this pending request's result should be written.
 *
 * The recovery path has to persist the result **itself** — it runs after a
 * worker restart, long after the code that started the request is gone. Without
 * this, recover() only settles and deletes the record, the cache stays empty,
 * and the next visit mints a new epoch and pays again.
 */
// The legacy "serp" shape remains readable only for already-pending requests.
export type Purpose =
  | {
      readonly kind: "serp";
      readonly metricId: string;
      readonly locationCode: number;
      readonly languageCode: string;
    }
  | { readonly kind: "panel" };

export type PendingRecord = {
  readonly idemKey: string;
  readonly purpose?: Purpose;
  readonly provider: string;
  readonly endpoint: string;
  readonly endpointVersion?: number;
  readonly input: unknown;
  /** The domains this request covers — the lock is **per domain**, not per
      batch. */
  readonly domains: readonly string[];
  readonly keyFingerprint: string;
  readonly reservedMicros: string;
  /** Written **before** the fetch. The record existing means "may already have
      been admitted". */
  readonly dispatchedAt: number;
  readonly runId?: string;
  readonly runUrl?: string;
  readonly attempts: number;
  readonly state: PendingState;
  readonly reason?: string;
};

export type Settings = {
  readonly dailyCapMicros: string;
  readonly monthlyCapMicros: string;
};

export const DEFAULT_SETTINGS: Settings = {
  dailyCapMicros: encodeMicros(5_000_000n), // $5.00
  monthlyCapMicros: encodeMicros(20_000_000n), // $20.00
};

type Spend = {
  readonly day: string;
  readonly dayMicros: string;
  readonly month: string;
  readonly monthMicros: string;
  /** The worst-case total dispatched but not yet settled. */
  readonly reservedMicros: string;
};

const ZERO_SPEND = (now: Date): Spend => ({
  day: dayKey(now),
  dayMicros: "0",
  month: monthKey(now),
  monthMicros: "0",
  reservedMicros: "0",
});

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);
const monthKey = (date: Date): string => date.toISOString().slice(0, 7);

// ── The serial section ────────────────────────────────────────────────────
// There is only ever one service worker instance, so an in-memory promise chain
// is enough — provided **every** path that touches headroom goes through it.
let tail: Promise<unknown> = Promise.resolve();

export function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const next = tail.then(operation, operation);
  tail = next.catch(() => undefined);
  return next;
}

// ── Raw storage ───────────────────────────────────────────────────────────
async function read<T>(key: string): Promise<T | undefined> {
  const bag = await chrome.storage.local.get(key);
  return bag[key] as T | undefined;
}
const write = (key: string, value: unknown): Promise<void> =>
  chrome.storage.local.set({ [key]: value });

// ── Key ───────────────────────────────────────────────────────────────────
export const getKey = (): Promise<string | undefined> => read<string>(KEY);
export const setKey = (key: string): Promise<void> => write(KEY, key);
export const clearKey = (): Promise<void> => chrome.storage.local.remove(KEY);

/**
 * A fingerprint of the Key. Only to notice that the Key changed, not a security
 * measure — idempotency bindings are scoped to a Workspace, and /v1 has no
 * whoami, so after a Key change there is no way to tell whether it is the same
 * Workspace and everything is suspended instead.
 */
export async function fingerprint(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ── Settings ──────────────────────────────────────────────────────────────
export async function getSettings(): Promise<Settings> {
  const saved = await read<Partial<Settings>>(SETTINGS);
  return {
    dailyCapMicros: saved?.dailyCapMicros ?? DEFAULT_SETTINGS.dailyCapMicros,
    monthlyCapMicros: saved?.monthlyCapMicros ?? DEFAULT_SETTINGS.monthlyCapMicros,
  };
}
export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("Invalid settings.");
  for (const [key, value] of Object.entries(patch)) {
    if (key === "dailyCapMicros" || key === "monthlyCapMicros") {
      if (typeof value !== "string" || !/^\d+$/.test(value))
        throw new Error("Budgets must be nonnegative amounts.");
    } else throw new Error("Unknown setting.");
  }
  return serialized(async () => {
    const next = { ...(await getSettings()), ...patch };
    await write(SETTINGS, next);
    return next;
  });
}

// ── Headroom ──────────────────────────────────────────────────────────────
type Ledger = { spend: Spend; history: SettledCharge[]; pending: Record<string, PendingRecord> };

/** One storage value owns money, settlement identities and reservations. */
async function loadLedger(now = new Date()): Promise<Ledger> {
  let ledger = await read<Ledger>(LEDGER);
  if (!ledger) {
    const bag = await chrome.storage.local.get(null);
    const history = (bag[HISTORY] as SettledCharge[] | undefined) ?? [];
    const spend = (bag[SPEND] as Spend | undefined) ?? ZERO_SPEND(now);
    // Preserve legacy counters, and recover any undercount that retained history proves.
    const total = (period: string) =>
      history.reduce(
        (sum, row) =>
          new Date(row.at).toISOString().startsWith(period)
            ? sum + decodeMicros(row.chargeMicros)
            : sum,
        0n,
      );
    const day = dayKey(now);
    const month = monthKey(now);
    const max = (a: bigint, b: bigint) => (a > b ? a : b);
    ledger = {
      spend: {
        ...spend,
        day,
        month,
        dayMicros: encodeMicros(
          max(spend.day === day ? decodeMicros(spend.dayMicros) : 0n, total(day)),
        ),
        monthMicros: encodeMicros(
          max(spend.month === month ? decodeMicros(spend.monthMicros) : 0n, total(month)),
        ),
      },
      history,
      pending: Object.fromEntries(
        Object.entries(bag)
          .filter(([key]) => key.startsWith(PENDING_PREFIX))
          .map(([, value]) => {
            const record = value as PendingRecord;
            return [record.idemKey, record];
          }),
      ),
    };
  }
  const day = dayKey(now);
  const month = monthKey(now);
  return {
    ...ledger,
    spend: {
      ...ledger.spend,
      day,
      month,
      dayMicros: ledger.spend.day === day ? ledger.spend.dayMicros : "0",
      monthMicros: ledger.spend.month === month ? ledger.spend.monthMicros : "0",
    },
  };
}

const saveLedger = (ledger: Ledger): Promise<void> => write(LEDGER, ledger);
const loadSpend = async (): Promise<Spend> => (await loadLedger()).spend;

export type Headroom = {
  readonly dayRemaining: Micros;
  readonly monthRemaining: Micros;
  readonly reserved: Micros;
};

export async function headroom(): Promise<Headroom> {
  const [spend, settings] = await Promise.all([loadSpend(), getSettings()]);
  const reserved = decodeMicros(spend.reservedMicros);
  return {
    reserved,
    dayRemaining: decodeMicros(settings.dailyCapMicros) - decodeMicros(spend.dayMicros) - reserved,
    monthRemaining:
      decodeMicros(settings.monthlyCapMicros) - decodeMicros(spend.monthMicros) - reserved,
  };
}

/**
 * Checks headroom and reserves the worst-case Charge, in one step with nothing
 * else awaited in between. The caller must already be inside `serialized`.
 */
export async function reserve(amount: Micros): Promise<boolean> {
  const room = await headroom();
  if (amount < 0n || amount > room.dayRemaining || amount > room.monthRemaining) return false;
  const ledger = await loadLedger();
  await saveLedger({
    ...ledger,
    spend: {
      ...ledger.spend,
      reservedMicros: encodeMicros(decodeMicros(ledger.spend.reservedMicros) + amount),
    },
  });
  return true;
}

// ── Settlement history (idempotent per runId) ─────────────────────────────
export type SettledCharge = {
  readonly domains?: readonly string[];
  readonly chargeReported?: boolean;
  readonly failure?: string;
  readonly runId: string;
  readonly runUrl: string;
  readonly provider: string;
  readonly endpoint: string;
  readonly chargeMicros: string;
  readonly at: number;
};

/** Called inside serialized(). A retry can never separate the marker from the money. */
export async function settleCharge(idemKey: string, entry: SettledCharge): Promise<void> {
  const ledger = await loadLedger();
  const record = ledger.pending[idemKey];
  const seen = ledger.history.some((row) => row.runId === entry.runId);
  const charged = seen ? 0n : decodeMicros(entry.chargeMicros);
  const reserved = record ? decodeMicros(record.reservedMicros) : 0n;
  const remaining = decodeMicros(ledger.spend.reservedMicros) - reserved;
  const pending = record
    ? {
        ...ledger.pending,
        [idemKey]: { ...record, reservedMicros: "0", runId: entry.runId, runUrl: entry.runUrl },
      }
    : ledger.pending;
  // Keep settlement markers for all unfinished persistence work, even beyond 500 charges.
  const pinned = new Set(Object.values(pending).map((item) => item.runId));
  const history = seen ? ledger.history : [entry, ...ledger.history];
  await saveLedger({
    pending,
    history: history.filter((row, index) => index < 500 || pinned.has(row.runId)),
    spend: {
      ...ledger.spend,
      reservedMicros: encodeMicros(remaining > 0n ? remaining : 0n),
      dayMicros: encodeMicros(decodeMicros(ledger.spend.dayMicros) + charged),
      monthMicros: encodeMicros(decodeMicros(ledger.spend.monthMicros) + charged),
    },
  });
}

export const getHistory = async (): Promise<SettledCharge[]> => (await loadLedger()).history;

// Pending records use the same value as their reservations and settlements.
export const pendingKey = (idemKey: string): string => `${PENDING_PREFIX}${idemKey}`;
export async function putPending(record: PendingRecord): Promise<void> {
  const ledger = await loadLedger();
  await saveLedger({ ...ledger, pending: { ...ledger.pending, [record.idemKey]: record } });
}

/** Removes a request and releases only its still-outstanding reservation. */
export async function dropPending(idemKey: string): Promise<void> {
  const ledger = await loadLedger();
  const { [idemKey]: record, ...pending } = ledger.pending;
  const remaining =
    decodeMicros(ledger.spend.reservedMicros) - (record ? decodeMicros(record.reservedMicros) : 0n);
  await saveLedger({
    ...ledger,
    pending,
    spend: { ...ledger.spend, reservedMicros: encodeMicros(remaining > 0n ? remaining : 0n) },
  });
}

export const allPending = async (): Promise<PendingRecord[]> =>
  Object.values((await loadLedger()).pending);

/**
 * Whether the same question already has a pending record. Identity is
 * (provider, endpoint, input) rather than the domain — one domain can have four
 * different questions in flight at once.
 */
export async function unresolvedRequest(
  provider: string,
  endpoint: string,
  input: unknown,
): Promise<PendingRecord | null> {
  const wanted = stable(input);
  for (const record of await allPending()) {
    if (record.provider !== provider || record.endpoint !== endpoint) continue;
    if (stable(record.input) === wanted) return record;
  }
  return null;
}

/** Serialised with sorted keys — otherwise {a,b} and {b,a} would count as two
    different inputs. */
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
}

/**
 * Recomputes `reservedMicros` as the sum of every pending record.
 *
 * It covers two holes:
 *  - reserve() and putPending() are two writes, and being killed between them
 *    leaves an ownerless reservation;
 *  - a settlement running twice over-deducts the reservation.
 * Run once at startup, at the cost of one read and one write.
 */
export async function reconcileReservations(): Promise<void> {
  await serialized(async () => {
    const ledger = await loadLedger();
    const expected = Object.values(ledger.pending).reduce(
      (sum, record) => sum + decodeMicros(record.reservedMicros),
      0n,
    );
    await saveLedger({
      ...ledger,
      spend: { ...ledger.spend, reservedMicros: encodeMicros(expected) },
    });
  });
}

/** Explicitly release an unresolved reservation; this does not refund the Provider. */
export const writeOffPending = (idemKey: string): Promise<void> =>
  serialized(() => dropPending(idemKey));

export async function suspendPending(idemKey: string, reason: string): Promise<void> {
  const record = (await loadLedger()).pending[idemKey];
  if (record) await putPending({ ...record, state: "suspended", reason });
}
