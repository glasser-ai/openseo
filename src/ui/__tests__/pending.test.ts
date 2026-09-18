import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
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
      report = useReport("example.com", true);
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
