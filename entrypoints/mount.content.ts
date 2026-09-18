/**
 * Mounts the panel against the right edge of the page.
 *
 * Why not a popup: Chrome anchors a popup to the toolbar icon, caps it at 600px
 * tall, and gives us no say in its position — none of which produces a
 * **right-edge, full-height** panel. Why not chrome.sidePanel: that narrows the
 * page rather than sitting over it. So a fixed-position container is injected
 * into the page instead.
 *
 * What is injected is only an iframe containing **our own extension page**. This
 * script reads nothing from the page: it creates one node and removes it on
 * close. The iframe uses the extension origin, so its contents are cross-origin;
 * a closed shadow root hides the inner nodes, though the host page can still
 * affect the outer container.
 *
 * It is injected on demand by executeScript from an action click, Alt+D or the
 * context menu, so it only ever happens on the tab where that gesture was made.
 * Doing it again closes the panel.
 */
const HOST_ID = "openseo-panel-host";
const WIDTH = 560;

export default defineContentScript({
  matches: [],
  registration: "runtime",
  main() {
    // A second invocation closes it. executeScript re-runs this file, so the
    // toggle lives here.
    const open = document.getElementById(HOST_ID);
    if (open) {
      open.dispatchEvent(new Event("openseo:remove"));
      return;
    }

    const previousFocus = document.activeElement;
    const host = document.createElement("div");
    host.id = HOST_ID;
    // The page's CSS may select this node by id, so every declaration is
    // !important.
    const set = (key: string, value: string): void =>
      host.style.setProperty(key, value, "important");
    set("position", "fixed");
    set("inset", "0 0 0 auto");
    set("width", `${WIDTH}px`);
    set("max-width", "100vw");
    set("z-index", "2147483647");
    set("margin", "0");
    set("padding", "0");
    set("border", "0");
    // The **only** separation between the panel and the host page, and this
    // script runs in the page, where the extension's tokens are unavailable.
    // Do not branch on prefers-color-scheme: that reports the **system** theme
    // while the panel sits against the **page's** — someone on a light system
    // opening a dark site would get the light shadow and lose the edge again.
    // A mid grey reads against both, so the edge is fixed and the shadow is only
    // atmosphere.
    set("border-left", "1px solid rgba(128,128,128,.35)");
    set("box-shadow", "-14px 0 40px rgba(0,0,0,.18)");
    set("color-scheme", "light dark");

    // closed: page scripts cannot reach host.shadowRoot and cannot get inside.
    const shadow = host.attachShadow({ mode: "closed" });
    const frame = document.createElement("iframe");
    frame.src = chrome.runtime.getURL("/panel.html");
    frame.setAttribute("title", "OpenSEO");
    frame.style.cssText = "width:100%;height:100%;border:0;display:block;color-scheme:normal";
    shadow.append(frame);
    document.documentElement.append(host);

    const close = (): void => {
      host.remove();
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKey);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
    // The close button lives in the panel's own header, so it can only call
    // across the iframe boundary.
    // Only messages from our own frame are accepted — the page can post here
    // too, but it is not the source.
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frame.contentWindow) return;
      if ((event.data as { type?: string } | null)?.type === "openseo:close") close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    host.addEventListener("openseo:remove", close, { once: true });
    frame.addEventListener("load", () => frame.focus(), { once: true });
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKey);
  },
});
