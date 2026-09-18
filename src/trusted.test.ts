import { beforeEach, expect, it, vi } from "vitest";
import { panelTabId, trustedPage } from "./trusted.js";

const id = "test-extension";
beforeEach(() =>
  vi.stubGlobal("chrome", {
    runtime: { id, getURL: (path: string) => `chrome-extension://${id}${path}` },
  }),
);
it("rejects content-script contexts and framed options pages", () => {
  expect(trustedPage({ id, url: "https://www.google.com/search?q=test", frameId: 0 })).toBe(false);
  expect(trustedPage({ id, url: `chrome-extension://${id}/options.html`, frameId: 1 })).toBe(false);
  expect(trustedPage({ id: "other", url: `chrome-extension://${id}/options.html` })).toBe(false);
  expect(trustedPage({ id, url: `https://${id}/options.html` })).toBe(false);
});
it("accepts the report iframe and binds it to the browser-provided tab", () => {
  expect(trustedPage({ id, url: `chrome-extension://${id}/options.html`, frameId: 0 })).toBe(true);
  const sender = {
    id,
    url: `chrome-extension://${id}/panel.html?tabId=999`,
    frameId: 3,
    tab: { id: 42 } as chrome.tabs.Tab,
  };
  expect(trustedPage(sender)).toBe(true);
  expect(panelTabId(sender)).toBe(42);
  expect(panelTabId({ ...sender, url: `chrome-extension://${id}/options.html` })).toBeNull();
  expect(panelTabId({ id, url: `chrome-extension://${id}/panel.html?tabId=42` })).toBeNull();
});
