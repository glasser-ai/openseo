import { COUNTRIES, countryOf, type Market, placeOf } from "./markets.js";
import { registrableDomain } from "./site.js";

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
  "traffic-history": "Search traffic, 12 months",
  competitors: "Search competitors",
  "top-pages": "Top pages",
  "page-keywords": "This page's keywords",
  "ai-citations": "AI search citations",
  company: "Company",
  technologies: "Technologies",
} as const;

export type LookupId =
  | "domain-rating"
  | "organic-traffic"
  | "ranked-keywords"
  | "backlinks"
  | "traffic-history"
  | "competitors"
  | "top-pages"
  | "page-keywords"
  | "ai-citations"
  | "company"
  | "technologies";

/** One point of a month-by-month series. Shares the traffic chart's shape so
    the same line component draws both. */
export type SeriesPoint = { readonly date: string; readonly visits: number };

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
  /** Set only in an all-countries answer: the country whose figures the row
      shows. */
  readonly country?: string;
  /** Cost per click for the keyword, as a read on what it is worth. */
  readonly cpc?: number | null;
};

/**
 * One row of a ranked list: a competing domain, or one of the domain's pages.
 * Both lists answer "where does the search traffic go", so they share a shape
 * and one table draws them.
 */
export type RankedRow = {
  /** A domain, or a page's URL. */
  readonly name: string;
  /** Estimated monthly visits from Google search. */
  readonly visits: number | null;
  /** Shared keywords for a competitor; ranking keywords for a page. */
  readonly keywords: number | null;
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
  /** The market only matters to lookups with byMarket; the rest ignore it. */
  readonly buildInput: (domain: string, market: Market) => unknown;
  /** The answer depends on the country chosen for Search, so the card names it
      and the cache holds one copy per country. */
  readonly byMarket?: boolean;
  /** The Provider answers for all countries at once. Without it, all
      countries reads one fallback country (see countryOf). */
  readonly worldwide?: boolean;
  /** "page" lookups take the open page's URL where the rest take the domain,
      so each page is its own request and cache entry. */
  readonly subject?: "domain" | "page";
  readonly extractKeywords?: (output: unknown) => readonly KeywordRow[];
  /** A month-by-month series drawn under the figures, oldest first. */
  readonly extractSeries?: (output: unknown) => readonly SeriesPoint[];
  readonly extractRanked?: (output: unknown) => readonly RankedRow[];
  /**
   * How the card lays the fields out. "figures" is the default: each field a
   * lead number with a caption. "facts" is a label and value list for text
   * answers such as a company's address or a list of technologies, which read
   * as faults at figure size.
   */
  readonly layout?: "figures" | "facts";
  readonly extract: (output: unknown) => readonly LookupField[];
};

