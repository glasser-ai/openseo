import { getDomain } from "tldts";

/** Registry ownership uses ICANN suffixes, not private hosting suffixes. */
export function registrableDomain(host: string): string {
  const clean = host.toLowerCase().replace(/\.$/, "");
  return getDomain(clean, { allowPrivateDomains: false }) ?? clean;
}

/**
 * The site every domain report reads: the registrable domain, but with private
 * suffixes honoured, so www.wikipedia.org reads wikipedia.org while
 * tenant.github.io stays itself instead of becoming GitHub.
 *
 * One scope for every card. Mixing the exact host and the whole domain put
 * www.wikipedia.org's 2.7M organic visits next to wikipedia.org's 1.4B under
 * one name, and listed wikipedia.org as its own competitor.
 */
export function siteDomain(host: string): string {
  const clean = host.toLowerCase().replace(/\.$/, "");
  return getDomain(clean, { allowPrivateDomains: true }) ?? clean;
}

/** False when the host sits under a private suffix (tenant.github.io): a
    domain-level score such as Domain Rating then describes the platform, not
    this site. */
export const ratesThisSite = (host: string): boolean =>
  registrableDomain(host) === siteDomain(host);

export const isSubdomain = (host: string): boolean =>
  registrableDomain(host) !== host.toLowerCase().replace(/\.$/, "");
