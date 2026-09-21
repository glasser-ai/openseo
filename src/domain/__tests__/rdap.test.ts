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
 * The records last 30 days, so entries written before the URL was recorded are
 * answered from the cache for a month. Reading the saved field alone left the
 * link missing for that whole month on every domain already looked at — which
 * is how the missing link was first reported. The URL is rebuilt instead.
 */
it("rebuilds the URL for a cache entry from before it was recorded", async () => {
  store["openseo:rdap:npmjs.com"] = {
    fetchedAt: Date.now(),
    value: { registered: "2010-03-19", expires: null, updated: null, registrar: null },
  };
  expect(await lookupRegistration("npmjs.com")).toMatchObject({
    kind: "ok",
    source: "https://rdap.verisign.com/com/v1/domain/npmjs.com",
  });
  // A cache hit is answered from local storage and must not reach the network
  // just to decorate a label.
  expect(fetch).not.toHaveBeenCalled();
});

/** With no saved bootstrap there is no base to build on, and the panel prints
    the label as plain text rather than an undefined href. */
it("leaves the link off when the registry cannot be resolved offline", async () => {
  store["openseo:rdap-bootstrap"] = undefined;
  store["openseo:rdap:npmjs.com"] = {
    fetchedAt: Date.now(),
    value: { registered: "2010-03-19", expires: null, updated: null, registrar: null },
  };
  expect(await lookupRegistration("npmjs.com")).toMatchObject({ kind: "ok", source: null });
  expect(fetch).not.toHaveBeenCalled();
});
