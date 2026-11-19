import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
vi.mock("../client.js", () => ({ createRun: api.create, getRun: api.get }));

import {
  allPending,
  allRetryIntents,
  getHistory,
  headroom,
  patchSettings,
  putPending,
  reconcileReservations,
  serialized,
  suspendPending,
} from "../../ledger/store.js";
import { dispatch, recover } from "../runner.js";

const run = {
  id: "test-run",
  run_url: "https://app.glasser.ai/runs/test-run",
  provider: "test",
  endpoint: "/test",
  endpoint_version: 1,
  status: "COMPLETED",
  failure: null,
  output: {},
  charge_usd: "0.10",
  charge_basis: null,
  stoppable: false,
  created_at: new Date().toISOString(),
  completed_at: new Date().toISOString(),
};
const request = {
  purpose: { kind: "panel" as const },
  provider: "test",
  endpoint: "/test",
  input: { domain: "example.com" },
  domains: ["example.com"],
  maxChargeMicros: 100000n,
  idemKey: "test",
};
let bag: Record<string, unknown>;
let failSettlement: boolean;
beforeEach(() => {
  bag = {
    "openseo:key": "gl_test_fake",
    "openseo:settings": {
      paidAcknowledged: false,
      dailyCapMicros: "1000000",
      monthlyCapMicros: "1000000",
    },
  };
  failSettlement = false;
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string | null) =>
          key === null ? structuredClone(bag) : { [key]: structuredClone(bag[key]) },
        set: async (values: Record<string, unknown>) => {
          const ledger = values["openseo:ledger"] as { history: unknown[] } | undefined;
          if (failSettlement && ledger?.history.length) throw new Error("simulated shutdown");
          Object.assign(bag, structuredClone(values));
        },
      },
    },
  });
  api.create.mockReset().mockResolvedValue({ kind: "answered", value: run });
  api.get.mockReset().mockResolvedValue({ kind: "answered", value: run });
});
it("recovers a failed settlement write without losing or duplicating the charge", async () => {
  failSettlement = true;
  await expect(dispatch(request)).rejects.toThrow("simulated shutdown");
  expect(await getHistory()).toHaveLength(0);
  expect((await headroom()).reserved).toBe(100000n);
  failSettlement = false;
  await recover();
  await recover();
  await reconcileReservations();
  expect(await allPending()).toHaveLength(0);
  expect(await getHistory()).toHaveLength(1);
  expect(await headroom()).toMatchObject({
    dayRemaining: 900000n,
    monthRemaining: 900000n,
    reserved: 0n,
  });
});
it("keeps settlement and retries result storage after a shutdown", async () => {
  await expect(
    dispatch(request, async () => {
      throw new Error("cache shutdown");
    }),
  ).rejects.toThrow();
  expect(await getHistory()).toHaveLength(1);
  expect((await allPending())[0]?.reservedMicros).toBe("0");
  const persist = vi.fn(async () => undefined);
  await Promise.all([recover(persist), recover(persist)]);
  await reconcileReservations();
  expect(persist).toHaveBeenCalled();
  expect(await allPending()).toHaveLength(0);
  expect(await getHistory()).toHaveLength(1);
  expect((await headroom()).dayRemaining).toBe(900000n);
});
it("releases a new reservation when an idempotent replay returns an old Run", async () => {
  await dispatch(request);
  await dispatch(request);
  expect(await getHistory()).toHaveLength(1);
  expect(await headroom()).toMatchObject({ dayRemaining: 900000n, reserved: 0n });
});
it("fetches with a Key even when the legacy acknowledgement is false", async () => {
  expect(await dispatch(request)).toMatchObject({ kind: "settled" });
  expect(api.create).toHaveBeenCalledTimes(1);
});
it("still enforces estimated budgets", async () => {
  await patchSettings({ dailyCapMicros: "0" });
  expect(await dispatch(request)).toMatchObject({ kind: "blocked" });
  expect(api.create).not.toHaveBeenCalled();
});

