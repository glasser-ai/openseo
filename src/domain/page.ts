import { isAllowed, type RobotsFile, robotsFor } from "./robots.js";
import type { Tone } from "./thresholds.js";

/** What the scan reads from the open page. Only these facts leave the page,
    and only to the panel: no HTML and no text. */
export type PageFacts = {
  readonly url: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly canonical: string | null;
  /** The robots and googlebot meta tags, lower case, joined. */
  readonly metaRobots: string;
  readonly lang: string | null;
  readonly viewport: boolean;
  readonly h1: readonly string[];
  readonly h2: number;
  readonly h3: number;
  readonly images: number;
  readonly imagesWithoutAlt: number;
  readonly words: number;
  readonly hreflang: number;
  readonly schemaTypes: readonly string[];
  readonly ogTitle: boolean;
  readonly ogImage: boolean;
  readonly robots: RobotsFile;
};

/**
 * Runs **inside the page** through chrome.scripting.executeScript, which sends
 * the function's source and nothing it closes over. So it imports nothing,
 * calls no helper outside itself, and returns plain data.
 *
 * robots.txt is fetched from the page because the request is then same-origin:
 * the extension has no host permission for the site, and asks for none.
 */
export async function scanPage(): Promise<PageFacts> {
  const text = (node: Element | null | undefined): string | null => {
    const value = node?.getAttribute("content") ?? node?.textContent ?? null;
    const clean = value?.replace(/\s+/g, " ").trim() ?? "";
    return clean === "" ? null : clean;
  };
  const all = (selector: string): Element[] => Array.from(document.querySelectorAll(selector));

  const schemaTypes = new Set<string>();
  const addTypes = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) addTypes(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const type = record["@type"];
    for (const name of Array.isArray(type) ? type : [type])
      if (typeof name === "string") schemaTypes.add(name);
    addTypes(record["@graph"]);
  };
  for (const script of all('script[type="application/ld+json"]')) {
    try {
      addTypes(JSON.parse(script.textContent ?? ""));
    } catch {
      // A broken block is the site's fault; the rest still count.
    }
  }

  const images = all("img");
  // alt="" is right for a decorative image, so only a missing attribute counts.
  const imagesWithoutAlt = images.filter((image) => !image.hasAttribute("alt")).length;
  const body = document.body as HTMLElement | null;
  const words = (body?.innerText ?? body?.textContent ?? "").split(/\s+/).filter(Boolean).length;

  let robots: RobotsFile;
  const controller = new AbortController();
  // The timer covers the body as well as the headers: a server that sends
  // headers and then stalls would otherwise leave both cards loading.
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(new URL("/robots.txt", location.origin).href, {
      signal: controller.signal,
      credentials: "omit",
      cache: "no-cache",
    });
    if (response.ok) {
      // Google reads the first 500 KiB and ignores the rest.
      robots = { kind: "found", text: (await response.text()).slice(0, 512_000) };
    } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      robots = { kind: "missing", status: response.status };
    } else {
      // Google treats 429 like a 5xx: a server that cannot answer now, not a
      // file that does not exist.
      robots = { kind: "unreadable", reason: `HTTP ${response.status}` };
    }
  } catch (error) {
    robots = { kind: "unreadable", reason: error instanceof Error ? error.message : "no answer" };
  } finally {
    clearTimeout(timer);
  }

  return {
    url: location.href,
    title: text(document.querySelector("title")),
    description: text(document.querySelector('meta[name="description" i]')),
    canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical" i]')?.href ?? null,
    metaRobots: all('meta[name="robots" i], meta[name="googlebot" i]')
      .map((meta) => meta.getAttribute("content") ?? "")
      .join(",")
      .toLowerCase(),
    lang: document.documentElement.getAttribute("lang")?.trim() || null,
    viewport: document.querySelector('meta[name="viewport" i]') !== null,
    h1: all("h1")
      .map((node) => text(node) ?? "")
      .slice(0, 5),
    h2: all("h2").length,
    h3: all("h3").length,
    images: images.length,
    imagesWithoutAlt,
    words,
    hreflang: all('link[rel="alternate" i][hreflang]').length,
    schemaTypes: [...schemaTypes].slice(0, 12),
    ogTitle: document.querySelector('meta[property="og:title" i]') !== null,
    ogImage: document.querySelector('meta[property="og:image" i]') !== null,
    robots,
  };
}

