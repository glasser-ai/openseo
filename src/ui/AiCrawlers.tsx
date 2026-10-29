import { AI_CRAWLERS, isAllowed, robotsFor } from "../domain/robots.js";
import { CardTitle, ScanState } from "./PageChecks.jsx";
import { TONE_TEXT } from "./palette.js";
import { Figure } from "./primitives.jsx";
import type { PageScan } from "./usePage.js";

/**
 * Which AI crawlers the site's robots.txt lets in, read for the home page.
 * Sits above the citations card because it answers the question before it:
 * a site that blocks the answer crawlers is not cited for want of access.
 */
export function AiCrawlers({ scan }: { readonly scan: PageScan }) {
  if (scan.kind !== "ok") return <ScanState scan={scan} title="AI crawler access" />;
  const robots = robotsFor(scan.facts.robots);
  if (robots === null) {
    return (
      <section className="report-card">
        <CardTitle title="AI crawler access" note="robots.txt · free" />
        <p className="mt-3 text-warn-text">
          robots.txt could not be read
          {scan.facts.robots.kind === "unreadable" ? ` (${scan.facts.robots.reason})` : ""}, so
          there is no answer.
        </p>
      </section>
    );
  }
  const rows = AI_CRAWLERS.map((crawler) => ({
    ...crawler,
    allowed: isAllowed(robots, crawler.token, "/"),
  }));
  const count = (use: "answers" | "training") => {
    const group = rows.filter((row) => row.use === use);
    return `${group.filter((row) => row.allowed).length}/${group.length}`;
  };
  return (
    <section className="report-card">
      <CardTitle title="AI crawler access" note="robots.txt · free" />
      <div className="mt-3 grid grid-cols-2 gap-x-4">
        <Figure hero value={count("answers")} caption="Answer crawlers allowed" />
        <Figure hero value={count("training")} caption="Training crawlers allowed" />
      </div>
      <table className="keyword-table crawler-table mt-6">
        <thead>
          <tr>
            <th scope="col">Crawler</th>
            <th scope="col">Used for</th>
            <th scope="col">Access</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.token}>
              <td>
                {row.token}
                <span className="block text-small text-muted-foreground">{row.owner}</span>
              </td>
              <td>{row.use === "answers" ? "AI answers" : "Model training"}</td>
              {/* Blocking a training crawler is a choice, not a fault, so only
                  a blocked answer crawler is coloured as a warning. */}
              <td
                className={
                  row.allowed ? TONE_TEXT.good : row.use === "answers" ? TONE_TEXT.warn : ""
                }
              >
                {row.allowed ? "Allowed" : "Blocked"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="result-source">
        {scan.facts.robots.kind === "missing"
          ? "The site has no robots.txt, so every crawler is allowed."
          : "Read from the site's robots.txt for the home page. A crawler can ignore it."}
      </p>
    </section>
  );
}
