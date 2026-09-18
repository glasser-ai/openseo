import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { SLOTS } from "../palette.js";

/*
 * The palette's contrast and colourblind separation are **read from style.css**
 * rather than from a transcribed copy.
 *
 * Copying the values into TypeScript would be easier to write, but then this
 * test guards the copy: someone editing only the CSS stays green while the
 * browser uses what they changed. So it parses the file itself.
 *
 * The two failures it exists to catch are both invisible to inspection:
 *  1. a set where every contrast ratio passes while colourblind separation
 *     collapses to deltaE 5.9 (blue and magenta indistinguishable);
 *  2. a well-meant contrast bump to 3, 5 and 6 that drops the set from deltaE
 *     16.7 to 5.2.
 */

// vitest runs in jsdom, where import.meta.url is not a file: URL, so this
// resolves from the repository root instead.
const css = readFileSync(resolve(process.cwd(), "src/ui/style.css"), "utf8");

/** Returns the contents of the braces following `head`, matched by depth rather
    than by counting brackets with a regex. */
function block(source: string, head: string): string {
  const start = source.indexOf(head);
  if (start < 0) throw new Error(`missing block: ${head}`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0)
      return source.slice(source.indexOf("{", start) + 1, i);
  }
  throw new Error(`unterminated block: ${head}`);
}

const tokens = (source: string): Map<string, string> => {
  const found = new Map<string, string>();
  for (const [, name, value] of source.matchAll(/(--color-[\w-]+):\s*([^;]+);/g))
    if (name && value) found.set(name, value.trim());
  return found;
};

const merge = (...maps: readonly Map<string, string>[]) => new Map(maps.flatMap((map) => [...map]));

const theme = tokens(block(css, "@theme"));
const dark = tokens(block(block(css, "@media (prefers-color-scheme: dark)"), ":root"));
const contrasty = tokens(
  block(block(css, "@media (prefers-color-scheme: light) and (prefers-contrast: more)"), ":root"),
);
const LIGHT = theme;
const DARK = merge(theme, dark);
/** The high-contrast set has to clear the same floors — an earlier version of
    those values was **outside the sRGB gamut** and would have clipped silently. */
const HIGH_CONTRAST = merge(theme, contrasty);

// ── Colour maths ───────────────────────────────────────────────────────────
type Rgb = readonly [number, number, number];

const oklch = (L: number, C: number, h: number): Rgb => {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

const hsl = (h: number, s: number, l: number): Rgb => {
  const k = (n: number) => (n + h / 30) % 12;
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => l / 100 - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [srgbToLinear(f(0)), srgbToLinear(f(8)), srgbToLinear(f(4))];
};

/** What this parses to is **linear** sRGB — relative luminance is computed from
    linear values. */
function parse(value: string): Rgb {
  const o = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (o) return oklch(Number(o[1]), Number(o[2]), Number(o[3]));
  const h = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(value);
  if (h) return hsl(Number(h[1]), Number(h[2]), Number(h[3]));
  throw new Error(`unparsed colour: ${value}`);
}

const read = (map: Map<string, string>, name: string): Rgb => {
  const value = map.get(name);
  if (!value) throw new Error(`missing token: ${name}`);
  return parse(value);
};

const luminance = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const contrast = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const inGamut = (c: Rgb) => c.every((v) => v >= -0.0008 && v <= 1.0008);

/** Vienot 1999. The dichromat simulation runs in **linear** space, then converts
    to Lab to measure the separation. */
const DICHROMAT = {
  deuteranopia: [
    [0.29275, 0.70725, 0],
    [0.29275, 0.70725, 0],
    [-0.02234, 0.02234, 1],
  ],
  protanopia: [
    [0.11238, 0.88762, 0],
    [0.11238, 0.88762, 0],
    [0.00401, -0.00401, 1],
  ],
} as const;

const simulate = (m: readonly (readonly number[])[], c: Rgb): Rgb =>
  m.map(
    (row) => (row[0] ?? 0) * c[0] + (row[1] ?? 0) * c[1] + (row[2] ?? 0) * c[2],
  ) as unknown as Rgb;

const lab = (c: Rgb): readonly [number, number, number] => {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * c[0] + 0.3576 * c[1] + 0.1805 * c[2]) / 0.95047);
  const Y = f(luminance(c));
  const Z = f((0.0193 * c[0] + 0.1192 * c[1] + 0.9505 * c[2]) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
};

