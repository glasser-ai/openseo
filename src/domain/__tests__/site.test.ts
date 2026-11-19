import { expect, it } from "vitest";
import { ratesThisSite, registrableDomain, siteDomain } from "../site.js";

it.each([
  ["www.example.com.ng", "example.com.ng"],
  ["www.example.co.uk", "example.co.uk"],
  ["a.b.k12.ak.us", "b.k12.ak.us"],
  ["a.city.kawasaki.jp", "city.kawasaki.jp"],
  ["tenant.github.io", "github.io"],
  ["WWW.EXAMPLE.COM.", "example.com"],
  ["127.0.0.1", "127.0.0.1"],
  ["localhost", "localhost"],
])("uses registry suffix rules for %s", (host, expected) => {
  expect(registrableDomain(host)).toBe(expected);
});

it.each([
  ["www.wikipedia.org", "wikipedia.org"],
  ["info.cern.ch", "cern.ch"],
  ["example.com", "example.com"],
  ["tenant.github.io", "tenant.github.io"],
  ["WWW.Example.CO.UK.", "example.co.uk"],
  ["localhost", "localhost"],
])("reads %s as the site %s", (host, expected) => {
  expect(siteDomain(host)).toBe(expected);
});

it("knows when a domain score describes the platform, not the site", () => {
  expect(ratesThisSite("www.wikipedia.org")).toBe(true);
  expect(ratesThisSite("tenant.github.io")).toBe(false);
});
