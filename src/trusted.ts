/** Accept our report iframe and top-level options page, not website content scripts. */
export function trustedPage(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    const own = new URL(chrome.runtime.getURL("/"));
    // The embedded report can use Chrome's dynamic resource host. sender.id
    // identifies our extension; website content scripts still have an HTTP(S) URL.
    return (
      url.protocol === own.protocol &&
      (url.pathname === "/panel.html" ||
        (url.host === own.host && url.pathname === "/options.html" && (sender.frameId ?? 0) === 0))
    );
  } catch {
    return false;
  }
}

/** The browser supplies the containing tab; ignore tab IDs supplied in a URL or message. */
export function panelTabId(sender: chrome.runtime.MessageSender): number | null {
  if (!trustedPage(sender) || !sender.url) return null;
  return new URL(sender.url).pathname === "/panel.html" ? (sender.tab?.id ?? null) : null;
}
