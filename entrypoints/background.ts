import { BADGE_COLOR, BADGE_PENDING, badgeHost, badgeLabel, canLookUp } from "../src/badge.js";
import { isOutdated } from "../src/domain/cache.js";
import { LOOKUPS } from "../src/domain/lookups.js";
import { scanPage } from "../src/domain/page.js";
import { persistRecoveredPanel } from "../src/domain/persist.js";
import { lookupRegistration } from "../src/domain/rdap.js";
import {
  peekLookup,
  peekTraffic,
  priceCeilings,
  readReportState,
  retryRecoveredTimeout,
  runLookup,
  runTraffic,
} from "../src/domain/service.js";
import { ratesThisSite, siteDomain } from "../src/domain/site.js";
import { recover } from "../src/glasser/runner.js";
import {
  capsRaised,
  getSettings,
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

  // The Domain Rating badge. These listeners are registered unconditionally,
  // because a listener added later would be gone after a worker restart;
  // refreshBadge checks the permission itself.
  // Automatic lookups run only for the tab in front: opening twenty links in
  // background tabs must not buy twenty ratings nobody looked at.
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.url !== undefined || change.status === "complete")
      void refreshBadge(tabId, tab.url, change.status === "complete" && tab.active);
  });
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId).then(
      (tab) => refreshBadge(tabId, tab.url, tab.status === "complete"),
      () => undefined,
    );
  });
  // A tab that loaded in a window behind another one, or while Chrome was in
  // the background, is looked up when its window comes to the front.
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    chrome.tabs.query({ active: true, windowId }).then(
      ([tab]) =>
        tab?.id === undefined
          ? undefined
          : refreshBadge(tab.id, tab.url, tab.status === "complete"),
      () => undefined,
    );
  });
  // Every write of a Domain Rating result, whether from the panel or from
  // recovery after the worker was killed, goes through storage.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const settings = changes["openseo:settings"];
    if (settings) {
      // A refresh that read the old settings must not write after this one.
      badgeGeneration += 1;
    }
    // A new Key, a raised budget, or automatic lookups switched back on can
    // make a lookup that stopped before any request succeed now, so the hosts
    // it stopped on are tried again. The other settings must not.
    if (
      "openseo:key" in changes ||
      (settings &&
        (capsRaised(settings.oldValue, settings.newValue) ||
          (autoRatingOf(settings.newValue) && !autoRatingOf(settings.oldValue))))
    )
      autoLookedUp.clear();
    // Every tab: a badge switched off must clear in background tabs too.
    if (settings) void refreshAllBadges().then(refreshActiveBadge);
    else if ("openseo:key" in changes) void refreshActiveBadge();
    if (Object.keys(changes).some((key) => key.startsWith(DR_CACHE_PREFIX)))
      void refreshAllBadges();
    // Recovery records a failed Run in the ledger and saves no result, so a
    // badge waiting on it would otherwise keep its mark.
    else if ("openseo:ledger" in changes) void refreshPendingBadges();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECOVERY_ALARM) void recoverAll();
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
      market?: string;
      page?: string;
      ids?: unknown[];
    };

    if (payload.type === "openseo:settings" && payload.patch) {
      // The badges follow through storage.onChanged, which also sees settings
      // written by other pages.
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
    // The Page and AI search checks. The scan runs only in the tab that holds
    // this panel, under the activeTab grant from the gesture that opened it,
    // and reads only the facts PageFacts lists.
    if (payload.type === "openseo:page") {
      const tabId = panelTabId(sender);
      if (tabId === null) {
        sendResponse({ kind: "failed", reason: "This panel has no page." });
        return false;
      }
      chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: scanPage }).then(
        ([frame]) =>
          sendResponse(
            frame?.result
              ? { kind: "ok", facts: frame.result }
              : { kind: "failed", reason: "The page gave no answer." },
          ),
        () =>
          sendResponse({
            kind: "failed",
            reason: "Chrome did not let OpenSEO read this page. Reopen the panel and try again.",
          }),
      );
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
      readReportState(payload.lookup as never, payload.domain, payload.market).then(
        sendResponse,
        () => sendResponse(null),
      );
      return true;
    }
    if (payload.type === "openseo:resume") {
      recoverAll().then(
        () => sendResponse({ ok: true }),
        () => sendResponse({ ok: false }),
      );
      return true;
    }
    if (payload.type === "openseo:lookup" && payload.lookup && payload.domain) {
      runLookup(
        payload.lookup as never,
        payload.domain,
        payload.force === true,
        payload.market,
      ).then(sendResponse, (error: unknown) => sendResponse({ ok: false, reason: String(error) }));
      return true;
    }
    // Cache reads only. Used when the panel mounts: no request, no charge, and
    // no Key needed.
    if (payload.type === "openseo:peek" && payload.lookup && payload.domain) {
      peekLookup(payload.lookup as never, payload.domain, payload.market).then(sendResponse, () =>
        sendResponse(null),
      );
      return true;
    }
    // Free: inspect reports prices without a charge.
    if (payload.type === "openseo:prices" && Array.isArray(payload.ids)) {
      const subject =
        typeof payload.domain === "string"
          ? {
              domain: payload.domain,
              page: typeof payload.page === "string" ? payload.page : "",
              ...(typeof payload.market === "string" ? { market: payload.market } : {}),
            }
          : undefined;
      priceCeilings(
        payload.ids.filter((id): id is string => typeof id === "string"),
        subject,
      ).then(sendResponse, () => sendResponse({}));
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

const DR_ENDPOINT = LOOKUPS.find((lookup) => lookup.id === "domain-rating")?.endpoint ?? "";
/** Matches the key format in src/domain/cache.ts. */
const DR_CACHE_PREFIX = `openseo:panel:${DR_ENDPOINT}:`;

/**
 * Hosts already looked up automatically in this worker's life. A lookup that
 * fails without a cached answer (no Key, budget reached) would otherwise be
 * retried on every tab switch. The set empties when the worker restarts, which
 * bounds the retries without storing anything.
 */
const autoLookedUp = new Set<string>();

/** Recovery. A zero-charge timeout it finds gets the same one retry as on the
    live response; a badge lookup's retry passes the badge's checks right
    before it is sent. A click's retry needs no check beyond the runner's. */
const recoverAll = () =>
  recover(persistRecoveredPanel, (record) => {
    const host = record.domains[0];
    const automatic = record.automatic;
    if (automatic && host === undefined) return;
    retryRecoveredTimeout(
      record,
      automatic && host !== undefined
        ? () => admitAutomatic(automatic.tabId, host, { retry: true })
        : undefined,
    );
  });

/** The stored autoRating switch; a missing value is the default, on. */
const autoRatingOf = (value: unknown): boolean =>
  (value as Partial<Settings> | undefined)?.autoRating ?? true;

/** Bumped on every settings change; a refresh that started under older
    settings does not write the badge. */
let badgeGeneration = 0;

/** Sites with an automatic lookup between its start and its pending record. */
const starting = new Set<string>();

/** The site whose rating the badge shows for an address, or null. The panel
    reads the site, so the badge does too and shares its cache. Under a private
    suffix (tenant.github.io) the rating is the platform's, so there is none. */
function badgeSite(url: string | undefined): string | null {
  const page = badgeHost(url);
  return page && ratesThisSite(page) ? siteDomain(page) : null;
}

/** The site the tab shows now. Each await in a refresh can outlive a
    navigation, so a captured address is checked against this. */
async function currentSite(tabId: number): Promise<string | null> {
  return badgeSite((await chrome.tabs.get(tabId)).url);
}

/** A Domain Rating request for this site is in flight, from the badge or the
    panel, in this worker's life or a previous one. */
async function ratingRunning(host: string): Promise<boolean> {
  // Before admission there is no pending record yet.
  if (starting.has(host)) return true;
  try {
    return (await readReportState("domain-rating", host)).state === "running";
  } catch {
    return false;
  }
}

/**
 * Sets one tab's badge from the cache. With lookUp, and only when the
 * autoRating setting is on, a host with no fresh rating is looked up first; that
 * lookup goes through the same budgets as the panel.
 */
async function refreshBadge(tabId: number, url: string | undefined, lookUp = false): Promise<void> {
  try {
    const generation = badgeGeneration;
    let text = "";
    const settings = await getSettings();
    const host = badgeSite(url);
    if (settings.ratingBadge && host) {
      const entry = await peekLookup("domain-rating", host);
      const fresh = entry && !isOutdated(entry) ? entry : null;
      text = badgeLabel(fresh);
      if (!fresh && (await ratingRunning(host))) {
        // Settlement writes the ledger, and the ledger listener refreshes
        // every badge that still shows this mark, also after a failure that
        // saves nothing.
        text = BADGE_PENDING;
      } else if (
        !fresh &&
        lookUp &&
        settings.autoRating &&
        !autoLookedUp.has(host) &&
        canLookUp(host) &&
        // tab.active is per window: a reload in a minimized window is active
        // too, and nobody is looking at it.
        (await inFront(tabId))
      ) {
        // Checked and claimed again with no await in between: two refreshes
        // can both pass the check above while inFront runs, and a second
        // lookup could replay the first one's failed Run and retry it again.
        if (autoLookedUp.has(host)) {
          if (starting.has(host)) text = BADGE_PENDING;
        } else {
          autoLookedUp.add(host);
          starting.add(host);
          text = BADGE_PENDING;
          void runLookup("domain-rating", host, false, undefined, {
            tabId,
            admit: (attempt) => admitAutomatic(tabId, host, attempt),
          })
            .catch(() => undefined)
            .then(() => {
              starting.delete(host);
              // Another tab on the same site may show the mark too, and a
              // lookup stopped before admission writes no ledger to wake it.
              // If it stopped because this tab lost focus to another tab on
              // the same site, that tab is still waiting for its lookup.
              return Promise.all([refreshPendingBadges(), refreshActiveBadge()]);
            });
        }
      }
    }
    // The tab moved to another site during the awaits above; the refresh for
    // that navigation owns the badge.
    if ((await currentSite(tabId)) !== host) return;
    // Settings changed during the awaits; the refresh they started owns it.
    if (generation !== badgeGeneration) return;
    // A tab-specific empty text would hide the global DEV marker.
    if (!text && import.meta.env.DEV) text = "DEV";
    await chrome.action.setBadgeText({ tabId, text });
    if (text !== "DEV") await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
  } catch {
    // The tab closed while the cache was read.
  }
}

/**
 * The last check before an automatic lookup is admitted, run inside the
 * runner's admission section after the price is known. The settings and the
 * tab can change during the cache read, the focus check and the inspection;
 * the timeout retry passes through here too.
 */
async function admitAutomatic(
  tabId: number,
  host: string,
  attempt: { readonly retry: boolean },
): Promise<string | null> {
  const settings = await getSettings();
  const veto =
    !settings.ratingBadge || !settings.autoRating
      ? "Automatic Domain Rating lookups are off."
      : (await showsInFront(tabId, host))
        ? null
        : "The tab moved on before the lookup started. Try again.";
  // Stopped before any request, so a later visit may look it up. Not after a
  // timeout: the site already had its one retry, and handing it to another
  // tab on the same site would grant a second.
  if (veto !== null && !attempt.retry) autoLookedUp.delete(host);
  return veto;
}

/** The tab shows this site, selected, in the window that has focus. Focus is
    read first; the site, the selection and the window then come from one tab
    read, so a navigation in between cannot pass one check with each site. */
async function showsInFront(tabId: number, host: string): Promise<boolean> {
  try {
    const before = await chrome.tabs.get(tabId);
    const focused = (await chrome.windows.get(before.windowId)).focused;
    const tab = await chrome.tabs.get(tabId);
    return focused && tab.windowId === before.windowId && tab.active && badgeSite(tab.url) === host;
  } catch {
    return false;
  }
}

/** Badges still waiting for a settlement. Read from the badges themselves, so
    it survives a worker restart. */
async function refreshPendingBadges(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      const text = await chrome.action.getBadgeText({ tabId: tab.id }).catch(() => "");
      if (text === BADGE_PENDING) await refreshBadge(tab.id, tab.url);
    }),
  );
}

/** The tab is the selected one in the window that has focus. */
async function inFront(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) return false;
    return (await chrome.windows.get(tab.windowId)).focused;
  } catch {
    return false;
  }
}

async function refreshActiveBadge(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id !== undefined) await refreshBadge(tab.id, tab.url, tab.status === "complete");
}

async function refreshAllBadges(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id === undefined ? undefined : refreshBadge(tab.id, tab.url))),
  );
}

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
  void recoverAll();
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
