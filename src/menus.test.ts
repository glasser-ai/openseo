import { describe, expect, it } from "vitest";
import { CONTEXT_MENUS, resolveMenuTarget } from "./menus.js";

const context = { pageUrl: "https://example.com/a/b?x=1", selectionText: "cold brew" };

describe("resolveMenuTarget", () => {
  it("fills hostname, href and selection", () => {
    expect(resolveMenuTarget("site-google", context)).toBe(
      "https://www.google.com/search?q=site%3Aexample.com",
    );
    expect(resolveMenuTarget("google-trends", context)).toBe(
      "https://trends.google.com/trends/explore?q=cold%20brew",
    );
  });

  it("encodes selections that would otherwise break the query string", () => {
    const url = resolveMenuTarget("google-trends", { ...context, selectionText: "a&b#c" });
    expect(url).toBe("https://trends.google.com/trends/explore?q=a%26b%23c");
  });

  it("returns null for an unknown id or an unusable page URL", () => {
    expect(resolveMenuTarget("nope", context)).toBeNull();
    expect(
      resolveMenuTarget("site-google", { pageUrl: "chrome://newtab", selectionText: "" }),
    ).not.toBe(undefined);
    expect(
      resolveMenuTarget("site-google", { pageUrl: "not a url", selectionText: "" }),
    ).toBeNull();
  });

  it("links only to neutral destinations", () => {
    const templates = CONTEXT_MENUS.map((item) => item.template ?? "").join(" ");
    expect(templates).not.toMatch(/ahrefs|semrush|similarweb|moz\.com/i);
  });
});