it("keeps the maximum charge against limits when the final amount is missing", async () => {
  api.create.mockResolvedValue({ kind: "answered", value: { ...run, charge_usd: null } });
  await dispatch(request);
  expect((await headroom()).dayRemaining).toBe(900000n);
  expect((await getHistory())[0]?.chargeReported).toBe(false);
});
it("stores terminal failures for panels to display", async () => {
  api.create.mockResolvedValue({
    kind: "answered",
    value: {
      ...run,
      status: "FAILED",
      failure: { kind: "TIMED_OUT", message: "Provider timed out" },
    },
  });
  await dispatch(request);
  expect((await getHistory())[0]?.failure).toBe("Provider timed out");
  expect(await allPending()).toHaveLength(0);
});
it("repairs legacy undercounts using retained charge history", async () => {
  bag["openseo:history"] = [
    {
      runId: "legacy",
      runUrl: run.run_url,
      provider: "test",
      endpoint: "/test",
      chargeMicros: "100000",
      at: Date.now(),
    },
  ];
  await reconcileReservations();
  expect((await headroom()).dayRemaining).toBe(900000n);
});

it.each([false, true])(
  "recovers a slow request beyond the old cutoff (known Run: %s)",
  async (knownRun) => {
    const inFlight = { ...run, status: "RUNNING", completed_at: null, charge_usd: null };
    api.create.mockResolvedValue(
      knownRun ? { kind: "answered", value: inFlight } : { kind: "uncertain", reason: "network" },
    );
    await dispatch({ ...request, endpointVersion: 7 });
    await serialized(async () => {
      const pending = (await allPending())[0]!;
      await putPending({ ...pending, dispatchedAt: Date.now() - 120_000, attempts: 4 });
    });

    api.get.mockResolvedValue({ kind: "answered", value: inFlight });
    await recover();
    expect((await allPending())[0]?.state).toBe("in-flight");
    expect((await headroom()).reserved).toBe(100000n);
    expect(await getHistory()).toHaveLength(0);

    api.create.mockResolvedValue({ kind: "answered", value: run });
    api.get.mockResolvedValue({ kind: "answered", value: run });
    const persist = vi.fn(async () => undefined);
    await recover(persist);
    await recover(persist);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await allPending()).toHaveLength(0);
    expect(await getHistory()).toHaveLength(1);
    expect(await headroom()).toMatchObject({ dayRemaining: 900000n, reserved: 0n });
    if (knownRun) {
      expect(api.create).toHaveBeenCalledTimes(1);
      expect(api.get).toHaveBeenCalledWith("gl_test_fake", run.id);
    } else {
      expect(api.get).not.toHaveBeenCalled();
      expect(api.create).toHaveBeenCalledTimes(3);
      for (const args of api.create.mock.calls) {
        expect(args).toEqual([
          "gl_test_fake",
          request.idemKey,
          {
            provider: request.provider,
            endpoint: request.endpoint,
            input: request.input,
            endpoint_version: 7,
          },
        ]);
      }
    }
  },
);

it("resumes a request suspended by the old polling cutoff", async () => {
  api.create.mockResolvedValue({ kind: "uncertain", reason: "network" });
  await dispatch(request);
  await serialized(() => suspendPending(request.idemKey, "unresolved after repeated attempts"));
  await recover();
  expect((await allPending())[0]).toMatchObject({ state: "in-flight", idemKey: request.idemKey });
  expect((await allPending())[0]?.reason).toBeUndefined();
  api.create.mockResolvedValue({ kind: "answered", value: run });
  await recover();
  expect(await allPending()).toHaveLength(0);
  expect(await getHistory()).toHaveLength(1);
  expect((await headroom()).reserved).toBe(0n);
});

it.each(["the Key changed", "not_found: Run unavailable"])(
  "preserves suspension for %s",
  async (reason) => {
    api.create.mockResolvedValue({ kind: "uncertain", reason: "network" });
    await dispatch(request);
    await serialized(() => suspendPending(request.idemKey, reason));
    await recover();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.get).not.toHaveBeenCalled();
    expect((await allPending())[0]).toMatchObject({ state: "suspended", reason });
    expect((await headroom()).reserved).toBe(100000n);
  },
);

