import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ inspect: vi.fn(), dispatch: vi.fn() }));
vi.mock("../../glasser/client.js", () => ({ inspectEndpoint: api.inspect }));
vi.mock("../../glasser/runner.js", () => ({ dispatch: api.dispatch }));
vi.mock("../../glasser/idempotency.js", () => ({
  idempotencyKey: async () => "idempotency-test",
  mintEpoch: () => "epoch-test",
}));

import type { Run } from "../../glasser/schema.js";
import type { PendingRecord } from "../../ledger/store.js";
import { isOutdated, readPanel, readStoredPanel, writePanel } from "../cache.js";
import { extractKeywords, LOOKUPS } from "../lookups.js";
import { persistRecoveredPanel } from "../persist.js";
import { peekLookup, peekTraffic, runLookup, runTraffic } from "../service.js";

let bag: Record<string, unknown>;
const lookup = LOOKUPS.find((item) => item.id === "domain-rating")!;
const run: Run = {
  id: "test-run",
  run_url: "https://glasser.ai/runs/test-run",
  provider: "ahrefs",
  endpoint: lookup.endpoint,
  endpoint_version: 1,
  status: "COMPLETED",
  failure: null,
  output: { domain_rating: { domain_rating: 42 } },
  charge_usd: "0.01236",
  charge_basis: null,
  stoppable: false,
  created_at: "2026-09-15T00:00:00Z",
  completed_at: "2026-09-15T00:00:01Z",
};
beforeEach(() => {
  bag = {
    "openseo:key": "gl_test",
    "openseo:epochs": { existing: { epoch: "old", at: Date.now() } },
  };
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | null) =>
          keys === null
            ? { ...bag }
            : Object.fromEntries(
                (Array.isArray(keys) ? keys : [keys]).map((key) => [key, bag[key]]),
              ),
        ),
        set: vi.fn(async (values) => {
          Object.assign(bag, values);
        }),
      },
    },
  });
  api.inspect.mockReset().mockResolvedValue({
    kind: "answered",
    value: {
      price: { rule: { type: "flat", amount_usd: "0.01236" }, charges: {} },
      endpoint_version: 1,
    },
  });
  api.dispatch.mockReset().mockImplementation(async (_request, persist) => {
    await persist(run);
    return { kind: "settled", run };
  });
});

describe("report purchase and cache behavior", () => {
  it("reserves the inspected estimate without UI approval", async () => {
    expect(await runLookup("domain-rating", "example.com")).toMatchObject({ ok: true });
    expect(api.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ maxChargeMicros: 12360n, endpointVersion: 1 }),
      expect.any(Function),
    );
  });
  it("does not dispatch or discard the request identity after failed inspection", async () => {
    const epochs = bag["openseo:epochs"];
    api.inspect.mockResolvedValue({ kind: "uncertain", reason: "Endpoint unavailable" });
    expect(await runLookup("domain-rating", "example.com", true)).toEqual({
      ok: false,
      reason: "Endpoint unavailable",
    });
    expect(await runTraffic("example.com", true)).toEqual({
      ok: false,
      reason: "Endpoint unavailable",
    });
    expect(bag["openseo:epochs"]).toBe(epochs);
    expect(api.dispatch).not.toHaveBeenCalled();
  });
  it("persists a result before settlement and reuses it without another purchase", async () => {
    expect(await runLookup("domain-rating", "example.com", false)).toMatchObject({
      ok: true,
      cached: false,
    });
    expect(await peekLookup("domain-rating", "example.com")).toMatchObject({ runUrl: run.run_url });
    delete bag["openseo:key"];
    expect(await runLookup("domain-rating", "example.com")).toMatchObject({
      ok: true,
      cached: true,
    });
    expect(api.dispatch).toHaveBeenCalledTimes(1);
  });
  it("retains old data for reading but expires its automatic reuse", async () => {
    await writePanel(lookup.endpoint, lookup.buildInput("example.com"), {
      payload: { kind: "fields", fields: [{ label: "Domain Rating", value: "42" }] },
      runUrl: run.run_url,
      chargeUsd: null,
    });
    const cacheKey = Object.keys(bag).find((key) => key.startsWith("openseo:panel:"))!;
    bag[cacheKey] = { ...(bag[cacheKey] as object), fetchedAt: Date.now() - 8 * 86400000 };
    const entry = await readStoredPanel(lookup.endpoint, lookup.buildInput("example.com"));
    expect(entry).not.toBeNull();
    expect(isOutdated(entry!)).toBe(true);
    expect(await readPanel(lookup.endpoint, lookup.buildInput("example.com"))).toBeNull();
    expect(api.dispatch).not.toHaveBeenCalled();
  });
  it("recovers a panel request into its saved report", async () => {
    await persistRecoveredPanel(
      {
        purpose: { kind: "panel" },
        provider: "ahrefs",
        endpoint: lookup.endpoint,
        input: lookup.buildInput("example.com"),
      } as PendingRecord,
      run,
    );
    expect(await peekLookup("domain-rating", "example.com")).toMatchObject({
      payload: { kind: "fields", fields: [{ label: "Domain Rating", value: "42" }] },
    });
  });
  it("inspects and requests whole-site traffic without an automatic second Provider", async () => {
    api.dispatch.mockImplementation(async (request, persist) => {
      // Similarweb looks up by domain, so this asks about **the full hostname**
      // and does not fall back to the registrable root.
      expect(request.input).toEqual({ website: "docs.example.com" });
      await persist({ ...run, provider: "apify", endpoint: request.endpoint, output: null });
      return { kind: "settled", run };
    });
    expect(await runTraffic("docs.example.com", false)).toMatchObject({
      ok: false,
      empty: true,
      runUrl: run.run_url,
    });
    expect(api.dispatch).toHaveBeenCalledTimes(1);
    expect(await peekTraffic("docs.example.com")).toMatchObject({ payload: { kind: "none" } });
  });
});

