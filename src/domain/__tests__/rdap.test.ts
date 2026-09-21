import { beforeEach, expect, it, vi } from "vitest";
import { lookupRegistration } from "../rdap.js";

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
 * The panel links its provenance line to this URL, and the link is the only
 * way a reader can check the dates against the registry. It travels through
 * chrome.storage, where a renamed field fails silently — the line would simply
 * stop being a link, with nothing to say why.
 */
it("reports the record URL it read, and saves it for the cached answer", async () => {
  const fresh = await lookupRegistration("www.npmjs.com");
  expect(fresh).toMatchObject({
    kind: "ok",
    source: "https://rdap.verisign.com/com/v1/domain/npmjs.com",
  });
  const cached = await lookupRegistration("npmjs.com");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(cached).toMatchObject({ source: "https://rdap.verisign.com/com/v1/domain/npmjs.com" });
});

/*
 * A 30-day TTL means entries written before the URL was recorded are answered
 * from the cache for a month. They must still produce a card — plain text
 * rather than a link — instead of an undefined href.
 */
it("answers a cache entry from before the URL was recorded with no link", async () => {
  store["openseo:rdap:npmjs.com"] = {
    fetchedAt: Date.now(),
    value: { registered: "2010-03-19", expires: null, updated: null, registrar: null },
  };
  expect(await lookupRegistration("npmjs.com")).toMatchObject({ kind: "ok", source: null });
  expect(fetch).not.toHaveBeenCalled();
});
