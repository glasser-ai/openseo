import { expect, it } from "vitest";
import { LOOKUPS } from "../lookups.js";

const lookup = (id: string) => LOOKUPS.find((item) => item.id === id)!;

/*
 * Fixtures measured 2026-10-13 against dataforseo.com, one Run each:
 * ahrefs f67e9933, semrush 26dd54b5, dataforseo 7bbe97e6, hunter 9034a048.
 * These are the Providers' real shapes, so a rename upstream fails here rather
 * than as a silently empty card.
 */

it("reads AI citations for every platform, all platforms first", () => {
  const output = {
    ai_responses_count: {
      grok: { pages: 0, citations: 0 },
      gemini: { pages: 18, citations: 11 },
      chatgpt: { pages: 31, citations: 28 },
      copilot: { pages: 17, citations: 9 },
      perplexity: { pages: 104, citations: 107 },
      all_platforms: { pages: 453, citations: 916 },
      google_ai_mode: { pages: 27, citations: 19 },
      google_ai_overviews: { pages: 33, citations: 16 },
    },
  };
  const fields = lookup("ai-citations").extract(output);
  expect(fields[0]).toEqual({ label: "AI citations", value: "916" });
  expect(fields[1]).toEqual({ label: "Pages cited", value: "453" });
  expect(fields.map((field) => field.label).slice(2)).toEqual([
    "ChatGPT",
    "ChatGPT pages",
    "Perplexity",
    "Perplexity pages",
    "Google AI Overviews",
    "Google AI Overviews pages",
    "Google AI Mode",
    "Google AI Mode pages",
    "Gemini",
    "Gemini pages",
    "Copilot",
    "Copilot pages",
    "Grok",
    "Grok pages",
  ]);
  expect(fields).toContainEqual({ label: "Perplexity pages", value: "104" });
  // Zero is an answer, not an absence: the platform is indexed and cites nothing.
  expect(fields.find((field) => field.label === "Grok")?.value).toBe("0");
  expect(lookup("ai-citations").buildInput("docs.example.com")).toEqual({
    target: "docs.example.com",
    mode: "subdomains",
  });
});

it("treats a missing all-platforms block as no result", () => {
  expect(lookup("ai-citations").extract({ ai_responses_count: {} })).toEqual([]);
  expect(lookup("ai-citations").extract(null)).toEqual([]);
});

const SEMRUSH = {
  data: [
    { Date: "20260915", Rank: "130393", "Organic Traffic": "14289", "Organic Keywords": "22193" },
    { Date: "20260815", Rank: "84455", "Organic Traffic": "23528", "Organic Keywords": "18743" },
    { Date: "20251015", Rank: "334235", "Organic Traffic": "4758", "Organic Keywords": "5358" },
  ],
};

it("reads the newest month's search traffic and the change since the oldest", () => {
  const fields = lookup("traffic-history").extract(SEMRUSH);
  expect(fields).toEqual([
    { label: "Organic visits / month", value: "14.3K" },
    { label: "Change over 3 months", value: "+200%" },
    { label: "Organic keywords", value: "22.2K" },
    { label: "Semrush rank", value: "#130.4K" },
  ]);
});

/** Semrush sends newest first; the chart reads oldest first, and the mid-month
    stamp is pinned to the first of its month. */
it("turns the rows into an oldest-first monthly series", () => {
  expect(lookup("traffic-history").extractSeries?.(SEMRUSH)).toEqual([
    { date: "2025-10-01", visits: 4758 },
    { date: "2026-08-01", visits: 23528 },
    { date: "2026-09-01", visits: 14289 },
  ]);
});

it("asks Semrush about the registrable domain, twelve rows at most", () => {
  expect(lookup("traffic-history").buildInput("docs.example.com")).toEqual({
    domain: "example.com",
    database: "us",
    display_limit: 12,
  });
});