/** The market a lookup actually reads, which the card names. */
export const marketFor = (lookup: Lookup, market: Market): Market =>
  lookup.worldwide ? market : countryOf(market);

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
    byMarket: true,
    worldwide: true,
    buildInput: (domain, market) => ({ targets: [domain], ...placeOf(market) }),
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
    byMarket: true,
    worldwide: true,
    buildInput: (domain, market) => ({ target: domain, ...placeOf(market), limit: 25 }),
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
  {
    id: "traffic-history",
    title: "Search traffic, 12 months",
    blurb:
      "Estimated monthly visits from Google search in the chosen country over the last twelve months, as Semrush models them — a trend, not a visit count.",
    provider: "semrush",
    endpoint: "/?type=domain_rank_history",
    attribution: { label: "Data by Semrush", href: "https://www.semrush.com/" },
    // Semrush keys on the bare domain. One charge per month returned, so the
    // limit is the bill: 12 rows at $0.00055.
    byMarket: true,
    buildInput: (domain, market) => ({
      domain: registrableDomain(domain),
      database: countryOf(market).id,
      display_limit: 12,
    }),
    /**
     * Measured 2026-10-13: {data:[{Date:"20260915", Rank:"130393",
     * "Organic Traffic":"14289", "Organic Keywords":"22193", ...}]}, newest
     * first, every value a string.
     */
    extract: (output) => {
      const months = semrushMonths(output);
      const latest = months[0];
      const oldest = months.at(-1);
      if (!latest) return [];
      const change =
        oldest && oldest.organic > 0 && months.length > 1
          ? `${latest.organic >= oldest.organic ? "+" : ""}${Math.round(((latest.organic - oldest.organic) / oldest.organic) * 100)}%`
          : "—";
      return [
        { label: "Organic visits / month", value: compact(latest.organic) },
        { label: `Change over ${months.length} months`, value: change },
        { label: "Organic keywords", value: compact(latest.keywords) },
        { label: "Semrush rank", value: latest.rank === null ? "—" : `#${compact(latest.rank)}` },
      ].filter((field) => field.value !== "—");
    },
    extractSeries: (output) =>
      semrushMonths(output)
        .map((month) => ({ date: month.date, visits: month.organic }))
        .reverse(),
  },
  {
    id: "competitors",
    title: "Search competitors",
    blurb:
      "Domains that rank for the same Google keywords, by how many they share. Very large general sites are left out.",
    provider: "dataforseo",
    endpoint: "/v3/dataforseo_labs/google/competitors_domain/live",
    attribution: { label: "Data by DataForSEO", href: "https://dataforseo.com/" },
    byMarket: true,
    /**
     * Measured 2026-10-29 on dataforseo.com: without exclude_top_domains the
     * list was youtube, facebook, reddit, linkedin — every site shares keywords
     * with them, so they say nothing. With it, semrush, ahrefs and similarweb
     * came up. The limit of 10 keeps the call at the base charge ($0.0132).
     */
    buildInput: (domain, market) => ({
      target: domain,
      location_code: countryOf(market).locationCode,
      language_code: countryOf(market).languageCode,
      exclude_top_domains: true,
      limit: 10,
    }),
    extractRanked: (output) => extractCompetitors(output),
    extract: (output) =>
      extractCompetitors(output).map((row) => ({
        label: row.name,
        value: `${compact(row.keywords)} shared keywords`,
      })),
  },
  {
    id: "top-pages",
    title: "Top pages",
    blurb:
      "The domain's pages that bring the most estimated Google search visits, with how many keywords each ranks for.",
    provider: "dataforseo",
    endpoint: "/v3/dataforseo_labs/google/relevant_pages/live",
    attribution: { label: "Data by DataForSEO", href: "https://dataforseo.com/" },
    byMarket: true,
    worldwide: true,
    /**
     * Measured 2026-10-29: the default order is by keyword count, which put a
     * page with 615 keywords and 1.8K visits above the home page with 2.5K.
     * Ordering by etv makes these the top pages by traffic, not a re-sort of
     * the Provider's first ten.
     */
    buildInput: (domain, market) => ({
      target: domain,
      ...placeOf(market),
      order_by: ["metrics.organic.etv,desc"],
      limit: 10,
    }),
    extractRanked: (output) => extractPages(output),
    extract: (output) =>
      extractPages(output).map((row) => ({
        label: row.name,
        value: `${compact(row.visits)} visits / month`,
      })),
  },
  {
    id: "page-keywords",
    title: "This page's keywords",
    blurb:
      "Keywords the open page itself ranks for in Google, with position, monthly volume and estimated visits.",
    provider: "dataforseo",
    endpoint: "/v3/dataforseo_labs/google/ranked_keywords/live",
    attribution: { label: "Data by DataForSEO", href: "https://dataforseo.com/" },
    byMarket: true,
    worldwide: true,
    subject: "page",
    /**
     * Measured 2026-10-29: a full URL as the target, with no location, gave
     * 1,183 keywords for one anthropic.com post at $0.015 for 25 rows. The
     * target must keep its scheme; the same call takes a bare domain for the
     * whole site.
     */
    buildInput: (url, market) => ({ target: url, ...placeOf(market), limit: 25 }),
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
    id: "ai-citations",
    title: "AI search citations",
    blurb:
      "How many AI answers cite this domain, and from how many of its pages, in the Ahrefs index — per platform. Zero is an answer: the index holds the platform and found nothing.",
    provider: "ahrefs",
    endpoint: "/v3/site-explorer/ai-responses-count",
    attribution: { label: "Data by Ahrefs", href: "https://ahrefs.com/" },
    // subdomains: the whole site, the way the DR lookup reads it.
    buildInput: (domain) => ({ target: domain, mode: "subdomains" }),
    /**
     * Measured 2026-10-13: {ai_responses_count:{all_platforms:{pages,citations},
     * chatgpt:{…}, perplexity:{…}, gemini:{…}, google_ai_overviews:{…},
     * google_ai_mode:{…}, copilot:{…}, grok:{…}}}.
     */
    extract: (output) => {
      const counts = (output as { ai_responses_count?: Record<string, unknown> } | null)
        ?.ai_responses_count;
      if (!counts) return [];
      const all = counts["all_platforms"] as Record<string, unknown> | undefined;
      if (typeof all?.["citations"] !== "number") return [];
      const fields: LookupField[] = [
        { label: "AI citations", value: compact(all["citations"]) },
        { label: "Pages cited", value: compact(all["pages"]) },
      ];
      // Every platform, zeros included, with both of its numbers: a zero is an
      // answer, and pages cited is half of what the Provider reports.
      for (const [key, label] of AI_PLATFORMS) {
        const platform = counts[key] as Record<string, unknown> | undefined;
        if (typeof platform?.["citations"] !== "number") continue;
        fields.push({ label, value: compact(platform["citations"]) });
        fields.push({ label: `${label} pages`, value: compact(platform["pages"]) });
      }
      return fields;
    },
  },
  {
    id: "company",
    title: "Company",
    blurb: "Who is behind the domain, as Hunter records it.",
    provider: "hunter",
    endpoint: "/v2/companies/find",
    attribution: { label: "Data by Hunter", href: "https://hunter.io/" },
    layout: "facts",
    buildInput: (domain) => ({ domain: registrableDomain(domain) }),
    /**
     * Measured 2026-10-13 (dataforseo.com, surething.io): {data:{name,
     * legalName, description, location, foundedYear, companyType, phone,
     * site:{phoneNumbers, emailAddresses}, category:{sector, industry},
     * metrics:{employees, employeesCount, raised, annualRevenue,
     * estimatedAnnualRevenue, trafficRank}, tags, tech, emailProvider,
     * timeZone, parent:{domain}, linkedin/twitter/facebook/instagram/youtube/
     * crunchbase:{handle}}}.
     *
     * Every field Hunter fills is shown. The first version picked nine and
     * dropped the rest — phone, email, industry, Facebook, Hunter's own
     * technology list — so the card looked thinner than the record was.
     * Links are written as full https URLs so the card can open them.
     */
    extract: (output) => {
      const data = (output as { data?: Record<string, unknown> } | null)?.data;
      if (!data || typeof data["name"] !== "string") return [];
      const metrics = (data["metrics"] ?? {}) as Record<string, unknown>;
      const category = (data["category"] ?? {}) as Record<string, unknown>;
      const site = (data["site"] ?? {}) as Record<string, unknown>;
      const handle = (key: string): string | null => {
        const value = (data[key] as Record<string, unknown> | undefined)?.["handle"];
        return typeof value === "string" && value !== "" ? value : null;
      };
      const list = (value: unknown): string =>
        Array.isArray(value)
          ? value
              .filter((item): item is string => typeof item === "string" && item !== "")
              .join(", ") || "—"
          : "—";
      const employees =
        typeof metrics["employeesCount"] === "number"
          ? `${metrics["employeesCount"]}${typeof metrics["employees"] === "string" ? ` (${metrics["employees"]})` : ""}`
          : text(metrics["employees"]);
      const phones = [
        ...new Set(
          [
            data["phone"],
            ...(Array.isArray(site["phoneNumbers"]) ? site["phoneNumbers"] : []),
          ].filter((item): item is string => typeof item === "string" && item !== ""),
        ),
      ];
      const social = (key: string, base: string) => {
        const value = handle(key);
        return value ? `${base}${value}` : "—";
      };
      const legal = text(data["legalName"]);
      const parent = (data["parent"] as Record<string, unknown> | undefined)?.["domain"];
      const revenue = text(metrics["estimatedAnnualRevenue"] ?? metrics["annualRevenue"]);
      const raised = typeof metrics["raised"] === "number" ? `$${compact(metrics["raised"])}` : "—";
      const trafficRank =
        typeof metrics["trafficRank"] === "string"
          ? metrics["trafficRank"].replace(/_/g, " ")
          : "—";
      return [
        { label: "Name", value: data["name"] as string },
        { label: "Legal name", value: legal === data["name"] ? "—" : legal },
        { label: "About", value: text(data["description"]) },
        { label: "Industry", value: text(category["industry"] ?? category["sector"]) },
        { label: "Sector", value: category["industry"] ? text(category["sector"]) : "—" },
        { label: "Location", value: text(data["location"]) },
        { label: "Time zone", value: text(data["timeZone"]) },
        { label: "Founded", value: text(data["foundedYear"]) },
        { label: "Employees", value: employees },
        { label: "Type", value: text(data["companyType"]) },
        { label: "Revenue", value: revenue },
        { label: "Raised", value: raised },
        { label: "Parent company", value: text(parent) },
        { label: "Ticker", value: text(data["ticker"]) },
        { label: "Phone", value: phones.length ? phones.join(", ") : "—" },
        { label: "Email", value: list(site["emailAddresses"]) },
        { label: "Email provider", value: text(data["emailProvider"]) },
        { label: "Website", value: `https://${text(data["domain"])}` },
        { label: "LinkedIn", value: social("linkedin", "https://www.linkedin.com/") },
        { label: "X", value: social("twitter", "https://x.com/") },
        { label: "Facebook", value: social("facebook", "https://www.facebook.com/") },
        { label: "Instagram", value: social("instagram", "https://www.instagram.com/") },
        { label: "YouTube", value: social("youtube", "https://www.youtube.com/") },
        { label: "Crunchbase", value: social("crunchbase", "https://www.crunchbase.com/") },
        { label: "Tags", value: list(data["tags"]) },
        { label: "Technologies", value: list(data["tech"]) },
        { label: "Traffic level", value: trafficRank },
      ].filter((field) => field.value !== "—" && field.value !== "https://—");
    },
  },
  {
    id: "technologies",
    title: "Technologies",
    blurb: "What the site is built and served with, as DataForSEO last saw it.",
    provider: "dataforseo",
    endpoint: "/v3/domain_analytics/technologies/domain_technologies/live",
    attribution: { label: "Data by DataForSEO", href: "https://dataforseo.com/" },
    layout: "facts",
    buildInput: (domain) => ({ target: domain }),
    /**
     * Measured 2026-10-13: tasks[].result[] carries technologies as a
     * two-level map, group → category → [names] ({servers:{cdn:["Cloudflare"]},
     * marketing:{rum:[…]}, …}), beside title, description, emails,
     * phone_numbers, social_graph_urls, country_iso_code, language_code and
     * last_visited.
     *
     * Every category is listed, even when a name recurs under two of them: a
     * tool counted as both analytics and real-user monitoring is two facts.
     * The first version kept each name once and so dropped categories, and it
     * left out everything but the technologies.
     */
    extract: (output) => {
      for (const item of walk(output)) {
        const groups = item["technologies"];
        if (groups === null || typeof groups !== "object" || Array.isArray(groups)) continue;
        const byCategory = new Map<string, Set<string>>();
        for (const group of Object.values(groups as Record<string, unknown>)) {
          if (group === null || typeof group !== "object") continue;
          for (const [category, names] of Object.entries(group as Record<string, unknown>)) {
            if (!Array.isArray(names)) continue;
            const bucket = byCategory.get(category) ?? new Set<string>();
            for (const name of names) if (typeof name === "string") bucket.add(name);
            if (bucket.size) byCategory.set(category, bucket);
          }
        }
        if (byCategory.size === 0) return [];
        const list = (value: unknown): string =>
          Array.isArray(value)
            ? value
                .filter((entry): entry is string => typeof entry === "string" && entry !== "")
                .join(", ") || "—"
            : "—";
        const scanned =
          typeof item["last_visited"] === "string" ? item["last_visited"].slice(0, 10) : "—";
        return [
          ...[...byCategory].map(([category, names]) => ({
            label: categoryName(category),
            value: [...names].join(", "),
          })),
          { label: "Page title", value: text(item["title"]) },
          { label: "Meta description", value: text(item["description"]) },
          { label: "Social links", value: list(item["social_graph_urls"]) },
          { label: "Email", value: list(item["emails"]) },
          { label: "Phone", value: list(item["phone_numbers"]) },
          { label: "Country", value: text(item["country_iso_code"]) },
          {
            label: "Language",
            value: text(item["content_language_code"] ?? item["language_code"]),
          },
          { label: "Last scanned", value: scanned },
        ].filter((field) => field.value !== "—");
      }
      return [];
    },
  },
];

