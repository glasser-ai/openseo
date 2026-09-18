import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelEntry } from "../domain/cache.js";
import { LOOKUPS, type LookupId } from "../domain/lookups.js";
import type { ReportState, RunResult, TrafficResult } from "../domain/service.js";

export type ReportId = LookupId | "traffic";
export type ResultState = {
  entry: PanelEntry | null;
  loading: boolean;
  running: boolean;
  error: string | null;
};
const IDS: readonly ReportId[] = ["traffic", ...LOOKUPS.map((lookup) => lookup.id)];
const initial = (): Record<ReportId, ResultState> =>
  Object.fromEntries(
    IDS.map((id) => [
      id,
      {
        entry: null,
        loading: true,
        running: false,
        error: null,
      },
    ]),
  ) as Record<ReportId, ResultState>;

/** Own result state above the tabs so navigation cannot interrupt a request. */
export function useReport(domain: string, hasKey: boolean) {
  const [results, setResults] = useState(initial);
  const alive = useRef(true);
  const activeRuns = useRef(new Set<ReportId>());
  /** Requests awaiting a persisted result or a terminal failure. */
  const waiting = useRef(new Set<ReportId>());
  const patch = useCallback((id: ReportId, values: Partial<ResultState>) => {
    if (alive.current)
      setResults((previous) => ({ ...previous, [id]: { ...previous[id], ...values } }));
  }, []);

  useEffect(() => {
    alive.current = true;
    let live = true;
    const read = async () => {
      await Promise.all(
        IDS.map(async (id) => {
          try {
            const entry = (await chrome.runtime.sendMessage(
              id === "traffic"
                ? { type: "openseo:peek-traffic", domain }
                : { type: "openseo:peek", lookup: id, domain },
            )) as PanelEntry | null;
            if (!live) return;
            if (waiting.current.has(id)) {
              const status = (await chrome.runtime.sendMessage({
                type: "openseo:report-state",
                lookup: id,
                domain,
              })) as ReportState | null;
              if (!live) return;
              if (!status) throw new Error("Request status unavailable");
              if (status.state === "running") {
                patch(id, { entry: status.entry, loading: false, running: true });
                return;
              }
              waiting.current.delete(id);
              patch(id, {
                entry: status.entry,
                loading: false,
                running: false,
                error:
                  status.error ??
                  (status.entry
                    ? null
                    : "The request ended without a saved result. Check Activity in Settings."),
              });
              return;
            }
            patch(id, { entry, loading: false });
          } catch {
            if (live) {
              waiting.current.delete(id);
              patch(id, {
                running: false,
                loading: false,
                error: "Saved results could not be read. Reopen the panel to try again.",
              });
            }
          }
        }),
      );
    };
    if (!domain) return;
    void read();
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (
        area === "local" &&
        Object.keys(changes).some(
          (key) => key.startsWith("openseo:panel:") || key === "openseo:ledger",
        )
      )
        void read();
    };
    chrome.storage.onChanged.addListener(changed);

    /*
     * While something is awaiting settlement, nudge recovery and re-read the
     * cache every 3 seconds.
     *
     * Listening to storage alone is not enough: what writes the cache is the
     * background recovery alarm, once a minute, while these Endpoints often
     * finish in seconds — leaving someone watching a loading state for a minute.
     * A nudge is idempotent (settlement is recorded once per runId), so extra
     * nudges cost nothing.
     */
    const tick = setInterval(() => {
      if (waiting.current.size === 0) return;
      void chrome.runtime
        .sendMessage({ type: "openseo:resume" })
        .catch(() => undefined)
        .then(() => read());
    }, 3000);

    return () => {
      live = false;
      alive.current = false;
      clearInterval(tick);
      chrome.storage.onChanged.removeListener(changed);
    };
  }, [domain, patch]);

  const run = async (id: ReportId, force = false) => {
    const current = results[id];
    if (
      !hasKey ||
      !domain ||
      current.loading ||
      current.running ||
      activeRuns.current.has(id) ||
      waiting.current.has(id)
    )
      return;
    activeRuns.current.add(id);
    patch(id, { running: true, error: null });
    try {
      const reply = (await chrome.runtime.sendMessage({
        type: id === "traffic" ? "openseo:traffic" : "openseo:lookup",
        lookup: id,
        domain,
        force,
      })) as RunResult | TrafficResult;
      if (!reply) throw new Error("Request interrupted");
      if (reply.ok || "empty" in reply) {
        const payload: PanelEntry["payload"] = !reply.ok
          ? { kind: "none", reason: reply.reason }
          : "panel" in reply
            ? { kind: "traffic", panel: reply.panel }
            : {
                kind: "fields",
                fields: reply.fields,
                ...(reply.keywords ? { keywords: reply.keywords } : {}),
              };
        patch(id, {
          entry: {
            payload,
            runUrl: reply.runUrl,
            chargeUsd: reply.chargeUsd,
            fetchedAt: reply.fetchedAt,
          },
        });
      } else if ("pending" in reply) {
        // The request really is running: either just dispatched and unsettled, or
        // matching a pending record that already exists.
        // This is not a failure — hold the loading state and wait for settlement,
        // and when the recovery path writes the cache the storage listener below
        // delivers the result. So running is **not cleared** here; waiting owns
        // that.
        waiting.current.add(id);
        // A settlement can arrive before this response; read the durable state on the next poll.
        return;
      } else {
        patch(id, { error: reply.reason });
      }
    } catch {
      patch(id, { error: "The request was interrupted. Try again in a moment." });
    } finally {
      activeRuns.current.delete(id);
      if (!waiting.current.has(id)) patch(id, { running: false });
    }
  };
  return { results, run };
}
