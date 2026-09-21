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

/** The saved map, or null when there is none and a fetch would be needed. */
async function savedBootstrap(): Promise<Record<string, string> | null> {
  const bag = await chrome.storage.local.get(BOOTSTRAP_KEY);
  const cached = bag[BOOTSTRAP_KEY] as Bootstrap | undefined;
  return cached && Date.now() - cached.fetchedAt < BOOTSTRAP_TTL_MS ? cached.map : null;
}

async function bootstrap(): Promise<Record<string, string>> {
  const saved = await savedBootstrap();
  if (saved) return saved;

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
  | {
      readonly kind: "ok";
      readonly value: Registration;
      readonly fetchedAt: number;
      /**
       * The registry URL this record was read from, so the panel can link to
       * it. Null only when the TLD's registry cannot be resolved at all.
       */
      readonly source: string | null;
    }
  | { readonly kind: "unsupported" }
  | { readonly kind: "failed"; readonly reason: string };

/** The RDAP record's own URL: the registry base, then /domain/<name>. */
const recordUrl = (base: string, domain: string): string =>
  `${base.endsWith("/") ? base : `${base}/`}domain/${encodeURIComponent(domain)}`;

/** The same URL from a map that may be missing, for the cached path. */
const resolve = (map: Record<string, string> | null, domain: string): string | null => {
  const base = map && baseFor(map, domain);
  return base ? recordUrl(base, domain) : null;
};

export async function lookupRegistration(host: string): Promise<RdapResult> {
  // RDAP answers for **the registrable domain**: docs.apify.com must ask about
  // apify.com.
  const domain = registrableDomain(host);
  const key = `${RESULT_PREFIX}${domain}`;
  const bag = await chrome.storage.local.get(key);
  const cached = bag[key] as
    | { fetchedAt: number; value: Registration; source?: string }
    | undefined;
  if (cached && Date.now() - cached.fetchedAt < RESULT_TTL_MS) {
    /*
     * A record cached by a version before the URL was recorded has no `source`,
     * and the records last 30 days — so simply reading the saved field would
     * have left the panel's link missing for a month on every domain already
     * looked at, which is exactly how it was first reported.
     *
     * The URL is not a fact about the record, though: it is the registry base
     * for the TLD plus the domain, and that base is in the saved bootstrap map.
     * So rebuild it. Only the **saved** map is consulted, never a fetch: a cache
     * hit is answered from local storage, and it is not going to reach the
     * network to decorate a label.
     */
    const saved = cached.source ?? resolve(await savedBootstrap(), domain);
    return { kind: "ok", value: cached.value, fetchedAt: cached.fetchedAt, source: saved };
  }

  try {
    const base = baseFor(await bootstrap(), domain);
    // Some TLD registries are not listed for RDAP in IANA's bootstrap (.io, for
    // one).
    if (!base) return { kind: "unsupported" };
    const url = recordUrl(base, domain);
    const response = await fetch(url, { headers: { Accept: "application/rdap+json" } });
    if (response.status === 404) return { kind: "unsupported" };
    if (!response.ok) return { kind: "failed", reason: `registry returned ${response.status}` };
    const value = parseRdap(await response.json());
    if (!value) return { kind: "unsupported" };
    await chrome.storage.local.set({ [key]: { fetchedAt: Date.now(), value, source: url } });
    return { kind: "ok", value, fetchedAt: Date.now(), source: url };
  } catch {
    return { kind: "failed", reason: "could not reach the domain registry" };
  }
}
