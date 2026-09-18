import { expect, it } from "vitest";
import { registrableDomain } from "../site.js";

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
