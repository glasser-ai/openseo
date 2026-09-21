import { beforeEach, expect, it, vi } from "vitest";
import { lookupRegistration, rdapViewerUrl } from "../rdap.js";

const RECORD = {
  events: [
    { eventAction: "registration", eventDate: "2010-03-19T00:00:00Z" },
    { eventAction: "expiration", eventDate: "2031-03-19T00:00:00Z" },
  ],
  entities: [
    { roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "MarkMonitor Inc."]]] },
  ],
};

let store: Record<string, unknown>;

beforeEach(() => {
  store = {
    "openseo:rdap-bootstrap": {
      fetchedAt: Date.now(),
      map: { com: "https://rdap.verisign.com/com/v1" },
    },
  };
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (bag: Record<string, unknown>) => Object.assign(store, bag),
      },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(RECORD), { status: 200 })),
  );
});

/*
 * The panel's provenance link is for **a person**, so it must not be the URL
 * this module fetches: that one answers with application/rdap+json and lands a
 * reader in raw JSON. It also asks about the registrable domain, the same one
 * the record is about — a link to docs.apify.com would 404 at the registry.
 */
it("sends a reader to a rendered record for the registrable domain", () => {
  expect(rdapViewerUrl("docs.apify.com")).toBe(
    "https://client.rdap.org/?type=domain&object=apify.com",
  );
});

/** A record lasts 30 days, and reading it back must cost no network. */
it("answers a second lookup from the cache", async () => {
  const fresh = await lookupRegistration("www.npmjs.com");
  expect(fresh).toMatchObject({ kind: "ok", value: { registrar: "MarkMonitor Inc." } });
  expect(await lookupRegistration("npmjs.com")).toMatchObject({ kind: "ok" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

/** IANA lists no RDAP service for some TLDs (.io among them), and a card with
    no record behind it is not worth the space. */
it("reports an unresolvable TLD as unsupported", async () => {
  expect(await lookupRegistration("example.test")).toEqual({ kind: "unsupported" });
});
