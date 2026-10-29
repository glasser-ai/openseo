import { afterEach, expect, it, vi } from "vitest";
import { indexing, onPage, type PageFacts, scanPage } from "../page.js";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("lang");
  vi.unstubAllGlobals();
});

it("reads the facts the checks need, and robots.txt from the same origin", async () => {
  document.documentElement.setAttribute("lang", "en");
  document.head.innerHTML = `
    <title> Example  page </title>
    <meta name="Description" content="About the example.">
    <link rel="canonical" href="/here">
    <meta name="robots" content="NOINDEX">
    <meta property="og:title" content="x">
    <script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":["WebPage","FAQPage"]}]}</script>
    <script type="application/ld+json">{ broken</script>`;
  document.body.innerHTML = `<h1>Main</h1><h2>a</h2><h2>b</h2><img src="a.png" alt=""><img src="b.png"><p>one two three</p>`;
  const fetch = vi.fn(
    async (_url: string) => new Response("User-agent: *\nDisallow: /x", { status: 200 }),
  );
  vi.stubGlobal("fetch", fetch);

  const facts = await scanPage();
  expect(fetch.mock.calls[0]?.[0]).toBe(`${location.origin}/robots.txt`);
  expect(facts).toMatchObject({
    title: "Example page",
    description: "About the example.",
    canonical: `${location.origin}/here`,
    metaRobots: "noindex",
    lang: "en",
    viewport: false,
    h1: ["Main"],
    h2: 2,
    h3: 0,
    images: 2,
    imagesWithoutAlt: 1,
    schemaTypes: ["Organization", "WebPage", "FAQPage"],
    ogTitle: true,
    ogImage: false,
    robots: { kind: "found", text: "User-agent: *\nDisallow: /x" },
  });
  // jsdom has no innerText, so its blocks run together; Chrome splits them.
  expect(facts.words).toBeGreaterThanOrEqual(3);
});

it("keeps a 4xx robots.txt apart from one that fails", async () => {
  vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
  expect((await scanPage()).robots).toEqual({ kind: "missing", status: 404 });
  vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
  expect((await scanPage()).robots).toEqual({ kind: "unreadable", reason: "HTTP 503" });
  // Google reads a 429 as a server that cannot answer now, not a missing file.
  vi.stubGlobal("fetch", async () => new Response("", { status: 429 }));
  expect((await scanPage()).robots).toEqual({ kind: "unreadable", reason: "HTTP 429" });
});

/* Headers that arrive before a stalled body must not leave the cards loading. */
it("gives up on a robots.txt body that never ends", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => ({
    ok: true,
    status: 200,
    text: () =>
      new Promise<string>((_, reject) =>
        init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      ),
  }));
  const scan = scanPage();
  await vi.advanceTimersByTimeAsync(8000);
  expect((await scan).robots).toEqual({ kind: "unreadable", reason: "aborted" });
  vi.useRealTimers();
});

const facts = (patch: Partial<PageFacts> = {}): PageFacts => ({
  url: "https://example.com/blog/post",
  title: "A title that is long enough to pass the check",
  description:
    "A description long enough to sit inside the range Google shows in its results for a page.",
  canonical: "https://example.com/blog/post/",
  metaRobots: "",
  lang: "en",
  viewport: true,
  h1: ["Post"],
  h2: 3,
  h3: 1,
  images: 2,
  imagesWithoutAlt: 0,
  words: 900,
  hreflang: 0,
  schemaTypes: ["Article"],
  ogTitle: true,
  ogImage: true,
  robots: { kind: "found", text: "User-agent: *\nDisallow: /admin" },
  ...patch,
});

it("calls a page indexable when nothing stops Google", () => {
  const { verdict, checks } = indexing(facts());
  expect(verdict).toMatchObject({ value: "Indexable", tone: "good" });
  expect(checks.map((check) => check.tone)).toEqual(["good", "good", "good"]);
});

it("is red only where Google will not index the page", () => {
  expect(indexing(facts({ metaRobots: "noindex,follow" })).verdict.value).toBe("Not indexable");
  expect(
    indexing(facts({ robots: { kind: "found", text: "User-agent: Googlebot\nDisallow: /blog" } }))
      .verdict.tone,
  ).toBe("bad");
  const elsewhere = indexing(facts({ canonical: "https://example.com/other" }));
  expect(elsewhere.verdict.tone).toBe("warn");
  expect(elsewhere.checks[2]?.note).toContain("another URL");
  expect(
    indexing(facts({ robots: { kind: "unreadable", reason: "HTTP 500" } })).checks[0],
  ).toMatchObject({
    value: "Unreadable",
    tone: "warn",
  });
});

it("bands on-page lengths as rules of thumb", () => {
  const byLabel = (checks: ReturnType<typeof onPage>) =>
    Object.fromEntries(checks.map((check) => [check.label, check]));
  expect(byLabel(onPage(facts())).Title?.tone).toBe("good");
  const poor = byLabel(
    onPage(
      facts({
        title: null,
        description: "Short",
        h1: [],
        imagesWithoutAlt: 1,
        lang: null,
        viewport: false,
        ogImage: false,
      }),
    ),
  );
  expect(poor.Title).toMatchObject({ value: "Missing", tone: "bad" });
  expect(poor.Description?.tone).toBe("warn");
  expect(poor.H1?.tone).toBe("warn");
  expect(poor["Image alt text"]).toMatchObject({ value: "1 of 2 missing", tone: "warn" });
  expect(poor.Language?.tone).toBe("warn");
  expect(poor["Mobile viewport"]?.tone).toBe("warn");
  expect(poor["Social preview"]).toMatchObject({ value: "No image", tone: "warn" });
});
