import type { RankedRow } from "../domain/lookups.js";
import { compact } from "../domain/traffic.js";

type Kind = "competitors" | "top-pages";

const COLUMNS: Record<Kind, readonly [string, string, string]> = {
  // A competitor's visits are its whole site's, not only the shared keywords':
  // the column says so, or the two figures read as one overlap.
  competitors: ["Domain", "Shared keywords", "Site visits"],
  "top-pages": ["Page", "Visits", "Keywords"],
};

/**
 * Competing domains or the domain's top pages, in the Provider's order: both
 * inputs asked for that order (shared keywords, then traffic), so the table
 * keeps it rather than sorting again.
 *
 * Each name opens the site or page itself in a new tab, so a competitor can be
 * inspected next with one more OpenSEO click there.
 */
export function RankedTable({
  kind,
  rows,
  domain,
}: {
  readonly kind: Kind;
  readonly rows: readonly RankedRow[];
  readonly domain: string;
}) {
  const [first, second, third] = COLUMNS[kind];
  const count = (value: number | null) => (value === null ? "—" : compact(Math.round(value)));
  return (
    <div className="mt-4">
      <table className="keyword-table ranked-table">
        <caption>
          {rows.length} {kind === "competitors" ? "domains by shared keywords" : "pages by visits"}
        </caption>
        <thead>
          <tr>
            <th scope="col">{first}</th>
            <th scope="col">{second}</th>
            <th scope="col">{third}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = linkOf(row.name);
            const label = kind === "top-pages" ? pageLabel(row.name, domain) : row.name;
            return (
              <tr key={row.name}>
                <td>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-muted-foreground/50 underline-offset-3 hover:text-foreground hover:decoration-current"
                    >
                      {label}
                    </a>
                  ) : (
                    label
                  )}
                </td>
                <td>{count(kind === "competitors" ? row.keywords : row.visits)}</td>
                <td>{count(kind === "competitors" ? row.visits : row.keywords)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A bare domain becomes its https home page; a page URL stays itself. Only
    http(s) becomes a link, because the text comes from a Provider. */
export function linkOf(name: string): string | null {
  if (/^https?:\/\/[^\s]+$/i.test(name)) return name.replace(/^http:/i, "https:");
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(name)) return `https://${name}`;
  return null;
}

/** A page on the inspected domain reads as its path; one on a subdomain keeps
    its host, or two "/" rows could be different sites. */
export function pageLabel(url: string, domain: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = `${parsed.pathname}${parsed.search}` || "/";
    return host === domain.replace(/^www\./, "") ? path : `${host}${path === "/" ? "" : path}`;
  } catch {
    return url;
  }
}
