import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BUDGET_REACHED } from "../../ledger/store.js";
import { useReport } from "../useReport.js";

it.each(["Provider timed out", "Request suspended. Check Activity in Settings."])(
  "ends pending state after %s without a cache entry",
  async (failure) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    let error: string | null = null;
    const send = vi.fn(async (message: { type: string }) => {
      if (message.type === "openseo:traffic")
        return { ok: false, pending: true, reason: "Still running" };
      if (message.type === "openseo:resume") return { ok: true };
      if (message.type === "openseo:report-state")
        return { entry: null, state: error ? "failed" : "running", error };
      return null;
    });
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: send },
      storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    });
    let report: ReturnType<typeof useReport> | undefined;
    function Probe() {
      report = useReport("example.com", true, "us");
      return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(Probe)));
      await act(async () => report!.run("traffic"));
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      expect(report!.results.traffic.running).toBe(true);
      error = failure;
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      expect(report!.results.traffic.running).toBe(false);
      expect(report!.results.traffic.error).toBe(failure);
      const polls = send.mock.calls.filter(([m]) => m.type === "openseo:resume").length;
      await act(async () => vi.advanceTimersByTimeAsync(120000));
      expect(send.mock.calls.filter(([m]) => m.type === "openseo:resume")).toHaveLength(polls);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  },
);

it("clears a budget stop only when a cap is raised, so the report can run again", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const listeners: ((changes: object, area: string) => void)[] = [];
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi.fn(async (message: { type: string }) =>
        message.type === "openseo:traffic" ? { ok: false, reason: BUDGET_REACHED } : null,
      ),
    },
    storage: {
      onChanged: {
        addListener: (listener: (changes: object, area: string) => void) =>
          listeners.push(listener),
        removeListener: vi.fn(),
      },
    },
  });
  let report: ReturnType<typeof useReport> | undefined;
  function Probe() {
    report = useReport("example.com", true, "us");
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => report!.run("traffic"));
    expect(report!.results.traffic.error).toBe(BUDGET_REACHED);
    const epoch = report!.budgetEpoch;
    const settings = (oldValue: object, newValue: object) =>
      act(async () => {
        for (const listener of listeners)
          listener({ "openseo:settings": { oldValue, newValue } }, "local");
      });
    // A badge switch is not a budget: nothing may be bought because of it.
    await settings(
      { dailyCapMicros: "1000000" },
      { dailyCapMicros: "1000000", ratingBadge: false },
    );
    expect(report!.results.traffic.error).toBe(BUDGET_REACHED);
    expect(report!.budgetEpoch).toBe(epoch);
    await settings({ dailyCapMicros: "1000000" }, { dailyCapMicros: "2000000" });
    expect(report!.results.traffic.error).toBeNull();
    expect(report!.budgetEpoch).toBe(epoch + 1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
