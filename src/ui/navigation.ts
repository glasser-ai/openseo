export const TABS = ["overview", "traffic", "search", "backlinks"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  traffic: "Traffic",
  search: "Search",
  backlinks: "Backlinks",
};
export type SettingsSection = "connection" | "activity";
export function openSettings(section: SettingsSection = "connection"): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`/options.html#${section}`) });
}
