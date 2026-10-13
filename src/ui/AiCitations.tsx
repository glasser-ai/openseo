import type { LookupField } from "../domain/lookups.js";
import { parseCompact } from "../domain/traffic.js";
import { Figure } from "./primitives.jsx";

const PLATFORMS = [
  "ChatGPT",
  "Perplexity",
  "Google AI Overviews",
  "Google AI Mode",
  "Gemini",
  "Copilot",
  "Grok",
] as const;

/**
 * The AI citations card: everything the Provider returns, nothing held back.
 *
 * Every platform gets a row, zeros included, with both of its numbers —
 * citations and pages cited. An earlier version folded the zeros into one line
 * and dropped pages per platform, which hid half the answer. Rows are ordered
 * by citations so the leading platform reads first; the bar is the citation
 * count against the leading platform.
 */
export function AiCitations({ fields }: { readonly fields: readonly LookupField[] }) {
  const value = (label: string) => fields.find((field) => field.label === label)?.value;
  const rows = PLATFORMS.flatMap((label) => {
    const citations = value(label);
    if (citations === undefined) return [];
    // Results saved before pages were kept per platform have no pages field.
    return [
      { label, citations, pages: value(`${label} pages`) ?? "—", count: parseCompact(citations) },
    ];
  }).sort((a, b) => (b.count || 0) - (a.count || 0));
  const citing = rows.filter((row) => row.count > 0).length;
  const top = Math.max(...rows.map((row) => row.count || 0), 1);
  const total = value("AI citations");
  const pages = value("Pages cited");
  const sum = rows.reduce((acc, row) => acc + (row.count || 0), 0);
  const totalCount = total === undefined ? Number.NaN : parseCompact(total);

  return (
    <>
      <div className="mt-3 grid grid-cols-3 gap-x-4">
        {total !== undefined && <Figure hero value={total} caption="AI citations" />}
        {pages !== undefined && <Figure hero value={pages} caption="Pages cited" />}
        <Figure hero value={`${citing}/${rows.length}`} caption="Platforms citing" />
      </div>

      <table className="keyword-table mt-6">
        <thead>
          <tr>
            <th scope="col">Platform</th>
            <th scope="col">Citations</th>
            <th scope="col">Pages</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={row.count > 0 ? "" : "text-muted-foreground"}>
              <td>
                {row.label}
                <div className="bar-track mt-1 h-1 w-full rounded-full bg-border">
                  {row.count > 0 && (
                    <div
                      className="bar-fill h-full rounded-full bg-accent"
                      style={{ width: `${Math.max((row.count / top) * 100, 3)}%` }}
                    />
                  )}
                </div>
              </td>
              <td className="tabular-nums">{row.citations}</td>
              <td className="tabular-nums">{row.pages}</td>
            </tr>
          ))}
          {total !== undefined && (
            <tr className="font-semibold">
              <td>All platforms</td>
              <td className="tabular-nums">{total}</td>
              <td className="tabular-nums">{pages ?? "—"}</td>
            </tr>
          )}
        </tbody>
      </table>
      {/* Only when it is true: Ahrefs' total can include sources it does not
          name, and then the rows will not add up to it. */}
      {Number.isFinite(totalCount) && totalCount > sum && (
        <p className="mt-3 text-small text-muted-foreground">
          The total also counts sources Ahrefs does not list by name, so the platforms add up to
          less.
        </p>
      )}
    </>
  );
}
