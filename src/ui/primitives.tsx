import type { ReactNode } from "react";
import type { Tone } from "../domain/thresholds.js";
import { TONE_TEXT, TONE_WORD } from "./palette.js";

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
      <div className="mt-1 text-small text-muted-foreground">
        {caption}
        <ToneWord tone={tone} />
      </div>
    </div>
  );
}

/** " · good", in the tone's text colour; nothing for neutral. Colour is then a
    second channel, not the only one. */
export function ToneWord({ tone }: { readonly tone: Tone }) {
  if (tone === "neutral") return null;
  return <span className={TONE_TEXT[tone]}> · {TONE_WORD[tone]}</span>;
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

/**
 * The OpenSEO mark. Its head is black, so on a dark surface only the orange
 * strap would show and read as a fault; the all-orange form is for dark
 * backgrounds, the same rule the toolbar icon follows.
 */
export function Logo({
  className,
  alt = "",
}: {
  readonly className: string;
  readonly alt?: string;
}) {
  return (
    <picture className="contents">
      <source srcSet="/icon-dark/32.png" media="(prefers-color-scheme: dark)" />
      <img src="/icon/32.png" alt={alt} className={className} />
    </picture>
  );
}
