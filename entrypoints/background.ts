import { persistRecoveredPanel } from "../src/domain/persist.js";
import { lookupRegistration } from "../src/domain/rdap.js";
import {
  peekLookup,
  peekTraffic,
  readReportState,
  runLookup,
  runTraffic,
} from "../src/domain/service.js";
import { recover } from "../src/glasser/runner.js";
import {
  patchSettings,
  reconcileReservations,
  type Settings,
  writeOffPending,
} from "../src/ledger/store.js";
import { CONTEXT_MENUS, resolveMenuTarget } from "../src/menus.js";
import { panelTabId, trustedPage } from "../src/trusted.js";

/**
 * The service worker — the only thing in the extension that makes network calls.
 *
 * It is killed and recreated repeatedly (terminated after 30 seconds idle, and
 * for any single fetch over 30 seconds), so nothing here holds state that has to
 * stay alive to be correct: recovery runs off the pending records in
 * chrome.storage plus an alarm.
 */
const RECOVERY_ALARM = "openseo:recover";

export default defineBackground(() => {
  const isDev = import.meta.env.DEV;
  void chrome.action.setBadgeText({ text: isDev ? "DEV" : "" });
  if (isDev) void chrome.action.setBadgeBackgroundColor({ color: "#555555" });

  // First thing, and necessarily before any Key is written: chrome.storage.local
  // is **readable by content scripts** by default.
  // Keep the Key and ledger restricted to extension pages.
  //
  // Note this blocks **content scripts**, not the extension's own pages — the
  // popup and the settings page still read storage directly, deliberately. Do
  // not read this line as "the Key is invisible to the panel".
  void boot();

  chrome.runtime.onInstalled.addListener(() => {
    void boot();
    createMenus();
  });
  chrome.runtime.onStartup.addListener(() => void boot());

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECOVERY_ALARM) void recover(persistRecoveredPanel);
  });

  // Toggle the in-page report for the tab selected by the user.
  chrome.action.onClicked.addListener((tab) => {
    void togglePanel(tab.id);
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "openseo-panel") {
      void togglePanel(tab?.id);
      return;
    }
    const url = resolveMenuTarget(String(info.menuItemId), {
      pageUrl: info.pageUrl ?? tab?.url ?? "",
      selectionText: info.selectionText ?? "",
    });
    if (url) void chrome.tabs.create({ url });
  });

  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === "open-panel") void togglePanel(tab?.id);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!trustedPage(sender)) {
      sendResponse({ ok: false, reason: "This action requires an OpenSEO page." });
      return false;
    }
    const payload = message as {
      type?: string;
      patch?: Partial<Settings>;
      tabId?: number;
      url?: string;
      lookup?: string;
      domain?: string;
      dark?: boolean;
      idemKey?: string;
      force?: boolean;
    };

    if (payload.type === "openseo:settings" && payload.patch) {
      patchSettings(payload.patch).then(
        (settings) => sendResponse({ ok: true, settings }),
        (error: unknown) => sendResponse({ ok: false, reason: String(error) }),
      );
      return true;
    }
    if (payload.type === "openseo:site") {
      const tabId = panelTabId(sender);
      if (tabId !== null) {
        chrome.tabs.get(tabId).then(sendResponse, () => sendResponse(null));
      } else {
        sendResponse(null);
      }
      return true;
    }
    // Domain data for the panel. All of it runs in the worker, so the Key and the
    // ledger are not exposed to the panel page either.
    // The panel nudges this while waiting on a request already dispatched.
    // Recovery is otherwise on a once-a-minute alarm, but these Endpoints often
    // finish in seconds — there is no reason to leave someone watching a loading
    // state for a minute. recover is idempotent (settlement is recorded once per
    // runId), so extra nudges cost nothing.
    // Registration goes to the public RDAP registry — free, no Key, and not
    // through glasser.
    if (payload.type === "openseo:registration" && payload.domain) {
      lookupRegistration(payload.domain).then(sendResponse, () =>
        sendResponse({ kind: "failed", reason: "could not reach the domain registry" }),
      );
      return true;
    }
    if (payload.type === "openseo:report-state" && payload.domain && payload.lookup) {
      readReportState(payload.lookup as never, payload.domain).then(sendResponse, () =>
        sendResponse(null),
      );
      return true;
    }
    if (payload.type === "openseo:resume") {
      recover(persistRecoveredPanel).then(
        () => sendResponse({ ok: true }),
        () => sendResponse({ ok: false }),
      );
      return true;
    }
    if (payload.type === "openseo:lookup" && payload.lookup && payload.domain) {
      runLookup(payload.lookup as never, payload.domain, payload.force === true).then(
        sendResponse,
        (error: unknown) => sendResponse({ ok: false, reason: String(error) }),
      );
      return true;
    }
    // Cache reads only. Used when the panel mounts: no request, no charge, and
    // no Key needed.
    if (payload.type === "openseo:peek" && payload.lookup && payload.domain) {
      peekLookup(payload.lookup as never, payload.domain).then(sendResponse, () =>
        sendResponse(null),
      );
      return true;
    }
    if (payload.type === "openseo:peek-traffic" && payload.domain) {
      peekTraffic(payload.domain).then(sendResponse, () => sendResponse(null));
      return true;
    }
    /**
     * The toolbar icon follows the theme.
     *
     * The mark comes in two forms: a black head with an orange goggle strap,
     * and an all-orange one **for dark backgrounds only**. On a dark toolbar
     * the black head disappears entirely, leaving one orange strap that looks
     * like a fault. A service worker has no matchMedia,
     * so an extension page reports it instead.
     */
    if (payload.type === "openseo:theme" && typeof payload.dark === "boolean") {
      const dir = payload.dark ? "icon-dark" : "icon";
      void chrome.action.setIcon({
        path: {
          16: `/${dir}/16.png`,
          32: `/${dir}/32.png`,
          48: `/${dir}/48.png`,
          128: `/${dir}/128.png`,
        },
      });
      return false;
    }
    // Discharges a suspended record. Without this path, one Key rotation would
    // leave a reservation holding the cap forever, so the extension could never
    // buy anything again and there would be no way back.
    if (payload.type === "openseo:write-off" && payload.idemKey) {
      writeOffPending(payload.idemKey).then(
        () => sendResponse({ ok: true }),
        (error: unknown) => sendResponse({ ok: false, reason: String(error) }),
      );
      return true;
    }
    if (payload.type === "openseo:traffic" && payload.domain) {
      runTraffic(payload.domain, payload.force === true).then(sendResponse, (error: unknown) =>
        sendResponse({ ok: false, reason: String(error) }),
      );
      return true;
    }
    return false;
  });
});

