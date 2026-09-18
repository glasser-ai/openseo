/**
 * **One** name per concept, shared by the panel and the settings page.
 *
 * The two used to name things separately: Whole-site traffic / Domain lookup,
 * Organic search / Estimated organic traffic, Ranking keywords / Top ranking
 * keywords. The same charge went by two names in two places and could not be
 * reconciled.
 */
export const REPORT_TITLE = {
  traffic: "Whole-site traffic",
  "domain-rating": "Domain Rating",
  backlinks: "Backlinks",
  "organic-traffic": "Organic search",
  "ranked-keywords": "Ranking keywords",
} as const;

export type LookupId = "domain-rating" | "organic-traffic" | "ranked-keywords" | "backlinks";

export type KeywordRow = {
  readonly keyword: string;
  readonly position: number;
  readonly monthlyVolume: number | null;
  /**
   * The monthly visits this keyword **actually brings** (DataForSEO's etv).
   * A different question from search volume: a 10K-volume term at position 40
   * brings almost nobody.
   * Caches outlive extension versions and older ones carry neither of these two
   * fields, so both are optional.
   */
  readonly traffic?: number | null;
  /** Cost per click for the keyword, as a read on what it is worth. */
  readonly cpc?: number | null;
};

export type LookupField = { readonly label: string; readonly value: string };

export type Lookup = {
  readonly id: LookupId;
  readonly title: string;
  /** One sentence on what the figure is, and what it is **not**. */
  readonly blurb: string;
  readonly provider: string;
  readonly endpoint: string;
  readonly attribution: { readonly label: string; readonly href: string } | null;
  readonly buildInput: (domain: string) => unknown;
  readonly extractKeywords?: (output: unknown) => readonly KeywordRow[];
  readonly extract: (output: unknown) => readonly LookupField[];
};

