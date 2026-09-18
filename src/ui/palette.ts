import type { Tone } from "../domain/thresholds.js";

/**
 * Tone and slot to Tailwind class name.
 *
 * The class names in these tables **must be whole literals**. Tailwind v4 scans
 * source text, so a name assembled as `bg-chart-${n}` is invisible to it and
 * never generated — with no error either, just an empty class in the browser.
 */
export const TONE_FILL: Record<Tone, string> = {
  good: "bg-good",
  warn: "bg-warn",
  bad: "bg-bad",
  neutral: "bg-foreground",
};

/** neutral is an empty string: inherit the surrounding foreground rather than
    writing another colour for the neutral state. */
export const TONE_TEXT: Record<Tone, string> = {
  good: "text-good-text",
  warn: "text-warn-text",
  bad: "text-bad-text",
  neutral: "",
};

/**
 * Channel to fixed slot. **Keyed by name, not by index.**
 *
 * sources is sorted by share (src/domain/traffic.ts), so indices move: come a
 * different month, Search drops to third and an index-keyed colour changes with
 * it — while it is still the same channel. If two refreshes of the same domain
 * give different colours, colour is no longer identity.
 */
export const CHANNEL_SLOT: Record<string, number> = {
  direct: 0,
  search: 1,
  referrals: 2,
  social: 3,
  paidReferrals: 4,
  mail: 5,
};

export const ARC = [
  "stroke-chart-1",
  "stroke-chart-2",
  "stroke-chart-3",
  "stroke-chart-4",
  "stroke-chart-5",
  "stroke-chart-6",
] as const;

export const SWATCH = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
  "bg-chart-6",
] as const;

/** The two class names for the "not attributed to any channel" segment. It is
    not one of the slots, so it lives separately. */
export const REST_ARC = "stroke-chart-rest";
export const REST_SWATCH = "bg-chart-rest";

export const SLOTS = ARC.length;

/** Slots wrap into 0..5. Out of range, negative and fractional all need a
 **determinate** landing place rather than a throw. */
const wrap = (slot: number): number =>
  Number.isFinite(slot) ? ((Math.trunc(slot) % SLOTS) + SLOTS) % SLOTS : 0;

/**
 * Assigns slots across a set of channels. **This is the only entry point.**
 *
 * There used to be a `slotOf(key, fallback)` where an unknown key fell back to
 * its index — and that index could be one another channel already held:
 * in `["search", "video"]`, search takes its fixed slot 1 and video falls back
 * to index 1, painting both segments the same colour. Once a colour repeats it
 * is no longer identity, and identity is the reason this module exists. So the
 * whole set is assigned together, with no per-key back door.
 *
 * Known channels take their **pinned** slots; an unfamiliar one takes a slot
 * **nobody is using** — hashing into a slot instead could collide with Direct's
 * blue and put two identical blues on one ring.
 *
 * The unfamiliar ones are sorted by name before assignment, so the same set of
 * channels always receives the same colours regardless of their shares.
 */
export function assignSlots(keys: readonly string[]): Map<string, number> {
  const slots = new Map<string, number>();
  const taken = new Set<number>();
  for (const key of keys) {
    const slot = CHANNEL_SLOT[key];
    if (slot === undefined) continue;
    slots.set(key, slot);
    taken.add(slot);
  }
  /*
   * When the slots run out, **stop issuing** rather than issue one another key
   * already holds.
   *
   * This loop used to exit once taken was full and write the current next
   * anyway — so with the six known channels holding every slot, a seventh
   * (aiAssistants, say) received slot 0 and was painted Direct's blue. That is
   * precisely what this function exists to prevent.
   *
   * Keys that get no slot are **absent from the returned map**, and Donut renders
   * them in the neutral grey (REST_SWATCH). The grey says "this one has no
   * colour of its own" rather than impersonating a known channel — identity
   * rests on the adjacent label, and colour is only the second channel.
   */
  for (const key of keys.filter((key) => !slots.has(key)).sort()) {
    const free = Array.from({ length: SLOTS }, (_, slot) => slot).find((slot) => !taken.has(slot));
    if (free === undefined) break;
    slots.set(key, free);
    taken.add(free);
  }
  return slots;
}

export const arcClass = (slot: number): string => ARC[wrap(slot)] ?? ARC[0];
export const swatchClass = (slot: number): string => SWATCH[wrap(slot)] ?? SWATCH[0];