/** Insert the report over the website; the content script also handles closing it. */
async function togglePanel(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["/content-scripts/mount.js"],
    });
  } catch {
    // Chrome pages and the Web Store do not allow script injection.
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL("/panel.html?unavailable=1") });
    } catch (error) {
      console.warn("[OpenSEO] could not open the report", error);
    }
  }
}

async function boot(): Promise<void> {
  await lockStorage();
  await chrome.alarms.create(RECOVERY_ALARM, { periodInMinutes: 1 });
  // Reconciles reservations against pending records: reserve() and putPending()
  // are two writes, and being killed between them leaves an orphan reservation,
  // which gradually blocks the spending cap.
  await reconcileReservations();
  void recover(persistRecoveredPanel);
}

async function lockStorage(): Promise<void> {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch (error) {
    // Older Chrome versions lack this method. It is a security property and
    // should not disappear silently.
    console.warn("[OpenSEO] could not restrict storage to trusted contexts", error);
  }
}

/** Creates the menu items only. The listener is registered at the top level —
    inside this callback, nothing would be listening after a worker restart. */
function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    for (const item of CONTEXT_MENUS) {
      const { template: _template, ...rest } = item;
      chrome.contextMenus.create(rest as chrome.contextMenus.CreateProperties);
    }
  });
}
