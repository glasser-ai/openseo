import { useEffect } from "react";

/**
 * Reports the current theme to the service worker so it can switch the toolbar
 * icon. A worker has no matchMedia, so only an extension page with a DOM can do
 * this.
 */
export function useThemeIcon(): void {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const send = (): void => {
      void chrome.runtime
        .sendMessage({ type: "openseo:theme", dark: query.matches })
        .catch(() => undefined);
    };
    send();
    query.addEventListener("change", send);
    return () => query.removeEventListener("change", send);
  }, []);
}
