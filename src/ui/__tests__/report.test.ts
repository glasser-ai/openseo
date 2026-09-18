import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KeywordTable, keywordDisplay } from "../KeywordTable.js";
import type { Tab } from "../navigation.js";
import { Report } from "../Report.js";
import { useReport } from "../useReport.js";

let root: Root;
let container: HTMLElement;
let send: ReturnType<
  typeof vi.fn<(message: { type: string; lookup?: string }) => Promise<unknown>>
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
  send = vi.fn(async (message) => {
    if (message.type === "openseo:settings") return { ok: true };
    if (message.type === "openseo:peek") return message.lookup === "domain-rating" ? saved : null;
    if (message.type === "openseo:peek-traffic") return null;
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
/** Use the same report state owner as the panel. */
function Harness(props: { domain: string; hasKey: boolean; tab: Tab }) {
  const report = useReport(props.domain, props.hasKey);
  return createElement(Report, { ...props, onTab: vi.fn(), onSettings: vi.fn(), report });
}

async function render(hasKey = true, tab: Tab = "backlinks") {
  await act(async () => {
    root.render(createElement(Harness, { domain: "example.com", hasKey, tab }));
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
