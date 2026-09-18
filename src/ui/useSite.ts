import { useCallback, useEffect, useState } from "react";
export type SiteState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly host: string;
      readonly path: string;
      readonly url: string;
      readonly favicon: string | null;
    }
  | { readonly kind: "failed"; readonly reason: string };

/** The background identifies this iframe's tab, even when Settings has focus. */
export function useSite(): { state: SiteState; reload: () => void } {
  const [state, setState] = useState<SiteState>({ kind: "loading" });
  const reload = useCallback(() => {
    setState({ kind: "loading" });
    void (async () => {
      try {
        if (new URLSearchParams(location.search).has("unavailable"))
          throw new Error("unsupported page");
        const tab = (await chrome.runtime.sendMessage({
          type: "openseo:site",
        })) as chrome.tabs.Tab | null;
        const url = new URL(tab?.url ?? "");
        if (url.protocol !== "http:" && url.protocol !== "https:")
          throw new Error("unsupported page");
        setState({
          kind: "ready",
          host: url.hostname,
          path: url.pathname + url.search,
          url: url.href,
          favicon: tab?.favIconUrl ?? null,
        });
      } catch {
        setState({ kind: "failed", reason: "Open a regular website and try again." });
      }
    })();
  }, []);
  useEffect(reload, [reload]);
  return { state, reload };
}