export type Check = {
  readonly label: string;
  readonly value: string;
  readonly tone: Tone;
  /** Why the tone, in one line. Absent when the value says it all. */
  readonly note?: string;
};

/** Red only where Google will not show the page at all (see thresholds.ts):
    the rest is a matter of degree, so it stops at amber. */
export function indexing(facts: PageFacts): { verdict: Check; checks: readonly Check[] } {
  const robots = robotsFor(facts.robots);
  const path = pathOf(facts.url);
  const crawl: Check =
    robots === null
      ? {
          label: "robots.txt",
          value: "Unreadable",
          tone: "warn",
          note: `Google pauses crawling while robots.txt fails (${facts.robots.kind === "unreadable" ? facts.robots.reason : ""}).`,
        }
      : isAllowed(robots, "Googlebot", path)
        ? {
            label: "robots.txt",
            value: "Googlebot allowed",
            tone: "good",
            ...(facts.robots.kind === "missing"
              ? { note: "No robots.txt, so nothing is blocked." }
              : {}),
          }
        : {
            label: "robots.txt",
            value: "Googlebot blocked",
            tone: "bad",
            note: "Google cannot crawl this page.",
          };
  const noindex = /\b(noindex|none)\b/.test(facts.metaRobots);
  const meta: Check = noindex
    ? {
        label: "Meta robots",
        value: "noindex",
        tone: "bad",
        note: "Google will not index this page.",
      }
    : /\bnofollow\b/.test(facts.metaRobots)
      ? {
          label: "Meta robots",
          value: "nofollow",
          tone: "warn",
          note: "Links on this page pass nothing.",
        }
      : { label: "Meta robots", value: facts.metaRobots || "Not set", tone: "good" };
  const self = facts.canonical !== null && sameUrl(facts.canonical, facts.url);
  const canonical: Check =
    facts.canonical === null
      ? {
          label: "Canonical",
          value: "Missing",
          tone: "warn",
          note: "Google picks the main URL itself.",
        }
      : self
        ? { label: "Canonical", value: "This page", tone: "good" }
        : {
            label: "Canonical",
            value: facts.canonical,
            tone: "warn",
            note: "Points to another URL, which Google may index instead.",
          };
  const checks = [crawl, meta, canonical];
  const verdict: Check =
    crawl.tone === "bad" || meta.tone === "bad"
      ? { label: "Indexing", value: "Not indexable", tone: "bad" }
      : checks.some((check) => check.tone === "warn")
        ? { label: "Indexing", value: "Check the notes", tone: "warn" }
        : { label: "Indexing", value: "Indexable", tone: "good" };
  return { verdict, checks };
}

/**
 * Lengths follow what Google shows in results: about 60 characters of title
 * and 160 of description before it cuts. They are rules of thumb, so they
 * only reach amber.
 */
