import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// OpenSEO's manifest is the trust statement itself, so every entry records why
// it is here. Nothing is requested that the panel does not need, and no page
// content ever leaves the browser.
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: ".",
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: ({ mode }) => ({
    name: mode === "development" ? "OpenSEO (Dev)" : "OpenSEO",
    description:
      "Look up any domain's traffic, backlinks and keywords through the open glasser API. No page content is sent.",
    // activeTab and scripting: the panel is a fixed container **injected into the
    // page**, because a popup cannot sit full-height against the right edge.
    // Injection happens only on the gesture itself — an icon click,
    // Alt+D or the context menu — and only on that tab; what is injected is an
    // iframe pointing at the extension's own page, and that script reads nothing
    // from the page.
    // alarms: how pending requests are recovered after the worker is killed, and
    // not optional.
    permissions: ["storage", "activeTab", "scripting", "contextMenus", "alarms"],
    // API host permission. Public RDAP requests use CORS.
    host_permissions: ["https://api.glasser.ai/*"],
    // The in-page report loads an extension iframe with a session-specific URL.
    web_accessible_resources: [
      { resources: ["panel.html"], matches: ["<all_urls>"], use_dynamic_url: true },
    ],
    options_ui: { page: "options.html", open_in_tab: true },
    action: { default_title: mode === "development" ? "OpenSEO (Dev)" : "OpenSEO" },
    commands: {
      "open-panel": {
        suggested_key: { default: "Alt+D" },
        description: "Open OpenSEO for this tab",
      },
    },
  }),
});
