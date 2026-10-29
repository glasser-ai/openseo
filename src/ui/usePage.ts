import { useEffect, useState } from "react";
import type { PageFacts } from "../domain/page.js";

export type PageScan =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ok"; readonly facts: PageFacts }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Reads the open page once, the first time a section that needs it is shown.
 * Not on panel open: someone who only wants the domain figures has not asked
 * for the page to be read. The scan is free, so the answer is kept for the
 * life of the panel rather than cached.
 */
export function usePage(wanted: boolean): PageScan {
  const [scan, setScan] = useState<PageScan>({ kind: "idle" });
  const start = wanted && scan.kind === "idle";
  useEffect(() => {
    if (!start) return;
    setScan({ kind: "loading" });
    void chrome.runtime
      .sendMessage({ type: "openseo:page" })
      .then((reply: PageScan | null) =>
        setScan(reply?.kind === "ok" || reply?.kind === "failed" ? reply : failed),
      )
      .catch(() => setScan(failed));
  }, [start]);
  return scan;
}

const failed: PageScan = { kind: "failed", reason: "The page gave no answer." };