/** The platforms Ahrefs reports, in the order the card lists them. */
const AI_PLATFORMS: readonly (readonly [string, string])[] = [
  ["chatgpt", "ChatGPT"],
  ["perplexity", "Perplexity"],
  ["google_ai_overviews", "Google AI Overviews"],
  ["google_ai_mode", "Google AI Mode"],
  ["gemini", "Gemini"],
  ["copilot", "Copilot"],
  ["grok", "Grok"],
];

type SemrushMonth = {
  readonly date: string;
  readonly organic: number;
  readonly keywords: number;
  readonly rank: number | null;
};

/** Semrush rows, newest first as sent. "20260915" names the month and is
    pinned to its first day so the chart treats it as a month. */
function semrushMonths(output: unknown): readonly SemrushMonth[] {
  const rows = (output as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const months: SemrushMonth[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const raw = typeof record["Date"] === "string" ? record["Date"] : "";
    if (!/^\d{8}$/.test(raw)) continue;
    const organic = number(record["Organic Traffic"]);
    if (organic === null) continue;
    months.push({
      date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-01`,
      organic,
      keywords: number(record["Organic Keywords"]) ?? 0,
      rank: number(record["Rank"]),
    });
  }
  return months;
}

/** "javascript_libraries" becomes "JavaScript libraries"; "cms" stays an
    acronym. */
function categoryName(key: string): string {
  const ACRONYMS: Record<string, string> = {
    cms: "CMS",
    cdn: "CDN",
    javascript_libraries: "JavaScript libraries",
    seo: "SEO",
    miscellaneous: "Other",
    rum: "Real user monitoring",
  };
  if (ACRONYMS[key]) return ACRONYMS[key];
  const words = key.replace(/_+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function number(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() !== "" ? value : "—";
}

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

/**
 * Measured 2026-10-29: tasks[].result[].items[] holds {domain, intersections,
 * avg_position, metrics:{organic:{etv,count}}, full_domain_metrics:{…}}.
 * metrics counts only the keywords shared with the target;
 * full_domain_metrics is the competitor's whole site. The first item is the
 * target itself, which is not its own competitor.
 */
export function extractCompetitors(output: unknown): readonly RankedRow[] {
  const target = resultTarget(output);
  const rows: RankedRow[] = [];
  for (const item of walk(output)) {
    const domain = item["domain"];
    if (typeof domain !== "string" || item["intersections"] === undefined) continue;
    if (domain === target) continue;
    const full = item["full_domain_metrics"] as Record<string, unknown> | undefined;
    const organic = full?.["organic"] as Record<string, unknown> | undefined;
    rows.push({
      name: domain,
      visits: finite(organic?.["etv"]),
      keywords: finite(item["intersections"]),
    });
  }
  return rows;
}

/** Measured 2026-10-29: items[] holds {page_address, metrics:{organic:{etv,
    count}}}, in the order the input asked for. */
export function extractPages(output: unknown): readonly RankedRow[] {
  const rows: RankedRow[] = [];
  for (const item of walk(output)) {
    const page = item["page_address"];
    if (typeof page !== "string") continue;
    const metrics = item["metrics"] as Record<string, unknown> | undefined;
    const organic = metrics?.["organic"] as Record<string, unknown> | undefined;
    rows.push({
      name: page,
      visits: finite(organic?.["etv"]),
      keywords: finite(organic?.["count"]),
    });
  }
  return rows;
}

function resultTarget(output: unknown): string | null {
  for (const item of walk(output)) {
    if (typeof item["target"] === "string" && Array.isArray(item["items"])) return item["target"];
  }
  return null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Preserve numeric keyword data; older cached fields remain readable. */
/**
 * An all-countries answer lists a keyword once per country (measured
 * 2026-10-29: "anthropic ai assistant" three times, with 14,800, 1,900 and 110
 * searches). Each keyword is one row: the country where it brings the most
 * traffic, named under the keyword. The figures are **not** added up: the
 * limit cuts the list at 25 rows, so the other countries are a sample, and a
 * sum of them would read as a worldwide total it is not.
 */
export function extractKeywords(output: unknown): readonly KeywordRow[] {
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const worldwide = walkResults(output).some(
    (result) => "location_code" in result && result["location_code"] === null,
  );
  const rows = new Map<string, KeywordRow>();
  for (const item of walk(output)) {
    const data = item["keyword_data"] as
      | {
          keyword?: unknown;
          location_code?: unknown;
          keyword_info?: { search_volume?: unknown; cpc?: unknown };
        }
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
    const row: KeywordRow = {
      keyword: data.keyword,
      position,
      monthlyVolume: num(data.keyword_info?.search_volume),
      traffic: num(serp?.serp_item?.etv),
      cpc: num(data.keyword_info?.cpc),
      ...(worldwide ? { country: countryName(data.location_code) } : {}),
    };
    const seen = rows.get(row.keyword);
    if (seen ? (row.traffic ?? -1) > (seen.traffic ?? -1) : rows.size < 25)
      rows.set(row.keyword, row);
  }
  return [...rows.values()];
}

/** DataForSEO location codes are 2000 plus the ISO 3166 numeric code. */
function countryName(code: unknown): string {
  return COUNTRIES.find((country) => country.locationCode === code)?.name ?? "Another country";
}

function walkResults(output: unknown): Record<string, unknown>[] {
  const tasks = (output as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks.flatMap((task) => {
    const result = (task as { result?: unknown } | null)?.result;
    return Array.isArray(result)
      ? result.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      : [];
  });
}
