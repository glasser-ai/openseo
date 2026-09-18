/**
 * Website traffic on Similarweb's terms, through the apify
 * `tri_angle/fast-similarweb-scraper` Endpoint.
 *
 * The lookup is **by domain**, so a subdomain and a freshly registered domain
 * both resolve on their own terms, and the answer carries global rank, country
 * rank and visitor countries alongside the visit figures.
 *
 * The shape follows the Actor's published output:
 *   globalRank            {rank}
 *   countryRank           {countryCode, rank}
 *   engagements           {visits, bounceRate, pagePerVisit, timeOnSite}
 *   estimatedMonthlyVisits {"2024-08-01": n, ...}
 *   trafficSources        {direct, search, referrals, social, mail, paidReferrals} as 0–1 fractions
 *   topCountries          [{countryCode, countryName, visitsShare}]
 * These arrive as real numbers, but everything still goes through num(): a miss
 * comes back as a structurally complete row whose fields are all null or 0, and
 * that must not be read as a hit.
 */
/**
 * This lookup's identity. **Written once, here** — service.ts needs it to send
 * the request and persist.ts needs it to recognise whether a recovered Run is a
 * traffic one. Each used to hold its own literal, so changing Provider updated
 * only one of them and the recovery path silently wrote nothing.
 */
export const TRAFFIC_PROVIDER = "apify";
export const TRAFFIC_ENDPOINT = "/tri_angle/fast-similarweb-scraper";

export type Engagement = {
  readonly visits: number | null;
  readonly bounceRate: number | null;
  readonly pagesPerVisit: number | null;
  readonly timeOnSite: number | null;
  readonly period: string | null;
};

export type SourceSlice = { readonly key: string; readonly label: string; readonly share: number };
export type MonthlyPoint = { readonly date: string; readonly visits: number };
export type CountrySlice = { readonly code: string; readonly name: string; readonly share: number };

export type TrafficPanel = {
  readonly engagement: Engagement;
  readonly sources: readonly SourceSlice[];
  readonly monthly: readonly MonthlyPoint[];
  readonly globalRank: number | null;
  readonly countryRank: { readonly code: string; readonly rank: number } | null;
  readonly countries: readonly CountrySlice[];
};

/**
 * Plain-English labels for the known channels. The order is the slot order (see
 * CHANNEL_SLOT in palette.ts).
 *
 * **This is not a whitelist.** It used to read values for exactly these six
 * fields, so any other channel the Provider returned was dropped — and dropped
 * silently: it was absorbed into "Not attributed", which looked like the
 * Provider withholding it when in fact we never asked. That is how Display Ads
 * and Other went missing on github.com. Now **whatever the Provider sends is
 * taken**, and this table only translates the familiar ones and pins their
 * slots.
 */
const CHANNELS: readonly (readonly [string, string])[] = [
  ["direct", "Direct"],
  ["search", "Search"],
  ["referrals", "Referrals"],
  ["social", "Social"],
  ["paidReferrals", "Paid referrals"],
  ["mail", "Mail"],
];

/**
 * Different spellings of the same thing. A change of Provider, or the same
 * Actor renaming a field, must not be read as the channel never arriving.
 */
const ALIASES: Record<string, string> = {
  organicsearch: "search",
  paidsearch: "search",
  displayads: "paidReferrals",
  display: "paidReferrals",
  paid: "paidReferrals",
  paidreferral: "paidReferrals",
  referral: "referrals",
  email: "mail",
  socialmedia: "social",
};

/**
 * "Other" and "unknown" are not channels but **the part attributed to none**.
 * So they get no row of their own and fall back into the shortfall Donut
 * computes — otherwise the ring carries two grey segments, one called Other and
 * one called Not attributed, saying the same thing.
 */
const UNATTRIBUTED = new Set(["other", "others", "unknown", "unknownchannel"]);

const normalise = (key: string): string => key.replace(/[^a-z0-9]/gi, "").toLowerCase();

const canonical = (key: string): string => {
  const flat = normalise(key);
  const known = CHANNELS.find(([name]) => normalise(name) === flat);
  return known?.[0] ?? ALIASES[flat] ?? key;
};

/** An unfamiliar field still has to be displayable: `displayAds` becomes
    "Display ads". */
const humanise = (key: string): string => {
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const labelOf = (key: string): string =>
  CHANNELS.find(([name]) => name === key)?.[1] ?? humanise(key);

/**
 * A Run's output is the Actor's dataset. Take the first record that **looks
 * like a traffic row** rather than an index, because the wrapping (a bare
 * array, {items:[…]}, or one more layer) is not ours to decide.
 */
function firstRow(output: unknown): Record<string, unknown> | null {
  const seen = new Set<unknown>();
  const walk = (node: unknown): Record<string, unknown> | null => {
    if (node === null || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) return found;
      }
      return null;
    }
    const row = node as Record<string, unknown>;
    if (row["engagements"] !== undefined || row["globalRank"] !== undefined) return row;
    for (const value of Object.values(row)) {
      const found = walk(value);
      if (found) return found;
    }
    return null;
  };
  return walk(output);
}