const deltaE = (a: Rgb, b: Rgb) => {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

// ── Assertions ─────────────────────────────────────────────────────────────
const CHART = Array.from({ length: SLOTS }, (_, i) => `--color-chart-${i + 1}`);

/** Each colour is compared only against the surfaces **it actually sits on**.
    See charts.tsx for where each one is drawn. */
const SURFACES: Record<string, readonly string[]> = {
  // The donut arcs sit on the --color-border ring (which carries the
  // not-attributed share and so is informative), and the legend dots sit on the
  // card.
  ...Object.fromEntries(
    [...CHART, "--color-chart-rest"].map((name) => [
      name,
      ["--color-border", "--color-card", "--color-background"],
    ]),
  ),
  // Country bars sit on a --color-border track.
  "--color-accent": ["--color-border", "--color-card"],
  // Meters sit on a --color-border track as well.
  "--color-good": ["--color-border", "--color-card"],
  "--color-warn": ["--color-border", "--color-card"],
  "--color-bad": ["--color-border", "--color-card"],
};

const TEXT = ["--color-good-text", "--color-warn-text", "--color-bad-text"];

const SCHEMES: readonly (readonly [string, Map<string, string>])[] = [
  ["light", LIGHT],
  ["dark", DARK],
  ["light + prefers-contrast", HIGH_CONTRAST],
];

it.each(SCHEMES)("%s: every colour is inside the sRGB gamut", (_name, scheme) => {
  for (const token of [...CHART, "--color-chart-rest", ...Object.keys(SURFACES), ...TEXT]) {
    const rgb = read(scheme, token);
    expect(inGamut(rgb), `${token} = ${scheme.get(token)} clips`).toBe(true);
  }
});

it.each(SCHEMES)("%s: non-text indicators clear 3:1 on the surfaces they sit on", (_n, scheme) => {
  for (const [token, surfaces] of Object.entries(SURFACES))
    for (const surface of surfaces) {
      const ratio = contrast(read(scheme, token), read(scheme, surface));
      expect(ratio, `${token} on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
});

it.each(SCHEMES)("%s: status text clears 4.5:1", (_name, scheme) => {
  for (const token of TEXT)
    for (const surface of ["--color-card", "--color-background"]) {
      const ratio = contrast(read(scheme, token), read(scheme, surface));
      expect(ratio, `${token} on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
});

it.each(SCHEMES)("%s: the channel colours stay apart under dichromacy", (_n, scheme) => {
  // The not-attributed segment counts as one of the set: it appears on the same
  // ring alongside the other six.
  const colours = [...CHART, "--color-chart-rest"].map((token) => read(scheme, token));
  for (const [kind, matrix] of Object.entries(DICHROMAT)) {
    const seen = colours.map((c) => simulate(matrix, c));
    for (let i = 0; i < seen.length; i++)
      for (let j = i + 1; j < seen.length; j++) {
        const gap = deltaE(seen[i] as Rgb, seen[j] as Rgb);
        expect(
          gap,
          `chart-${i + 1} vs chart-${j + 1} under ${kind} = ΔE ${gap.toFixed(1)}`,
        ).toBeGreaterThanOrEqual(15);
      }
  }
});

it("keeps the high-contrast block from leaking into dark", () => {
  // Without prefers-color-scheme: light on this block, muted-foreground in dark
  // drops from 6.91:1 to 2.12:1. This pins it to overriding only the tokens it
  // should.
  expect([...contrasty.keys()].sort()).toEqual(["--color-muted-foreground", "--color-warn"]);
  expect(css).toContain("@media (prefers-color-scheme: light) and (prefers-contrast: more)");
});

it("declares every chart token in both schemes", () => {
  // @theme emits into @layer theme while the dark block is an unlayered :root —
  // omit one and dark silently inherits the light value, with no error anywhere.
  for (const token of [...CHART, "--color-chart-rest", "--color-accent", "--color-accent-soft"])
    expect(dark.has(token), `${token} missing from the dark block`).toBe(true);
});
