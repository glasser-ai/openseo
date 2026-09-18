import { registrableDomain } from "./site.js";

/**
 * Domain registration details (RDAP).
 *
 * The dates come from `events[]`, each entry tagged with an `eventAction` —
 * "registration", "expiration", "last changed". That array is RDAP's response
 * format; the older WHOIS free-text format is not parsed here at all, which is
 * why the registry is asked directly rather than a WHOIS mirror.
 *
 * This is **public registry data and free**, so it is not in the catalog and
 * need not be: the one whois entry there takes limit/offset only, being a
 * paginated dump that cannot be asked about a particular domain.
 *
 * Two implementation choices:
 *  1. **Not through rdap.org.** That is a third-party redirector, and the
 *     Cloudflare behind it answers programmatic requests with 403 (measured).
 *     IANA's bootstrap (RFC 7484) is used instead to resolve TLD to registry
 *     directly — one fewer intermediary, and one fewer dependency that can fail.
 *  2. **No host permission of any kind.** RFC 7480 section 5.6 requires an RDAP
 *     server to answer with `Access-Control-Allow-Origin: *`, so an ordinary
 *     cross-origin fetch reaches it — and Chrome's permission warning gains
 *     nothing as a result.
 */
export type Registration = {
  readonly registered: string | null;
  readonly expires: string | null;
  readonly updated: string | null;
  readonly registrar: string | null;
};

const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_KEY = "openseo:rdap-bootstrap";
const RESULT_PREFIX = "openseo:rdap:";
/** A registration date never changes, and an expiry moves once a year. */
const RESULT_TTL_MS = 30 * 86_400_000;
const BOOTSTRAP_TTL_MS = 7 * 86_400_000;

type Bootstrap = { readonly fetchedAt: number; readonly map: Record<string, string> };

async function bootstrap(): Promise<Record<string, string>> {
  const bag = await chrome.storage.local.get(BOOTSTRAP_KEY);
  const cached = bag[BOOTSTRAP_KEY] as Bootstrap | undefined;
  if (cached && Date.now() - cached.fetchedAt < BOOTSTRAP_TTL_MS) return cached.map;

  const response = await fetch(BOOTSTRAP_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`bootstrap ${response.status}`);
  const body = (await response.json()) as { services: [string[], string[]][] };
  const map: Record<string, string> = {};
  for (const [suffixes, urls] of body.services) {
    const base = urls.find((url) => url.startsWith("https://"));
    if (!base) continue;
    for (const suffix of suffixes) map[suffix.toLowerCase()] = base;
  }
  await chrome.storage.local.set({ [BOOTSTRAP_KEY]: { fetchedAt: Date.now(), map } });
  return map;
}

/** Finds the longest match from the right: bbc.co.uk tries co.uk, then uk. */
function baseFor(map: Record<string, string>, domain: string): string | null {
  const labels = domain.split(".");
  for (let index = 1; index < labels.length; index += 1) {
    const found = map[labels.slice(index).join(".")];
    if (found) return found;
  }
  return null;
}

const dateOf = (value: unknown): string | null =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;

/** An RDAP vcard is arrays inside arrays: ["fn", {}, "text", "Registrar Name"]. */
function registrarName(entities: unknown): string | null {
  if (!Array.isArray(entities)) return null;
  for (const entity of entities) {
    const record = entity as { roles?: unknown; vcardArray?: unknown };
    if (!Array.isArray(record.roles) || !record.roles.includes("registrar")) continue;
    const fields = (record.vcardArray as unknown[])?.[1];
    if (!Array.isArray(fields)) continue;
    for (const field of fields) {
      if (Array.isArray(field) && field[0] === "fn" && typeof field[3] === "string")
        return field[3];
    }
  }
  return null;
}

export function parseRdap(body: unknown): Registration | null {
  const record = body as { events?: unknown; entities?: unknown } | null;
  if (!record || typeof record !== "object") return null;
  const events = Array.isArray(record.events) ? record.events : [];
  const byAction = new Map<string, unknown>();
  for (const event of events) {
    const item = event as { eventAction?: unknown; eventDate?: unknown };
    if (typeof item.eventAction === "string") byAction.set(item.eventAction, item.eventDate);
  }
  const registration: Registration = {
    registered: dateOf(byAction.get("registration")),
    expires: dateOf(byAction.get("expiration")),
    updated: dateOf(byAction.get("last changed")),
    registrar: registrarName(record.entities),
  };
  // With none of them there is no usable answer — an empty shell is not a hit.
  return registration.registered === null && registration.expires === null ? null : registration;
}

export type RdapResult =
  | { readonly kind: "ok"; readonly value: Registration; readonly fetchedAt: number }
  | { readonly kind: "unsupported" }
  | { readonly kind: "failed"; readonly reason: string };

export async function lookupRegistration(host: string): Promise<RdapResult> {
  // RDAP answers for **the registrable domain**: docs.apify.com must ask about
  // apify.com.
  const domain = registrableDomain(host);
  const key = `${RESULT_PREFIX}${domain}`;
  const bag = await chrome.storage.local.get(key);
  const cached = bag[key] as { fetchedAt: number; value: Registration } | undefined;
  if (cached && Date.now() - cached.fetchedAt < RESULT_TTL_MS) {
    return { kind: "ok", value: cached.value, fetchedAt: cached.fetchedAt };
  }

  try {
    const base = baseFor(await bootstrap(), domain);
    // Some TLD registries are not listed for RDAP in IANA's bootstrap (.io, for
    // one).
    if (!base) return { kind: "unsupported" };
    const url = `${base.endsWith("/") ? base : `${base}/`}domain/${encodeURIComponent(domain)}`;
    const response = await fetch(url, { headers: { Accept: "application/rdap+json" } });
    if (response.status === 404) return { kind: "unsupported" };
    if (!response.ok) return { kind: "failed", reason: `registry returned ${response.status}` };
    const value = parseRdap(await response.json());
    if (!value) return { kind: "unsupported" };
    await chrome.storage.local.set({ [key]: { fetchedAt: Date.now(), value } });
    return { kind: "ok", value, fetchedAt: Date.now() };
  } catch {
    return { kind: "failed", reason: "could not reach the domain registry" };
  }
}