it("lists every technology category and the page facts beside them", () => {
  // surething.io, run 1dba1705.
  const output = {
    tasks: [
      {
        result: [
          {
            title: "SureThing — World's First General AI Agency",
            description: "Your AI COO, CMO & Researcher in one team.",
            last_visited: "2026-10-11 08:26:53 +00:00",
            content_language_code: "en",
            social_graph_urls: ["https://twitter.com/getsurething"],
            emails: null,
            technologies: {
              other: { miscellaneous: ["HTTP/3"] },
              servers: { cdn: ["Cloudflare"] },
              analytics: { analytics: ["Cloudflare Browser Insights"] },
              marketing: { rum: ["Cloudflare Browser Insights"] },
            },
          },
        ],
      },
    ],
  };
  const fields = lookup("technologies").extract(output);
  expect(fields).toEqual([
    { label: "Other", value: "HTTP/3" },
    { label: "CDN", value: "Cloudflare" },
    { label: "Analytics", value: "Cloudflare Browser Insights" },
    // The same tool under a second category is a second fact, not a duplicate.
    { label: "Real user monitoring", value: "Cloudflare Browser Insights" },
    { label: "Page title", value: "SureThing — World's First General AI Agency" },
    { label: "Meta description", value: "Your AI COO, CMO & Researcher in one team." },
    { label: "Social links", value: "https://twitter.com/getsurething" },
    { label: "Language", value: "en" },
    { label: "Last scanned", value: "2026-10-11" },
  ]);
  expect(lookup("technologies").layout).toBe("facts");
});

it("reads every field Hunter fills for the company", () => {
  // surething.io, run d34e4a0a.
  const output = {
    data: {
      name: "SureThing",
      legalName: "SureThing",
      domain: "surething.io",
      description: "An autonomous AI agent.",
      location: "94114, San Francisco, California, United States",
      timeZone: "America/Los_Angeles",
      foundedYear: null,
      companyType: "privately held",
      phone: "+1 650 398 6384",
      site: { phoneNumbers: ["+1 650 398 6384"], emailAddresses: ["support@surething.io"] },
      category: { sector: "Information Technology", industry: "Internet Software & Services" },
      metrics: { employees: "1-10", employeesCount: 6, raised: null, trafficRank: "very_low" },
      tags: null,
      tech: ["cloudflare", "google-cloud-cdn", "youtube"],
      emailProvider: "google.com",
      parent: { domain: null },
      linkedin: { handle: "company/surethingio" },
      twitter: { handle: null },
      facebook: { handle: "getsurething" },
    },
  };
  expect(lookup("company").extract(output)).toEqual([
    { label: "Name", value: "SureThing" },
    { label: "About", value: "An autonomous AI agent." },
    { label: "Industry", value: "Internet Software & Services" },
    { label: "Sector", value: "Information Technology" },
    { label: "Location", value: "94114, San Francisco, California, United States" },
    { label: "Time zone", value: "America/Los_Angeles" },
    { label: "Employees", value: "6 (1-10)" },
    { label: "Type", value: "privately held" },
    // Hunter repeats the main number in the site list; it is shown once.
    { label: "Phone", value: "+1 650 398 6384" },
    { label: "Email", value: "support@surething.io" },
    { label: "Email provider", value: "google.com" },
    { label: "Website", value: "https://surething.io" },
    { label: "LinkedIn", value: "https://www.linkedin.com/company/surethingio" },
    { label: "Facebook", value: "https://www.facebook.com/getsurething" },
    { label: "Technologies", value: "cloudflare, google-cloud-cdn, youtube" },
    { label: "Traffic level", value: "very low" },
  ]);
  expect(lookup("company").buildInput("docs.example.com")).toEqual({ domain: "example.com" });
});

it("needs a company name to count as a result", () => {
  expect(lookup("company").extract({ data: { location: "Kyiv" } })).toEqual([]);
  expect(lookup("company").extract({ data: null })).toEqual([]);
});
