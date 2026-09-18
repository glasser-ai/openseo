import type { KeywordRow, LookupField } from "./lookups.js";
import type { TrafficPanel } from "./traffic.js";

/** Saved domain reports are reused until expiry; explicit Refresh requests a new lookup. */
const KEY_PREFIX = "openseo:panel:";

/** Positive domain reports stay fresh for seven days. */
export const PANEL_TTL_MS = 7 * 86_400_000;

/** "No data" is held for one day only: there may be some later, but not at the
    price of asking repeatedly today. */
export const EMPTY_TTL_MS = 86_400_000;

export type PanelPayload =
  | {
      readonly kind: "fields";
      readonly fields: readonly LookupField[];
      readonly keywords?: readonly KeywordRow[];
    }
  | { readonly kind: "traffic"; readonly panel: TrafficPanel }
  /**
   * The Provider has no data for this domain.
   *
   * **This must be cached**: several Endpoints price their NO_RESULT clause the
   * same as a success (backlinks/summary at $0.024, bulk_traffic_estimation at
   * $0.01236). Without caching it, a domain that cannot be found charges in full
   * on every click and is never found.
   */
  | { readonly kind: "none"; readonly reason: string };

export type PanelEntry = {
  readonly payload: PanelPayload;
  readonly runUrl: string;
  readonly chargeUsd: string | null;
  readonly fetchedAt: number;
};

const keyOf = (endpoint: string, input: unknown): string =>
  `${KEY_PREFIX}${endpoint}:${stable(input)}`;

export async function readStoredPanel(
  endpoint: string,
  input: unknown,
): Promise<PanelEntry | null> {
  const key = keyOf(endpoint, input);
  const bag = await chrome.storage.local.get(key);
  const entry = bag[key] as PanelEntry | undefined;
  return entry ?? null;
}

export function isOutdated(entry: PanelEntry): boolean {
  const ttl = entry.payload.kind === "none" ? EMPTY_TTL_MS : PANEL_TTL_MS;
  return Date.now() - entry.fetchedAt >= ttl;
}

export async function readPanel(endpoint: string, input: unknown): Promise<PanelEntry | null> {
  const entry = await readStoredPanel(endpoint, input);
  return entry && !isOutdated(entry) ? entry : null;
}

export async function writePanel(
  endpoint: string,
  input: unknown,
  entry: Omit<PanelEntry, "fetchedAt">,
): Promise<void> {
  await chrome.storage.local.set({ [keyOf(endpoint, input)]: { ...entry, fetchedAt: Date.now() } });
}

/** A relative time for people. "3d ago" is far more use than an ISO timestamp. */
export function ageOf(fetchedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - fetchedAt) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Stable key order, or the same input would produce two different keys. */
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
    .join(",")}}`;
}
