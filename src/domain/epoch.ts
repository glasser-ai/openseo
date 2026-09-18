import { mintEpoch } from "../glasser/idempotency.js";

/**
 * The window in which the panel reuses an epoch for the same query.
 *
 * Minting a new epoch on every click makes every click a new Idempotency-Key,
 * and so a new charge — while nothing on the button says a second press costs
 * again. The comment in idempotency.ts has long said that a retry, a recovery, a
 * refresh and another tab share one epoch, but the panel path never did.
 *
 * Reuse inside the window and mint outside it: that is what "refresh" should
 * mean.
 */
const WINDOW_MS = 30 * 60 * 1000;
const KEY = "openseo:epochs";

type Stored = Record<string, { epoch: string; at: number }>;

export async function epochFor(endpoint: string, input: unknown): Promise<string> {
  const id = `${endpoint}:${stable(input)}`;
  const bag = await chrome.storage.local.get(KEY);
  const stored = (bag[KEY] as Stored | undefined) ?? {};

  const existing = stored[id];
  if (existing && Date.now() - existing.at < WINDOW_MS) return existing.epoch;

  const epoch = mintEpoch();
  const fresh: Stored = { ...prune(stored), [id]: { epoch, at: Date.now() } };
  await chrome.storage.local.set({ [KEY]: fresh });
  return epoch;
}

/** An explicit refresh: drop this entry, and the next call mints a new epoch
    (and is charged again). */
export async function forgetEpoch(endpoint: string, input: unknown): Promise<void> {
  const bag = await chrome.storage.local.get(KEY);
  const stored = (bag[KEY] as Stored | undefined) ?? {};
  const { [`${endpoint}:${stable(input)}`]: _dropped, ...rest } = stored;
  await chrome.storage.local.set({ [KEY]: rest });
}

const prune = (stored: Stored): Stored =>
  Object.fromEntries(Object.entries(stored).filter(([, v]) => Date.now() - v.at < WINDOW_MS));

/** Stable key order, or the same input would produce two different ids. */
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
    .join(",")}}`;
}
