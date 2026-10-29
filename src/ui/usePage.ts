import { useEffect, useRef, useState } from "react";
import type { PageFacts } from "../domain/page.js";

export type PageScan =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ok"; readonly facts: PageFacts }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Reads the open page each time a section that needs it is shown. Not on
 * panel open: someone who only wants the domain figures has not asked for the
 * page to be read. The scan is free, so the answer is kept, not cached.
 *
 * address is the tab's address as the panel last read it. A single-page app
 * can move on without a change to it, so a new address is not the only
 * trigger: each entry to a section reads the page again.
 *
 * fresh says the scan was read for this entry and this address. Until it is,
 * the last scan stays on screen, but nothing may be bought from it.
 */
export function usePage(
  section: string | null,
  address: string,
): { scan: PageScan; fresh: boolean } {
  // Counted during render, so that the render that enters a section already
  // sees the old scan as not fresh. An effect would count one commit late,
  // after the Report had bought from the old scan.
  const [entry, setEntry] = useState({ section, count: section ? 1 : 0 });
  let count = entry.count;
  if (entry.section !== section) {
    count = section ? entry.count + 1 : entry.count;
    setEntry({ section, count });
  }
  const [scan, setScan] = useState<{ address: string; count: number; value: PageScan }>({
    address,
    count: 0,
    value: { kind: "idle" },
  });
  // The scan last asked for. A reply for an older one is dropped.
  const requested = useRef<{ address: string; count: number } | null>(null);
  useEffect(() => {
    if (!section) return;
    const asked = requested.current;
    if (asked?.address === address && asked.count === count) return;
    const ask = { address, count };
    requested.current = ask;
    const set = (value: PageScan) => {
      if (requested.current === ask) setScan({ address, count, value });
    };
    // The same address keeps its last scan on screen while it is read again.
    setScan((previous) =>
      previous.address === address && previous.value.kind === "ok"
        ? previous
        : { address, count: 0, value: { kind: "loading" } },
    );
    void chrome.runtime
      .sendMessage({ type: "openseo:page" })
      .then((reply: PageScan | null) =>
        set(reply?.kind === "ok" || reply?.kind === "failed" ? reply : failed),
      )
      .catch(() => set(failed));
  }, [section, address, count]);
  if (scan.address !== address) return { scan: { kind: "idle" }, fresh: false };
  return { scan: scan.value, fresh: scan.count === count && scan.value.kind !== "loading" };
}

const failed: PageScan = { kind: "failed", reason: "The page gave no answer." };
