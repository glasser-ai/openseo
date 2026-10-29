import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_MARKET } from "../../domain/markets.js";
import { lookupTarget, type PageFacts } from "../../domain/page.js";
import { KeywordTable, keywordDisplay } from "../KeywordTable.js";
import type { Tab } from "../navigation.js";
import { Report } from "../Report.js";
import { usePage } from "../usePage.js";
import { useReport } from "../useReport.js";

let root: Root;
let container: HTMLElement;
let send: ReturnType<
  typeof vi.fn<(message: { type: string; lookup?: string; market?: string }) => Promise<unknown>>
>;
let resolveRun: ((value: unknown) => void) | undefined;
const saved = {
  payload: { kind: "fields", fields: [{ label: "Domain Rating", value: "42" }] },
  fetchedAt: Date.now(),
  runUrl: "https://example.test/run",
  chargeUsd: null,
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scanned = {
    ...pageFacts,
    url: "https://example.com/blog",
    canonical: "https://example.com/blog",
  };
  send = vi.fn(async (message) => {
    if (message.type === "openseo:settings") return { ok: true };
    if (message.type === "openseo:peek") return message.lookup === "domain-rating" ? saved : null;
    if (message.type === "openseo:peek-traffic") return null;
    if (message.type === "openseo:page") return { kind: "ok", facts: scanned };
    if (message.type === "openseo:lookup")
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    return null;
  });
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: send, getURL: (path: string) => path },
    tabs: { create: vi.fn() },
    storage: {
      local: {
        get: async () => ({ "openseo:settings": { paidAcknowledged: false } }),
        set: vi.fn(),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const pageFacts: PageFacts = {
  url: "https://example.com/",
  title: "Example: a title long enough for the check",
  description: null,
  canonical: "https://example.com/",
  metaRobots: "",
  lang: "en",
  viewport: true,
  h1: ["Example"],
  h2: 2,
  h3: 0,
  images: 0,
  imagesWithoutAlt: 0,
  words: 120,
  hreflang: 0,
  schemaTypes: [],
  ogTitle: false,
  ogImage: false,
  robots: { kind: "found", text: "User-agent: GPTBot\nDisallow: /\n" },
};

let scanned: PageFacts;

/** Use the same report state owner, and the same scan, as the panel. */
const onMarket = vi.fn();
function Harness(props: { domain: string; hasKey: boolean; tab: Tab; address: string }) {
  const { scan, fresh } = usePage(
    props.tab === "page" || props.tab === "ai" ? props.tab : null,
    props.address,
  );
  const target = scan.kind === "ok" ? lookupTarget(scan.facts) : null;
  const report = useReport(
    props.domain,
    props.hasKey,
    DEFAULT_MARKET.id,
    target?.kind === "ok" ? target.url : "",
  );
  return createElement(Report, {
    domain: props.domain,
    hasKey: props.hasKey,
    tab: props.tab,
    market: DEFAULT_MARKET,
    onMarket,
    onTab: vi.fn(),
    onSettings: vi.fn(),
    report,
    scan,
    fresh,
    target,
  });
}

async function render(hasKey = true, tab: Tab = "backlinks", address = "https://example.com/blog") {
  await act(async () => {
    root.render(createElement(Harness, { domain: "example.com", hasKey, tab, address }));
  });
}
it("reads saved results without a Key and sends no purchase", async () => {
  await render(false);
  expect(container.textContent).toContain("42");
  expect(container.textContent).toContain("Charge unknown");
  expect(send.mock.calls.some(([message]) => /^openseo:(lookup|traffic)$/.test(message.type))).toBe(
    false,
  );
});
it("keeps saved data visible during a failed refresh and prevents duplicate clicks", async () => {
  await render();
  const refresh = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Refresh"),
  )!;
  await act(async () => {
    refresh.click();
    refresh.click();
  });
  expect(container.textContent).toContain("42");
  expect(
    send.mock.calls.filter(
      ([message]) => message.type === "openseo:lookup" && message.lookup === "domain-rating",
    ),
  ).toHaveLength(1);
  await act(async () => {
    resolveRun?.({ ok: false, reason: "Request failed" });
  });
  expect(container.textContent).toContain("42");
  expect(container.textContent).toContain("Request failed");
  // Retry in place on failure, rather than sending someone off to a settings
  // section.
  expect(container.textContent).toContain("Try again");
});
it("fetches a section with no saved result on open, without a second attempt", async () => {
  await render();
  const auto = () =>
    send.mock.calls.filter(
      ([message]) => message.type === "openseo:lookup" && message.lookup === "backlinks",
    );
  expect(auto()).toHaveLength(1);
  await act(async () => {
    resolveRun?.({ ok: false, reason: "Request failed" });
  });
  // No automatic retry after a failure — otherwise flicking between tabs buys
  // the same miss over and over.
  expect(auto()).toHaveLength(1);
});
it("fetches immediately even when legacy settings disabled automatic fetching", async () => {
  await render();
  expect(send.mock.calls.filter(([message]) => message.type === "openseo:lookup")).toHaveLength(1);
  expect(container.textContent).not.toContain("Enable automatic fetching");
  expect(container.textContent).not.toContain("This spends your balance");
});
it("never fetches anything without a Key", async () => {
  await render(false);
  expect(send.mock.calls.some(([message]) => /^openseo:(lookup|traffic)/.test(message.type))).toBe(
    false,
  );
});
it("displays legacy keyword position and volume without inventing missing values", () => {
  expect(
    keywordDisplay([
      { label: "a", value: "#3 · 12K/mo" },
      { label: "b", value: "#4" },
    ]),
  ).toEqual([
    // A legacy cache holds only the formatted "#3 · 12K/mo", with no traffic and
    // no cpc — so leave dashes rather than invent them.
    { keyword: "a", position: "3", traffic: "—", volume: "12K", cpc: "—" },
    { keyword: "b", position: "4", traffic: "—", volume: "—", cpc: "—" },
  ]);
});

it("automatically fetches missing results without price approval", async () => {
  await render();
  const purchases = send.mock.calls.filter(([message]) => message.type === "openseo:lookup");
  expect(purchases).toHaveLength(1);
  expect(purchases[0]?.[0]).toMatchObject({ lookup: "backlinks", force: false });
});
/*
 * The overview displays five rows and has to buy **all five**.
 *
 * It once bought three of them, leaving Backlinks and Ranking keywords on an em
 * dash no fetch would ever replace — a permanent loading state for reports
 * nobody had ordered. Trim SECTIONS.overview.ids back to the cheap three and
 * this goes red.
 */
it("buys every summary row when the overview opens", async () => {
  await render(true, "overview");
  const bought = send.mock.calls
    .filter(([message]) => message.type === "openseo:lookup")
    .map(([message]) => message.lookup);
  // domain-rating has a saved result in the harness, so it is reused, not bought.
  expect(new Set(bought)).toEqual(new Set(["organic-traffic", "backlinks", "ranked-keywords"]));
  expect(send.mock.calls.filter(([message]) => message.type === "openseo:traffic")).toHaveLength(1);
  expect(
    send.mock.calls
      .filter(([message]) => /^openseo:(lookup|traffic)$/.test(message.type))
      .every(([message]) => (message as { force?: boolean }).force === false),
  ).toBe(true);
});
it("names the missing Key rather than leaving a summary row on an em dash", async () => {
  await render(false, "overview");
  const row = Array.from(container.querySelectorAll("li button")).find((button) =>
    button.textContent?.startsWith("Ranking keywords"),
  )!;
  expect(row.textContent).toContain("Needs a Key");
});
it("shows Backlinks rather than referring domains in the summary", async () => {
  const original = send.getMockImplementation()!;
  send.mockImplementation(async (message) =>
    message.type === "openseo:peek" && message.lookup === "backlinks"
      ? {
          ...saved,
          payload: {
            kind: "fields",
            fields: [
              { label: "Referring domains", value: "2.5K" },
              { label: "Backlinks", value: "41.2K" },
            ],
          },
        }
      : original(message),
  );
  await render(true, "overview");
  const row = Array.from(container.querySelectorAll("li button")).find((button) =>
    button.textContent?.startsWith("Backlinks"),
  )!;
  expect(row.textContent).toContain("41.2K");
  expect(row.textContent).not.toContain("2.5K");
});
it("automatically refreshes outdated results", async () => {
  const original = send.getMockImplementation()!;
  send.mockImplementation(async (message) =>
    message.type === "openseo:peek" && message.lookup === "domain-rating"
      ? {
          ...saved,
          fetchedAt: Date.now() - 8 * 86400_000,
        }
      : original(message),
  );
  await render();
  expect(send.mock.calls.filter(([message]) => message.type === "openseo:lookup")).toHaveLength(2);
});

it("keeps automatic renewal distinct from an explicit paid refresh", async () => {
  const original = send.getMockImplementation()!;
  send.mockImplementation(async (message) =>
    message.type === "openseo:peek" && message.lookup === "domain-rating"
      ? { ...saved, fetchedAt: Date.now() - 8 * 86400_000 }
      : original(message),
  );
  await render();
  const automatic = send.mock.calls.filter(([message]) => message.type === "openseo:lookup");
  expect(automatic.every(([message]) => (message as { force?: boolean }).force === false)).toBe(
    true,
  );
});

/*
 * The meter's table (BOUNDED in Report.tsx) is keyed on the **display label**,
 * and those labels are literals produced by the extract functions in lookups.ts.
 * Change one there and forget this, and the meter silently disappears.
 *
 * So this test does not hand-write fields but has the real extract produce them
 * from a Provider-shaped response — rename a label and this goes red at once.
 */
it("keeps the spam score meter wired to the label the extractor emits", async () => {
  const { LOOKUPS } = await import("../../domain/lookups.js");
  const backlinks = LOOKUPS.find((lookup) => lookup.id === "backlinks");
  const fields = backlinks?.extract({
    tasks: [
      {
        result: [{ referring_domains: 12, backlinks: 34, backlinks_spam_score: 72 }],
      },
    ],
  });
  expect(fields?.some((field) => field.label === "Spam score")).toBe(true);

  send.mockImplementation(async (message: { type: string; lookup?: string }) => {
    if (message.type === "openseo:settings") return { ok: true };
    if (message.type === "openseo:peek")
      return message.lookup === "backlinks"
        ? { ...saved, payload: { kind: "fields", fields } }
        : null;
    return null;
  });

  await render();
  const meter = container.querySelector('[role=meter][aria-label="Spam score"]');
  expect(meter?.getAttribute("data-tone")).toBe("bad");
});

/*
 * The table sorts by the traffic a keyword brings, descending, rather than in
 * the Provider's order.
 * It sorts on the raw numbers: the rendered forms are `12K` and `1,140`, which
 * compare as text in an order that puts 9 above 12K.
 */
it("orders keywords by monthly volume, biggest first", () => {
  const shown = keywordDisplay(
    [],
    [
      { keyword: "hi-volume-no-traffic", position: 41, monthlyVolume: 12_000, traffic: 3 },
      { keyword: "earner", position: 2, monthlyVolume: 140, traffic: 900 },
      { keyword: "second", position: 4, monthlyVolume: 140, traffic: 120 },
      { keyword: "untracked", position: 12, monthlyVolume: null, traffic: null },
    ],
  );
  // The highest-volume term sorts **last**: at position 41 it brings nobody.
  expect(shown.map((row) => row.keyword)).toEqual([
    "earner", // 900 visits
    "second", // 120
    "hi-volume-no-traffic", // 3, despite 12,000 searches
    "untracked", // nothing to go on
  ]);
  expect(shown[0]?.traffic).toBe("900");
  expect(shown[0]?.volume).toBe("140");
});

it("falls back to volume when a cached row has no traffic figure", () => {
  const shown = keywordDisplay(
    [],
    [
      { keyword: "small", position: 3, monthlyVolume: 9 },
      { keyword: "large", position: 7, monthlyVolume: 12_000 },
    ],
  );
  // 9 must not sort above 12,000 — that is what comparing the formatted strings
  // produces.
  expect(shown.map((row) => row.keyword)).toEqual(["large", "small"]);
});

it("orders legacy cached rows by volume too", () => {
  const shown = keywordDisplay([
    { label: "small", value: "#2 · 9/mo" },
    { label: "large", value: "#7 · 12K/mo" },
    { label: "none", value: "#1" },
  ]);
  expect(shown.map((row) => row.keyword)).toEqual(["large", "small", "none"]);
});

/* A 0 is measured (nobody advertises on that term); a dash means there is no
   such figure. The two cannot share one symbol. */
it("tells a zero CPC apart from a missing one", () => {
  const shown = keywordDisplay(
    [],
    [
      { keyword: "nobody bids", position: 1, monthlyVolume: 10, traffic: 5, cpc: 0 },
      { keyword: "unknown", position: 2, monthlyVolume: 10, traffic: 4 },
    ],
  );
  expect(shown.find((row) => row.keyword === "nobody bids")?.cpc).toBe("$0.00");
  expect(shown.find((row) => row.keyword === "unknown")?.cpc).toBe("—");
});

/*
 * A count of broken links means nothing on its own — 82.2M is alarming, but it
 * is 2.6% of 3.1B. Ahrefs' own link-rot study puts 66.5% of links as rotted, and
 * the sources decline to name an acceptable ratio, so this one is not banded and
 * gets a denominator instead.
 */
it("gives broken backlinks a denominator instead of a colour", async () => {
  const fields = [
    { label: "Referring domains", value: "2.3M" },
    { label: "Backlinks", value: "3.1B" },
    { label: "Broken backlinks", value: "82.2M" },
  ];
  send.mockImplementation(async (message: { type: string; lookup?: string }) => {
    if (message.type === "openseo:settings") return { ok: true };
    if (message.type === "openseo:peek")
      return message.lookup === "backlinks"
        ? { ...saved, payload: { kind: "fields", fields } }
        : null;
    return null;
  });
  await render();
  expect(container.textContent).toContain("Broken backlinks · 2.7%");
  // 2.7% is not a fault, so the figure takes no colour.
  const broken = [...container.querySelectorAll("div")].find(
    (node) => node.textContent === "82.2M",
  );
  expect(broken?.className).not.toMatch(/text-(bad|warn|good)-text/);
});

/*
 * The caption must not present "the 25 the Provider sent" as "the top 25 by
 * traffic".
 *
 * The endpoint's input schema is additionalProperties: false over target,
 * location_code, language_code and limit — there is no order_by to send. So the
 * Provider truncates to 25 in its own order and we only reorder those 25. The
 * selection is theirs and the ordering is ours, and the caption says both.
 */
const captionOf = async (keywords?: Parameters<typeof keywordDisplay>[1]) => {
  await act(async () =>
    root.render(createElement(KeywordTable, { rows: [], ...(keywords ? { keywords } : {}) })),
  );
  return container.querySelector("caption")?.textContent ?? "";
};

it("says whose selection the rows are, and what they are sorted by", async () => {
  const caption = await captionOf([
    { keyword: "a", position: 1, monthlyVolume: 100, traffic: 40 },
    { keyword: "b", position: 9, monthlyVolume: 90, traffic: 10 },
  ]);
  expect(caption).toContain("Provider's selection");
  expect(caption).toContain("sorted by traffic");
});

/* A legacy cache carries no traffic and really does sort by volume — so the
   caption has to say volume rather than keep claiming traffic. */
it("names monthly volume when no row carries a traffic figure", async () => {
  const caption = await captionOf([
    { keyword: "a", position: 1, monthlyVolume: 100 },
    { keyword: "b", position: 9, monthlyVolume: 90 },
  ]);
  expect(caption).toContain("sorted by monthly volume");
});

/* Search starts on all countries and lets a user narrow it; the request
   carries the market to the worker. Reports with no worldwide answer say they
   read one country, so a US figure is not taken for the site's total. */
it("starts Search on all countries and sends the market with each lookup", async () => {
  onMarket.mockReset();
  await render(true, "search");
  const select = container.querySelector("select")!;
  expect(select.value).toBe("all");
  expect(container.textContent).toContain("All countries");
  expect(container.textContent).toContain("United States only");
  expect(container.textContent).toContain("Search competitors");
  expect(container.textContent).toContain("Top pages");
  const lookups = send.mock.calls
    .map(([message]) => message)
    .filter((message) => message.type === "openseo:lookup");
  expect(lookups.map((message) => message.lookup)).toEqual(
    expect.arrayContaining(["competitors", "top-pages", "organic-traffic"]),
  );
  expect(lookups.every((message) => message.market === "all")).toBe(true);
  await act(async () => {
    select.value = "br";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onMarket).toHaveBeenCalledWith("br");
});

it("has no country picker on sections that do not depend on it", async () => {
  await render(true, "backlinks");
  expect(container.querySelector("select")).toBeNull();
});

/* The checks read the page, not a Provider: free and there without a Key,
   above the prompt for one. */
it("shows page checks without a Key, above the Key prompt, and buys nothing", async () => {
  await render(false, "page");
  const text = container.textContent ?? "";
  expect(text).toContain("Indexable");
  expect(text).toContain("Description");
  expect(text.indexOf("Indexable")).toBeLessThan(text.indexOf("Add your glasser Key"));
  expect(send.mock.calls.filter(([message]) => message.type === "openseo:page")).toHaveLength(1);
  expect(send.mock.calls.some(([message]) => /^openseo:(lookup|traffic)$/.test(message.type))).toBe(
    false,
  );
});

const pageLookups = () =>
  send.mock.calls
    .map(([message]) => message as { type: string; lookup?: string; domain?: string })
    .filter((message) => message.type === "openseo:lookup" && message.lookup === "page-keywords");

/* The page's keywords are asked about the scanned page, not the domain. */
it("looks up the page's keywords for the scanned page", async () => {
  await render(true, "page");
  expect(pageLookups()).toEqual([expect.objectContaining({ domain: "https://example.com/blog" })]);
  expect(container.textContent).toContain("/blog · All countries");
});

const pageCard = () =>
  [...container.querySelectorAll("section")].find((section) =>
    section.querySelector("h2")?.textContent?.includes("This page's keywords"),
  );

/* Review: the page's request started in the same commit as the reset for the
   new page, which cleared its running state, so a paid request ran behind an
   empty card. */
it("shows the page's request as running while it is bought", async () => {
  await render(true, "page");
  expect(pageLookups()).toHaveLength(1);
  expect(pageCard()?.textContent).toContain("Fetching");
  expect(pageCard()?.querySelector(".animate-pulse")).not.toBeNull();
});

/* Review: the AI tab scanned /a, then the app moved to /b with no new address.
   The Page tab reads the page again and buys for /b, never from the old scan. */
it("reads the page again on each section visit and buys only from that scan", async () => {
  scanned = { ...pageFacts, url: "https://example.com/a", canonical: null };
  await render(true, "ai", "https://example.com/app");
  scanned = { ...pageFacts, url: "https://example.com/b", canonical: null };
  await render(true, "page", "https://example.com/app");
  expect(send.mock.calls.filter(([message]) => message.type === "openseo:page")).toHaveLength(2);
  expect(pageLookups().map((message) => message.domain)).toEqual(["https://example.com/b"]);
});

/* Review: a single-page app moved from /a to /b. A new address scans again,
   and the keywords follow the new scan rather than the panel's first one. */
it("scans again and buys for the new page when the address changes", async () => {
  await render(true, "page", "https://example.com/a");
  scanned = { ...pageFacts, url: "https://example.com/b", canonical: null };
  await render(true, "page", "https://example.com/b");
  expect(send.mock.calls.filter(([message]) => message.type === "openseo:page")).toHaveLength(2);
  expect(pageLookups().map((message) => message.domain)).toEqual([
    "https://example.com/blog",
    "https://example.com/b",
  ]);
});

/* Review: /?p=123 and /?p=456 are different pages. Without a canonical to say
   which, nothing is bought, and the reason is shown. */
it("buys nothing for a query-string page with no canonical", async () => {
  scanned = { ...pageFacts, url: "https://example.com/?p=123&utm_source=x", canonical: null };
  await render(true, "page", "https://example.com/?p=123");
  expect(pageLookups()).toEqual([]);
  expect(container.textContent).toContain("cannot tell which page to look up");
});

it("puts AI crawler access above the citations", async () => {
  await render(true, "ai");
  const text = container.textContent ?? "";
  expect(text).toContain("AI crawler access");
  expect(text).toContain("5/6Training crawlers allowed");
  expect(text.indexOf("AI crawler access")).toBeLessThan(text.indexOf("AI search citations"));
  const gpt = [...container.querySelectorAll("tr")].find((row) =>
    row.textContent?.startsWith("GPTBot"),
  );
  expect(gpt?.textContent).toContain("Blocked");
});

it("does not read the page for sections that do not need it", async () => {
  await render(true, "backlinks");
  expect(send.mock.calls.some(([message]) => message.type === "openseo:page")).toBe(false);
});
