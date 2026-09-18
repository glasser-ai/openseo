import { getDomain } from "tldts";

/** Registry ownership uses ICANN suffixes, not private hosting suffixes. */
export function registrableDomain(host: string): string {
  const clean = host.toLowerCase().replace(/\.$/, "");
  return getDomain(clean, { allowPrivateDomains: false }) ?? clean;
}

export const isSubdomain = (host: string): boolean =>
  registrableDomain(host) !== host.toLowerCase().replace(/\.$/, "");
