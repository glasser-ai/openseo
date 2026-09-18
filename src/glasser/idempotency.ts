/** Stable JSON: keys are sorted, so the same input always hashes the same. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

/**
 * Idempotency-Key = hash(provider, endpoint, version, normalised input,
 * **epoch**).
 *
 * The epoch is what matters: once a binding exists it replays forever, with no
 * expiry. Without one, the same key would keep fetching that old Run after the
 * cache expired, and the figures could never refresh. Reuse within one epoch is
 * deliberate — a retry, a recovery after a worker restart, a page refresh, and
 * another tab opening the same report all share one Run and one Charge. Only an
 * expired cache or an explicit refresh mints a new epoch, and that is the only
 * path that costs again.
 */
export async function idempotencyKey(input: {
  provider: string;
  endpoint: string;
  endpointVersion?: number;
  body: unknown;
  epoch: string;
}): Promise<string> {
  const material = canonical({
    provider: input.provider,
    endpoint: input.endpoint,
    endpoint_version: input.endpointVersion ?? null,
    input: input.body,
    epoch: input.epoch,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** A new epoch means paying again. Minted only on an expired cache or an
    explicit refresh. */
export const mintEpoch = (): string =>
  `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
