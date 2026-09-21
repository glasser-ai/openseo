import { useEffect, useState } from "react";
import { type Registration as Record_, rdapViewerUrl } from "../domain/rdap.js";
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
        {/*
          The **date** is the figure, and the age is its caption.
          
          It was the other way round: "16 yr" large, with the date demoted to
          the grey line under it. But the two blocks sit side by side, and the
          one beside this prints a date — so the pair read as two different
          kinds of thing, and the eye had to convert one back into the other to
          compare them. Registered 2010-03-19 against expires 2031-03-19 is one
          comparison; "16 yr" against 2031-03-19 is two.
          
          The age keeps the colour band, because that is what the band is for:
          the date carries the fact, the colour carries whether it is old.
        */}
        {registered !== null && (
          <div className="min-w-0">
            <div className="text-figure font-semibold leading-none tabular-nums">
              {day(registered)}
            </div>
            <div className="mt-1 text-small text-muted-foreground">
              registered ·{" "}
              <span className={TONE_TEXT[toneOf("domain-age", months(registered))]}>
                {age(registered)}
              </span>
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
        {registrar ? `${registrar} · ` : ""}
        {/*
          The provenance line is the claim; the link is where to check it.
          
          It named a record and gave no way to open one — the only figures in
          the panel a reader could not trace back. The link goes to a **readable
          copy** of that record, not to the JSON this panel parses: see
          rdapViewerUrl. Same link style as View Run on the paid cards.
        */}
        <a
          href={rdapViewerUrl(domain)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-muted-foreground/50 underline-offset-3 hover:text-foreground hover:decoration-current"
          title="Read this domain's registry record"
        >
          Public registry record (RDAP) ↗
        </a>
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

/**
 * "18 yr old" or "7 mo old", to go under the registration date — the date says
 * when, and this says how long ago without the reader doing the arithmetic.
 *
 * The whole phrase is built here, including the word "old", because the first
 * month has no duration to qualify: a domain registered last week is "new", and
 * "new old" is not a phrase.
 */
function age(iso: string): string {
  const total = months(iso);
  if (total < 1) return "new";
  if (total < 24) return `${total} mo old`;
  return `${Math.floor(total / 12)} yr old`;
}
