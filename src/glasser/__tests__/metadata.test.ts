import { afterEach, expect, it, vi } from "vitest";
import { createRun } from "../client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/* Without a tag OpenSEO's Runs cannot be told apart from any other caller's
   with the same Key. */
it("tags each Run as OpenSEO's, with the extension version", async () => {
  const fetch = vi.fn(async () => new Response("{}", { status: 500 }));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "9.9.9" }) } });
  await createRun("gl_test", "idem", { provider: "ahrefs", endpoint: "/x", input: {} });
  const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(JSON.parse(init.body as string)).toMatchObject({
    provider: "ahrefs",
    metadata: { client: "openseo", client_version: "9.9.9" },
  });
});

/* glasser names the caller from the User-Agent, which an extension cannot
   set, so OpenSEO names itself in a header on every request. */
it("names OpenSEO and its version in a header on every request", async () => {
  const fetch = vi.fn(async () => new Response("{}", { status: 500 }));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "9.9.9" }) } });
  await createRun("gl_test", "idem", { provider: "ahrefs", endpoint: "/x", input: {} });
  const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect((init.headers as Record<string, string>)["x-glasser-client"]).toBe("openseo/9.9.9");
});
