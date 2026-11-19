import { parse } from "tldts";
import type { PanelEntry } from "./domain/cache.js";

/**
 * The Domain Rating badge on the toolbar icon.
 *
 * It shows the cached rating of the open site (the ratingBadge setting). With
 * the autoRating setting it also looks up sites with no saved rating: each
 * lookup is paid, counts against the budgets, and sends the domain to glasser.
 * Both are on by default and Settings turns them off.
 */

/** The accent token (--color-accent, #1163b6). White text on it passes contrast. */
export const BADGE_COLOR = "#1163b6";

/** The host the panel would look up for this address, or null for pages it
    cannot report on (chrome://, file://, the Web Store's own scheme). */
export function badgeHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

/** The badge text for a cached Domain Rating entry. Empty clears the badge. */
export function badgeLabel(entry: PanelEntry | null): string {
  if (!entry || entry.payload.kind !== "fields") return "";
  const value = entry.payload.fields.find((field) => field.label === "Domain Rating")?.value;
  if (value === undefined) return "";
  const number = Number(value);
  // A badge has room for about four characters; DR is 0–100.
  return Number.isFinite(number) ? String(Math.round(number)) : "";
}

/** Text shown while an automatic lookup runs. */
export const BADGE_PENDING = "…";

/** Special-use names (RFC 6761, RFC 8375, RFC 7686) that the public suffix
    list still carries as ICANN suffixes. They never name a public website. */
const SPECIAL_USE = new Set(["arpa", "onion"]);

/**
 * Only public domains have a rating, and an automatic lookup sends the name to
 * glasser without a click. An intranet name such as hr.corp.local must not
 * leave the browser.
 *
 * getDomain alone is not enough: for a suffix the list does not know (local,
 * internal, lan, corp) it applies the default rule and returns corp.local. So
 * the suffix must be one the list knows as ICANN.
 */
export function canLookUp(host: string): boolean {
  const parsed = parse(host, { allowPrivateDomains: false });
  if (parsed.isIp || parsed.domain === null || parsed.isIcann !== true) return false;
  const tld = parsed.publicSuffix?.split(".").at(-1) ?? "";
  return !SPECIAL_USE.has(tld);
}
