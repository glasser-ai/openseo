import { useEffect, useState } from "react";
import type { Registration as Record_ } from "../domain/rdap.js";
import { registrableDomain } from "../domain/site.js";
import { toneOf } from "../domain/thresholds.js";
import { TONE_TEXT } from "./palette.js";

type Reply =
  | { kind: "ok"; value: Record_; fetchedAt: number }
  | { kind: "unsupported" }
  | { kind: "failed"; reason: string };

/**
 * Registration details. **This section costs nothing** and needs no Key.
 *
 * The data comes from the public RDAP registry, so it is there the moment the
 * panel opens, with no Key and no agreement to spend — the one free block in the
 * panel. The browser fetches it from the registry directly; it is not relayed
 * through a server of ours.
 */
export function Registration({ domain }: { readonly domain: string }) {
  const [state, setState] = useState<Reply | null>(null);

  useEffect(() => {
    let live = true;
    setState(null);
    void chrome.runtime
      .sendMessage({ type: "openseo:registration", domain })
      .then((reply: Reply | null) => {
        if (live) setState(reply ?? { kind: "failed", reason: "no answer" });
      })
      .catch(() => {
        if (live) setState({ kind: "failed", reason: "no answer" });
      });
    return () => {
      live = false;
    };
  }, [domain]);

  // On a miss the whole block is omitted: a card saying "not found" is not
  // worth the space it takes.
  if (state === null || state.kind !== "ok") return null;
  const { registered, expires, registrar } = state.value;
  if (registered === null && expires === null) return null;

  return (
    <section className="report-card">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-section font-semibold tracking-tight">Domain</h2>
        <span className="min-w-0 break-all text-small text-muted-foreground">
          {registrableDomain(domain)} · free
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-4">
        {registered !== null && (
          <div className="min-w-0">
            <div
              className={`text-figure font-semibold leading-none tabular-nums ${TONE_TEXT[toneOf("domain-age", months(registered))]}`}
            >
              {age(registered)}
            </div>
            <div className="mt-1 text-small text-muted-foreground">
              old · registered {day(registered)}
            </div>
          </div>
        )}
        {expires !== null && (
          <div className="min-w-0">
            <div className="text-figure font-semibold leading-none tabular-nums">
              {day(expires)}
            </div>
            <div className="mt-1 text-small text-muted-foreground">expires</div>
          </div>
        )}
      </div>
      <p className="mt-4 border-t border-border pt-3 text-small text-muted-foreground">
        {registrar ? `${registrar} · ` : ""}Public registry record (RDAP)
      </p>
    </section>
  );
}

const day = (iso: string): string => iso.slice(0, 10);

/** Months since registration. The banding and the printed text use the same
    number rather than each computing their own. */
function months(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / (30.44 * 86_400_000)));
}

/** "18 yr" or "7 mo" — how old a domain is tends to be more useful than the
    exact date. */
function age(iso: string): string {
  const total = months(iso);
  if (total < 1) return "new";
  if (total < 24) return `${total} mo`;
  return `${Math.floor(total / 12)} yr`;
}
