import { expect, it } from "vitest";
import { linkOf, pageLabel } from "../RankedTable.js";

it("links only domains and http(s) pages", () => {
  expect(linkOf("rival.com")).toBe("https://rival.com");
  expect(linkOf("http://rival.com/a")).toBe("https://rival.com/a");
  expect(linkOf("javascript:alert(1)")).toBeNull();
});

it("shortens a page on the inspected domain to its path", () => {
  expect(pageLabel("https://www.example.com/pricing?a=1", "example.com")).toBe("/pricing?a=1");
  expect(pageLabel("https://example.com/", "example.com")).toBe("/");
  expect(pageLabel("https://llm.example.com/tool/", "example.com")).toBe("llm.example.com/tool/");
});