it("retains all 25 keyword rows with numeric positions and unknown volumes", () => {
  const output = {
    tasks: [
      {
        result: [
          {
            items: Array.from({ length: 25 }, (_, i) => ({
              keyword_data: {
                keyword: `keyword ${i}`,
                keyword_info: i ? { search_volume: i * 100 } : {},
              },
              ranked_serp_element: { serp_item: { rank_absolute: i + 1 } },
            })),
          },
        ],
      },
    ],
  };
  const rows = extractKeywords(output);
  expect(rows).toHaveLength(25);
  // traffic and cpc are the two columns this version added; this fixture
  // supplies neither, so both are null.
  expect(rows[0]).toEqual({
    keyword: "keyword 0",
    position: 1,
    monthlyVolume: null,
    traffic: null,
    cpc: null,
  });
  expect(rows[24]).toEqual({
    keyword: "keyword 24",
    position: 25,
    monthlyVolume: 2400,
    traffic: null,
    cpc: null,
  });
});

it("keeps a saved report when a refreshed or recovered Run fails", async () => {
  await runLookup("domain-rating", "example.com", false);
  const saved = await peekLookup("domain-rating", "example.com");
  const failed: Run = {
    ...run,
    status: "COMPLETED",
    output: null,
    charge_basis: { clause: "PROVIDER_ERROR", quantity: null },
  };
  api.dispatch.mockImplementation(async (_request, persist) => {
    await persist(failed);
    return { kind: "settled", run: failed };
  });
  expect(await runLookup("domain-rating", "example.com", true)).toMatchObject({
    ok: false,
  });
  expect(await peekLookup("domain-rating", "example.com")).toEqual(saved);
  await persistRecoveredPanel(
    {
      purpose: { kind: "panel" },
      provider: "ahrefs",
      endpoint: lookup.endpoint,
      input: lookup.buildInput("example.com"),
    } as PendingRecord,
    { ...failed, status: "FAILED" },
  );
  expect(await peekLookup("domain-rating", "example.com")).toEqual(saved);
});

it("coordinates two automatic renewals of the same expired report", async () => {
  const input = lookup.buildInput("example.com");
  await writePanel(lookup.endpoint, input, {
    payload: { kind: "fields", fields: [{ label: "Domain Rating", value: "1" }] },
    runUrl: "old",
    chargeUsd: "0.01",
  });
  for (const key of Object.keys(bag)) {
    if (key.startsWith("openseo:panel:"))
      (bag[key] as { fetchedAt: number }).fetchedAt = Date.now() - 8 * 86400_000;
  }
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  api.inspect.mockImplementationOnce(async () => {
    await wait;
    return {
      kind: "answered",
      value: {
        price: { rule: { type: "flat", amount_usd: "0.01236" }, charges: {} },
        endpoint_version: 1,
      },
    };
  });
  const first = runLookup("domain-rating", "example.com", false);
  const second = runLookup("domain-rating", "example.com", false);
  release!();
  const results = await Promise.all([first, second]);
  expect(results[0]).toMatchObject({ ok: true, cached: false });
  expect(results[1]).toMatchObject({ ok: true, cached: true });
  expect(api.dispatch).toHaveBeenCalledTimes(1);
});

it("rechecks the cache when recovery finishes during endpoint inspection", async () => {
  api.inspect.mockImplementationOnce(async () => {
    await persistRecoveredPanel(
      {
        purpose: { kind: "panel" },
        provider: run.provider,
        endpoint: run.endpoint,
        input: lookup.buildInput("example.com"),
      } as PendingRecord,
      run,
    );
    return {
      kind: "answered",
      value: {
        price: { rule: { type: "flat", amount_usd: "0.01236" }, charges: {} },
        endpoint_version: 1,
      },
    };
  });
  expect(await runLookup("domain-rating", "example.com", false)).toMatchObject({
    ok: true,
    cached: true,
  });
  expect(api.dispatch).not.toHaveBeenCalled();
});
