import type { ReactNode } from "react";
import type { Tone } from "../domain/thresholds.js";
import { TONE_TEXT } from "./palette.js";

export const Heading = ({ children }: { readonly children: ReactNode }) => (
  <h2 className="text-section font-semibold tracking-tight">{children}</h2>
);
export const Card = ({ children }: { readonly children: ReactNode }) => (
  <section className="report-card">{children}</section>
);
export const Prose = ({ children }: { readonly children: ReactNode }) => (
  <p className="mt-2 text-body text-muted-foreground">{children}</p>
);
export const Status = ({
  children,
  bad = false,
}: {
  readonly children: ReactNode;
  readonly bad?: boolean;
}) => (
  <p
    role={bad ? "alert" : "status"}
    className={`text-body ${bad ? "text-bad-text" : "text-muted-foreground"}`}
  >
    {children}
  </p>
);

export function Figure({
  value,
  caption,
  hero = false,
  tone = "neutral",
}: {
  readonly value: ReactNode;
  readonly caption: string;
  readonly hero?: boolean;
  /**
   * Tones **the figure** only, never the caption — the caption line is always
   * muted-foreground, which is the single colour for secondary text. The figure
   * is 20 or 28px semibold, and the three -text tokens clear 5.2 on white, which
   * is ample at that size.
   */
  readonly tone?: Tone;
}) {
  return (
    <div className="min-w-0">
      <div
        data-tone={tone}
        className={`${hero ? "text-hero" : "text-figure"} font-semibold leading-tight tracking-tight tabular-nums [overflow-wrap:normal] [hyphens:none] ${TONE_TEXT[tone]}`}
      >
        {value}
      </div>
      <div className="mt-1 text-small text-muted-foreground">{caption}</div>
    </div>
  );
}

/** Metadata wraps: a narrow panel must not hide the Provider or charge. */
export function Footer({
  age,
  stale,
  attribution,
  runUrl,
  charge,
}: {
  readonly age: string;
  readonly stale: boolean;
  readonly attribution: { readonly label: string; readonly href: string } | null;
  readonly runUrl: string;
  readonly charge: string | null;
}) {
  return (
    <footer className="result-source">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={stale ? "text-warn-text" : ""}>
          {stale ? "Outdated · " : "Saved · "}
          {age}
        </span>
        <span>{charge === null ? "Charge unknown" : `Last charge ${charge}`}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {attribution && (
          <a href={attribution.href} target="_blank" rel="noopener noreferrer">
            {attribution.label}
          </a>
        )}
        {runUrl && (
          <a className="ml-auto" href={runUrl} target="_blank" rel="noopener noreferrer">
            View Run ↗
          </a>
        )}
      </div>
    </footer>
  );
}