export const LOOKUPS: readonly Lookup[] = [
  {
    id: "domain-rating",
    title: "Domain Rating",
    blurb: "Ahrefs' 0–100 strength score for the backlink profile. Today's value, no history.",
    provider: "ahrefs",
    endpoint: "/v3/public/domain-rating-free",
    attribution: { label: "Domain Rating by Ahrefs", href: "https://ahrefs.com/" },
    buildInput: (domain) => ({ target: domain }),
    // Measured 2026-09-15: {"domain_rating":{"license":"…","domain_rating":95}}
    extract: (output) => {
      const nested = (output as { domain_rating?: Record<string, unknown> } | null)?.domain_rating;
      const value = nested?.["domain_rating"];
      return value === undefined ? [] : [{ label: "Domain Rating", value: String(value) }];
    },
  },
  {
    id: "organic-traffic",
    title: "Estimated organic traffic",
    blurb:
      "Estimated monthly visits from Google organic search, modelled from where the domain ranks — not panel-measured visits, and not the same number other tools print.",
    provider: "dataforseo",
    endpoint: "/v3/dataforseo_labs/google/bulk_traffic_estimation/live",
    attribution: { label: "Estimated by DataForSEO", href: "https://dataforseo.com/" },
    // The input is **a flat object**, not DataForSEO's task array — the Adapter
    // does the wrapping. Sending an array is rejected by the contract outright:
    // validation_failed / Expected object at ["input"].
    buildInput: (domain) => ({ targets: [domain], location_code: 2840, language_code: "en" }),
    /**
     * Measured 2026-09-15: tasks[].result[].items[] holds
     * {target, metrics:{organic:{etv,count}, paid:{etv,count}, …}}.
     * There is no estimated_paid_traffic_cost field — the first version guessed
     * at one, and that column was always empty.
     */
    extract: (output) => {
      for (const item of walk(output)) {
        const metrics = item["metrics"] as Record<string, unknown> | undefined;
        const organic = metrics?.["organic"] as Record<string, unknown> | undefined;
        if (!organic) continue;
        const paid = metrics?.["paid"] as Record<string, unknown> | undefined;
        return [
          { label: "Est. organic visits / month", value: compact(organic["etv"]) },
          { label: "Ranking keywords", value: compact(organic["count"]) },
          { label: "Est. paid visits / month", value: compact(paid?.["etv"]) },
        ].filter((field) => field.value !== "—");
      }
      return [];
    },
  },
  {
    id: "ranked-keywords",
    title: "Top ranking keywords",
    blurb: "Keywords this domain already ranks for in Google, with position and monthly volume.",
    provider: "dataforseo",
    endpoint: "/v3/dataforseo_labs/google/ranked_keywords/live",
    attribution: { label: "Data by DataForSEO", href: "https://dataforseo.com/" },
    buildInput: (domain) => ({
      target: domain,
      location_code: 2840,
      language_code: "en",
      limit: 25,
    }),
    extractKeywords: extractKeywords,
    extract: (output) =>
      extractKeywords(output).map((row) => ({
        label: row.keyword,
        value:
          row.monthlyVolume === null
            ? `#${row.position}`
            : `#${row.position} · ${compact(row.monthlyVolume)}/mo`,
      })),
  },
  {
    id: "backlinks",
    title: "Backlinks summary",
    blurb: "Referring domains and total backlinks pointing at this domain.",
    provider: "dataforseo",
    endpoint: "/v3/backlinks/summary/live",
    attribution: { label: "Data by DataForSEO", href: "https://dataforseo.com/" },
    // This one takes target only; any extra field is rejected by the schema.
    buildInput: (domain) => ({ target: domain }),
    /** Measured: tasks[].result[] carries these fields itself, not in items. */
    extract: (output) => {
      for (const item of walk(output)) {
        if (item["referring_domains"] === undefined || item["backlinks"] === undefined) continue;
        return [
          { label: "Referring domains", value: compact(item["referring_domains"]) },
          { label: "Backlinks", value: compact(item["backlinks"]) },
          { label: "Referring pages", value: compact(item["referring_pages"]) },
          { label: "Referring IPs", value: compact(item["referring_ips"]) },
          { label: "Broken backlinks", value: compact(item["broken_backlinks"]) },
          { label: "Spam score", value: plain(item["backlinks_spam_score"]) },
        ].filter((field) => field.value !== "—");
      }
      return [];
    },
  },
];

/** A Provider's result is buried in tasks[].result[].items[], at a depth that
    varies by endpoint, so walk the whole thing. */
function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const item of node) yield* walk(item);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  yield record;
  for (const value of Object.values(record)) {
    if (typeof value === "object" && value !== null) yield* walk(value);
  }
}

function compact(value: unknown): string {
  if (typeof value !== "number") return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    Math.round(value),
  );
}

function plain(value: unknown): string {
  return typeof value === "number" ? String(value) : "—";
}

/** Preserve numeric keyword data; older cached fields remain readable. */
export function extractKeywords(output: unknown): readonly KeywordRow[] {
  const rows: KeywordRow[] = [];
  for (const item of walk(output)) {
    const data = item["keyword_data"] as
      | { keyword?: unknown; keyword_info?: { search_volume?: unknown; cpc?: unknown } }
      | undefined;
    const serp = item["ranked_serp_element"] as
      | { serp_item?: { rank_absolute?: unknown; etv?: unknown } }
      | undefined;
    const position = serp?.serp_item?.rank_absolute;
    if (
      typeof data?.keyword !== "string" ||
      typeof position !== "number" ||
      !Number.isFinite(position)
    )
      continue;
    const volume = data.keyword_info?.search_volume;
    const num = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) ? value : null;
    rows.push({
      keyword: data.keyword,
      position,
      monthlyVolume: num(volume),
      traffic: num(serp?.serp_item?.etv),
      cpc: num(data.keyword_info?.cpc),
    });
    if (rows.length === 25) break;
  }
  return rows;
}
