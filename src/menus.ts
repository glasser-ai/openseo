/**
 * The context menu.
 *
 * Every entry is a neutral destination — Trends, PageSpeed, archive.org, a
 * site: query. None of them deep-links into a paid SEO tool, because a menu
 * entry that opens someone's pricing page is an advert, not a feature.
 * Anything needing paid data goes through a Run in the panel instead, where the
 * cost is shown before it is spent.
 */
/** Its own literal types — this module touches no chrome types, so a test can
    import it directly. */
export type MenuContext = "all" | "page" | "selection" | "link" | "image";
export type MenuItem = {
  readonly id: string;
  readonly title: string;
  readonly contexts: readonly MenuContext[];
  readonly parentId?: string;
  readonly type?: "separator";
  readonly template?: string;
};

export const CONTEXT_MENUS: readonly MenuItem[] = [
  { id: "openseo", title: "OpenSEO", contexts: ["all"] },
  { id: "openseo-panel", title: "Open the OpenSEO panel", parentId: "openseo", contexts: ["all"] },
  { id: "sep-1", title: "", parentId: "openseo", type: "separator", contexts: ["all"] },
  {
    id: "google-trends",
    title: "Look up in Google Trends",
    parentId: "openseo",
    contexts: ["selection"],
    template: "https://trends.google.com/trends/explore?q={selection}",
  },
  {
    id: "pagespeed",
    title: "Check with PageSpeed Insights",
    parentId: "openseo",
    contexts: ["all"],
    template: "https://pagespeed.web.dev/analysis?url={href}",
  },
  {
    id: "archive",
    title: "View history on archive.org",
    parentId: "openseo",
    contexts: ["all"],
    template: "https://web.archive.org/web/{hostname}",
  },
  { id: "sep-2", title: "", parentId: "openseo", type: "separator", contexts: ["all"] },
  {
    id: "site-google",
    title: "Indexed pages on Google",
    parentId: "openseo",
    contexts: ["all"],
    template: "https://www.google.com/search?q=site%3A{hostname}",
  },
  {
    id: "site-bing",
    title: "Indexed pages on Bing",
    parentId: "openseo",
    contexts: ["all"],
    template: "https://www.bing.com/search?q=site%3A{hostname}",
  },
];

const TEMPLATES = new Map(
  CONTEXT_MENUS.filter((item) => item.template !== undefined).map((item) => [
    item.id,
    item.template as string,
  ]),
);

/** Every segment is encoded: unencoded selected text turns & and # into
    parameter separators. */
export function resolveMenuTarget(
  menuItemId: string,
  context: { pageUrl: string; selectionText: string },
): string | null {
  const template = TEMPLATES.get(menuItemId);
  if (template === undefined) return null;
  let url: URL;
  try {
    url = new URL(context.pageUrl);
  } catch {
    return null;
  }
  return template
    .replace("{origin}", encodeURIComponent(url.origin))
    .replace("{href}", encodeURIComponent(url.href))
    .replace("{hostname}", encodeURIComponent(url.hostname))
    .replace("{selection}", encodeURIComponent(context.selectionText.trim()));
}
