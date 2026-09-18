import type { KeywordRow, LookupField } from "../domain/lookups.js";
import { toneOf } from "../domain/thresholds.js";
import { compact, parseCompact } from "../domain/traffic.js";
import { TONE_TEXT } from "./palette.js";

/**
 * Display old formatted cache entries without discarding or buying them again.
 *
 * Sorted by **the traffic a keyword actually brings**, descending — not by the
 * Provider's order, and not by search volume. Volume counts how many people
 * search; traffic counts how many of them arrive here. A 10K-volume term sitting
 * at position 40 brings almost nobody, yet by volume it would sort to the top.
 * Rows cached before the traffic column existed fall back to volume, and with
 * neither, to position.
 *
 * Sorting always runs on **numbers**: the rendered forms are `12K` and `1,140`,
 * which compare as text in an order that puts 9 above 12K.
 */
export function keywordDisplay(rows: readonly LookupField[], keywords?: readonly KeywordRow[]) {
  // A 0 is **measured**: nobody is bidding on that term. The dash is for "there
  // is no such figure". Collapsing the two into one symbol is the same class of
  // mistake as hiding unattributed traffic in a background colour.
  const money = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";
  const count = (value: number | null | undefined) =>
    typeof value === "number" ? compact(Math.round(value)) : "—";

  const shown = keywords
    ? keywords.map((row) => ({
        keyword: row.keyword,
        position: String(row.position),
        traffic: count(row.traffic),
        volume: row.monthlyVolume === null ? "—" : row.monthlyVolume.toLocaleString("en-US"),
        cpc: money(row.cpc),
        byTraffic: row.traffic ?? -1,
        byVolume: row.monthlyVolume ?? -1,
        byPosition: row.position,
      }))
    : rows.map((row) => {
        const match = /^#([^·]+?)(?:\s*·\s*(.+)\/mo)?$/.exec(row.value);
        const position = match?.[1]?.trim() ?? row.value;
        const volume = match?.[2]?.trim() ?? "—";
        // The legacy cache path has only the formatted string, so it has to be
        // read back to a number before it can be sorted.
        const parsed = parseCompact(volume);
        const rank = Number(position);
        return {
          keyword: row.label,
          position,
          traffic: "—",
          volume,
          cpc: "—",
          byTraffic: -1,
          byVolume: Number.isFinite(parsed) ? parsed : -1,
          byPosition: Number.isFinite(rank) ? rank : Number.POSITIVE_INFINITY,
        };
      });

  return shown
    .sort(
      (a, b) => b.byTraffic - a.byTraffic || b.byVolume - a.byVolume || a.byPosition - b.byPosition,
    )
    .map(({ byTraffic, byVolume, byPosition, ...row }) => row);
}

export function KeywordTable({
  rows,
  keywords,
}: {
  readonly rows: readonly LookupField[];
  readonly keywords?: readonly KeywordRow[];
}) {
  const shown = keywordDisplay(rows, keywords);
  return (
    <div className="mt-4">
      <table className="keyword-table">
        {/*
          Be clear about **which part the Provider decided**.
          These 25 are the first 25 in the Provider's own order (the endpoint's
          input schema is additionalProperties: false over target,
          location_code, language_code and limit, with no order_by to send), and
          all we do is reorder those 25. So this is not the domain's top 25 by
          traffic — and "by traffic" alone would be read as exactly that.
          Rows cached before the traffic column really do sort by volume, so the
          caption says volume for them.
        */}
        <caption>
          {shown.length} keywords · Provider's selection, sorted by{" "}
          {shown.some((row) => row.traffic !== "—") ? "traffic" : "monthly volume"}
        </caption>
        <thead>
          <tr>
            <th scope="col">Keyword</th>
            <th scope="col">Position</th>
            {/* How many visits a keyword **brings** is a different question
                from how many times it is searched. */}
            <th scope="col">Traffic</th>
            <th scope="col">Volume</th>
            <th scope="col">CPC</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <tr key={`${row.keyword}:${index}`}>
              <td>{row.keyword}</td>
              {/*
                Only the position column is toned. Position is bounded and
                directional: the top three take most of the clicks, and 4-10 is
                still page one. Monthly volume is **an unbounded count** with no
                direction — colouring it would invent a threshold for "how much
                is a lot".

                position is a string: the legacy cache path extracts it from
                "#3 · 12K/mo" by regex, and when that fails it is not a number.
                Number() then gives NaN and toneOf returns neutral.
              */}
              <td className={TONE_TEXT[toneOf("keyword-position", Number(row.position))]}>
                {row.position}
              </td>
              <td>{row.traffic}</td>
              <td>{row.volume}</td>
              <td className="mono">{row.cpc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
