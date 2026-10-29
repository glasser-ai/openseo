/** The open page first, then the domain: what someone is looking at, then the
    site around it. */
export const TABS = ["overview", "page", "traffic", "search", "ai", "backlinks", "site"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  page: "Page",
  traffic: "Traffic",
  search: "Search",
  ai: "AI search",
  backlinks: "Backlinks",
  site: "Site",
};
export type SettingsSection = "connection" | "activity";
export function openSettings(section: SettingsSection = "connection"): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`/options.html#${section}`) });
}