export function extractTraffic(output: unknown): TrafficPanel | null {
  const row = firstRow(output);
  if (!row) return null;

  const raw = (row["engagements"] ?? {}) as Record<string, unknown>;
  const engagement: Engagement = {
    visits: num(raw["visits"]),
    bounceRate: num(raw["bounceRate"]),
    pagesPerVisit: num(raw["pagePerVisit"]),
    timeOnSite: num(raw["timeOnSite"]),
    period: null,
  };

  /*
   * Take **every** field, not only the six familiar ones.
   * Aliases fold onto one key, and their shares add rather than overwrite: if
   * search and organicSearch both arrive, those are two halves of one channel,
   * not the second replacing the first.
   */
  const rawSources = (row["trafficSources"] ?? {}) as Record<string, unknown>;
  const totals = new Map<string, number>();
  for (const [rawKey, rawValue] of Object.entries(rawSources)) {
    const share = num(rawValue);
    if (share === null || share <= 0) continue;
    if (UNATTRIBUTED.has(normalise(rawKey))) continue;
    const key = canonical(rawKey);
    totals.set(key, (totals.get(key) ?? 0) + share);
  }
  const sources = [...totals]
    .map(([key, share]) => ({ key, label: labelOf(key), share }))
    .sort((a, b) => b.share - a.share);

  const rawMonthly = (row["estimatedMonthlyVisits"] ?? {}) as Record<string, unknown>;
  const monthly = Object.entries(rawMonthly)
    .map(([date, value]) => ({ date, visits: num(value) ?? 0 }))
    .filter((point) => point.visits > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  // The latest complete month is this section's basis, so it labels the period.
  const latest = monthly.at(-1);
  const withPeriod: Engagement = {
    ...engagement,
    visits: engagement.visits ?? latest?.visits ?? null,
    period: latest ? monthName(latest.date) : null,
  };

  const globalRank = num((row["globalRank"] as Record<string, unknown> | null)?.["rank"]);
  const rawCountryRank = (row["countryRank"] ?? null) as Record<string, unknown> | null;
  const countryRankValue = num(rawCountryRank?.["rank"]);
  const countryCode = rawCountryRank?.["countryCode"];

  const countries = (Array.isArray(row["topCountries"]) ? row["topCountries"] : [])
    .flatMap((item) => {
      const country = item as Record<string, unknown>;
      const share = num(country["visitsShare"]);
      const code = country["countryCode"];
      if (share === null || typeof code !== "string") return [];
      const name = country["countryName"];
      return [{ code, name: typeof name === "string" ? name : code, share }];
    })
    .slice(0, 5);

  /*
   * The hit test must match **the server's exactly**, or the two will disagree.
   * The catalog entry's hasResults is: globalRank.rank > 0, or
   * engagements.visits > 0.
   *
   * What matters is that a miss also pushes a row, and a structurally complete
   * one whose fields are all null or 0 — `visits: 0` is a number rather than
   * null, so field presence cannot decide it. Testing > 0 keeps "not tracked"
   * distinct from "zero visits this month".
   */
  const tracked =
    (globalRank !== null && globalRank > 0) ||
    (withPeriod.visits !== null && withPeriod.visits > 0);
  return !tracked
    ? null
    : {
        engagement: withPeriod,
        sources,
        monthly,
        globalRank,
        countryRank:
          countryRankValue !== null && typeof countryCode === "string"
            ? { code: countryCode, rank: countryRankValue }
            : null,
        countries,
      };
}

/** "2024-10-01" becomes "October 2024". */
function monthName(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function period(year: unknown, month: unknown): string | null {
  const y = num(year);
  const m = num(month);
  if (y === null || m === null) return null;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function compact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(
    value,
  );
}

/**
 * Seconds to HH:MM:SS.
 * Seconds **truncate** rather than round — a duration is read like a clock, so
 * 384.66s is 06:24 and not 06:25.
 */
export function duration(seconds: number): string {
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ss = String(s).padStart(2, "0");
  // With units. `11:03` reads as a clock time; `11m 03s` does not.
  // Under an hour the hours are omitted — two digits that are always 0 only
  // make a reader count them first.
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${ss}s`;
}

export const percent = (share: number): string => `${(share * 100).toFixed(2)}%`;

/**
 * Reads a string printed by compact() back to a number: "51.9M" to 51900000.
 *
 * Why read it back rather than store the raw number in the payload as well:
 * **caches outlive extension versions** (PanelEntry carries no version, and the
 * TTL is 7 days). Adding a new field would leave every already-purchased result
 * uncoloured until it expired — the copy someone paid for looking the worst.
 * Reading it back takes effect on every existing cache immediately.
 *
 * The precision is ample: the bands are **orders of magnitude** apart, and at
 * most the last decimal place is lost here. Anything unrecognised returns NaN so
 * toneOf falls to neutral — inventing a number would be far worse than not
 * colouring it.
 */
export function parseCompact(text: string): number {
  const match = /^([\d,]+(?:\.\d+)?)\s*([KMBT])?$/i.exec(text.trim());
  if (!match?.[1]) return Number.NaN;
  const size = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[match[2]?.toLowerCase() ?? ""] ?? 1;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value * size : Number.NaN;
}

export const monthLabel = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
};