it("does not resume an old timeout with a different Key", async () => {
  api.create.mockResolvedValue({ kind: "uncertain", reason: "network" });
  await dispatch(request);
  await serialized(() => suspendPending(request.idemKey, "unresolved after repeated attempts"));
  bag["openseo:key"] = "gl_different_fake";
  await recover();
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(api.get).not.toHaveBeenCalled();
  expect((await allPending())[0]).toMatchObject({ state: "suspended", reason: "the Key changed" });
});

it("sends nothing when the Key differs from the one the request was priced with", async () => {
  expect(await dispatch({ ...request, key: "gl_replaced_fake" })).toMatchObject({
    kind: "blocked",
    reason: "Key changed. Try again.",
  });
  expect(api.create).not.toHaveBeenCalled();
  expect(await allPending()).toHaveLength(0);
});

it("sends nothing when the caller's last check vetoes the request", async () => {
  expect(
    await dispatch({ ...request, admit: async () => "Automatic Domain Rating lookups are off." }),
  ).toMatchObject({ kind: "blocked", reason: "Automatic Domain Rating lookups are off." });
  expect(api.create).not.toHaveBeenCalled();
  expect(await allPending()).toHaveLength(0);
});

it("keeps the admitted price on the pending request", async () => {
  api.create.mockImplementationOnce(() => new Promise(() => undefined));
  void dispatch({ ...request, typicalMicros: 70000n });
  await vi.waitFor(async () => expect(await allPending()).toHaveLength(1));
  expect((await allPending())[0]?.estimate).toEqual({ typical: "70000", max: "100000" });
});

describe("a timeout that recovery finds", () => {
  const timedOut = {
    ...run,
    status: "FAILED",
    output: null,
    charge_usd: "0.00",
    failure: { kind: "TIMED_OUT", message: "The provider did not respond within 20000ms" },
  };
  const lost = async (extra: Partial<typeof request> & { timeoutRetry?: boolean } = {}) => {
    // The first response is lost, so only recovery sees the Run.
    api.create.mockResolvedValueOnce({ kind: "uncertain", reason: "network" });
    await dispatch({ ...request, ...extra });
  };

  it("hands it to the retry, once", async () => {
    await lost();
    api.create.mockResolvedValueOnce({ kind: "answered", value: timedOut });
    const onTimedOut = vi.fn();
    await recover(undefined, onTimedOut);
    expect(onTimedOut).toHaveBeenCalledWith(expect.objectContaining({ idemKey: "test" }));
    expect(await allPending()).toHaveLength(0);
    // The intent holds the lock but no money.
    expect(await allRetryIntents()).toHaveLength(1);
    expect((await headroom()).reserved).toBe(0n);
    // A click during the handoff waits for the retry instead of buying.
    expect(await dispatch({ ...request, idemKey: "click" })).toEqual({ kind: "inflight" });
    // The retry itself is not held back by its own intent.
    api.create.mockResolvedValueOnce({ kind: "answered", value: run });
    expect(await dispatch({ ...request, idemKey: "retry", timeoutRetry: true })).toMatchObject({
      kind: "settled",
    });
  });

  it("finds an intent a stopped worker left behind", async () => {
    await lost();
    api.create.mockResolvedValueOnce({ kind: "answered", value: timedOut });
    await recover(undefined, vi.fn());
    const onTimedOut = vi.fn();
    await recover(undefined, onTimedOut);
    expect(onTimedOut).toHaveBeenCalledWith(expect.objectContaining({ idemKey: "test" }));
  });

  it("does not hand on a timeout that was charged", async () => {
    await lost();
    api.create.mockResolvedValueOnce({
      kind: "answered",
      value: { ...timedOut, charge_usd: "0.01" },
    });
    const onTimedOut = vi.fn();
    await recover(undefined, onTimedOut);
    expect(onTimedOut).not.toHaveBeenCalled();
  });

  it("does not hand on a timeout of the retry itself", async () => {
    await lost({ timeoutRetry: true });
    api.create.mockResolvedValueOnce({ kind: "answered", value: timedOut });
    const onTimedOut = vi.fn();
    await recover(undefined, onTimedOut);
    expect(onTimedOut).not.toHaveBeenCalled();
  });
});