export function onPage(facts: PageFacts): readonly Check[] {
  const title = facts.title;
  const description = facts.description;
  const h1 = facts.h1.length;
  return [
    title === null
      ? {
          label: "Title",
          value: "Missing",
          tone: "bad",
          note: "Results show a title Google makes up.",
        }
      : {
          label: "Title",
          value: title,
          tone: title.length < 30 || title.length > 60 ? "warn" : "good",
          note: `${title.length} characters${title.length > 60 ? ", Google may cut it" : title.length < 30 ? ", short" : ""}`,
        },
    description === null
      ? {
          label: "Description",
          value: "Missing",
          tone: "warn",
          note: "Google writes the snippet from the page text.",
        }
      : {
          label: "Description",
          value: description,
          tone: description.length < 70 || description.length > 160 ? "warn" : "good",
          note: `${description.length} characters${description.length > 160 ? ", Google may cut it" : description.length < 70 ? ", short" : ""}`,
        },
    h1 === 0
      ? { label: "H1", value: "None", tone: "warn", note: "No main heading for the page." }
      : {
          label: h1 === 1 ? "H1" : `H1 (${h1})`,
          value: facts.h1[0] || "(empty)",
          tone: "good",
        },
    {
      label: "Subheadings",
      value: `${facts.h2} H2 · ${facts.h3} H3`,
      tone: "neutral",
    },
    facts.images === 0
      ? { label: "Image alt text", value: "No images", tone: "neutral" }
      : facts.imagesWithoutAlt === 0
        ? { label: "Image alt text", value: `All ${facts.images} have it`, tone: "good" }
        : {
            label: "Image alt text",
            value: `${facts.imagesWithoutAlt} of ${facts.images} missing`,
            tone: "warn",
            note: "Image search and screen readers read the alt text.",
          },
    { label: "Words", value: facts.words.toLocaleString("en-US"), tone: "neutral" },
    facts.lang === null
      ? { label: "Language", value: "Not set", tone: "warn", note: "The html tag has no lang." }
      : { label: "Language", value: facts.lang, tone: "good" },
    facts.viewport
      ? { label: "Mobile viewport", value: "Set", tone: "good" }
      : {
          label: "Mobile viewport",
          value: "Missing",
          tone: "warn",
          note: "Phones show the desktop layout, zoomed out.",
        },
    facts.schemaTypes.length > 0
      ? { label: "Structured data", value: facts.schemaTypes.join(", "), tone: "good" }
      : { label: "Structured data", value: "None", tone: "neutral" },
    facts.ogTitle && facts.ogImage
      ? { label: "Social preview", value: "Title and image", tone: "good" }
      : {
          label: "Social preview",
          value: facts.ogTitle ? "No image" : facts.ogImage ? "No title" : "Missing",
          tone: "warn",
          note: "Shared links show a plain or partial card.",
        },
    {
      label: "hreflang",
      value: facts.hreflang === 0 ? "None" : `${facts.hreflang} languages`,
      tone: "neutral",
    },
  ];
}

export type PageTarget =
  | { readonly kind: "ok"; readonly url: string }
  | { readonly kind: "unsupported"; readonly reason: string };

/** Query parameters that track a visit and never change the page. */
const TRACKING = /^(utm_.+|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl)$/i;

/**
 * The address the paid keyword lookup asks about, taken from the scan so the
 * checks and the keywords always describe one page.
 *
 * The canonical comes first: it is the page Google ranks, and the site
 * publishes it. Without one, a query string that is left after the tracking
 * parameters, such as ?p=123, can name a different page or hold a session
 * token or an email address, so nothing is bought rather than the wrong page,
 * or a private value sent to a Provider.
 */
export function lookupTarget(facts: PageFacts): PageTarget {
  const web = (url: URL) => url.protocol === "https:" || url.protocol === "http:";
  // A canonical is the site's own text, so it can hold credentials or a
  // campaign tag too. Neither is sent, and a tag must not split the cache into
  // one paid lookup per campaign.
  const clean = (url: URL) => {
    url.hash = "";
    url.username = "";
    url.password = "";
    const keys = [...url.searchParams.keys()];
    // Only rewrite the query when there is something to drop: URLSearchParams
    // re-encodes it, which would change the cache identity of a clean address.
    if (keys.some((key) => TRACKING.test(key)))
      for (const key of keys) if (TRACKING.test(key)) url.searchParams.delete(key);
    return url;
  };
  try {
    if (facts.canonical) {
      const canonical = new URL(facts.canonical);
      if (web(canonical)) return { kind: "ok", url: clean(canonical).href };
    }
    const url = new URL(facts.url);
    if (!web(url)) return { kind: "unsupported", reason: "This is not a web page." };
    if (clean(url).search !== "") {
      return {
        kind: "unsupported",
        reason:
          "This address has a query string and the page names no canonical address, so OpenSEO cannot tell which page to look up. The query string can hold private data, so it is not sent.",
      };
    }
    return { kind: "ok", url: url.origin + url.pathname };
  } catch {
    return { kind: "unsupported", reason: "The page address could not be read." };
  }
}

/** robots.txt rules match the path and query, never the host or fragment. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return "/";
  }
}

/** A trailing slash or a fragment does not make a canonical point elsewhere. */
function sameUrl(a: string, b: string): boolean {
  const clean = (url: string) => {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      return parsed.href.replace(/\/$/, "");
    } catch {
      return url;
    }
  };
  return clean(a) === clean(b);
}
