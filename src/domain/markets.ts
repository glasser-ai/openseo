/**
 * The country a Search report reads Google in.
 *
 * DataForSEO keys on a location and a language, Semrush on its own regional
 * database, so each market carries both. The language is the one most of the
 * country searches in: DataForSEO Labs answers nothing for a pair it does not
 * index, such as Japan in English.
 *
 * The default is all countries: DataForSEO Labs reads every location when the
 * input names none (measured 2026-10-29 on anthropic.com, location_code null
 * in the answer). A country is the detail a user asks for, not the start.
 */
export type Country = {
  /** Semrush's database name, which also serves as the stored id. */
  readonly id: string;
  readonly name: string;
  readonly locationCode: number;
  readonly languageCode: string;
};

export type Market = Country | typeof WORLDWIDE;

export const WORLDWIDE = {
  id: "all",
  name: "All countries",
  locationCode: null,
  languageCode: null,
} as const;

export const COUNTRIES: readonly Country[] = [
  { id: "us", name: "United States", locationCode: 2840, languageCode: "en" },
  { id: "uk", name: "United Kingdom", locationCode: 2826, languageCode: "en" },
  { id: "ca", name: "Canada", locationCode: 2124, languageCode: "en" },
  { id: "au", name: "Australia", locationCode: 2036, languageCode: "en" },
  { id: "in", name: "India", locationCode: 2356, languageCode: "en" },
  { id: "sg", name: "Singapore", locationCode: 2702, languageCode: "en" },
  { id: "de", name: "Germany", locationCode: 2276, languageCode: "de" },
  { id: "fr", name: "France", locationCode: 2250, languageCode: "fr" },
  { id: "es", name: "Spain", locationCode: 2724, languageCode: "es" },
  { id: "it", name: "Italy", locationCode: 2380, languageCode: "it" },
  { id: "nl", name: "Netherlands", locationCode: 2528, languageCode: "nl" },
  { id: "se", name: "Sweden", locationCode: 2752, languageCode: "sv" },
  { id: "pl", name: "Poland", locationCode: 2616, languageCode: "pl" },
  { id: "br", name: "Brazil", locationCode: 2076, languageCode: "pt" },
  { id: "mx", name: "Mexico", locationCode: 2484, languageCode: "es" },
  { id: "ar", name: "Argentina", locationCode: 2032, languageCode: "es" },
  { id: "cl", name: "Chile", locationCode: 2152, languageCode: "es" },
  { id: "co", name: "Colombia", locationCode: 2170, languageCode: "es" },
  { id: "jp", name: "Japan", locationCode: 2392, languageCode: "ja" },
];

export const MARKETS: readonly Market[] = [WORLDWIDE, ...COUNTRIES];

export const DEFAULT_MARKET: Market = WORLDWIDE;

/** Where a report reads one country only — Semrush's history, DataForSEO's
    competitors (40501 Invalid Field: 'location_name' without one) — all
    countries reads as the United States, and the card says so. */
export const FALLBACK_COUNTRY = COUNTRIES[0] as Country;

export const countryOf = (market: Market): Country =>
  market.locationCode === null ? FALLBACK_COUNTRY : market;

/** The input fields that place a DataForSEO Labs request; none for all
    countries. */
export const placeOf = (market: Market): { location_code?: number; language_code?: string } =>
  market.locationCode === null
    ? {}
    : { location_code: market.locationCode, language_code: market.languageCode };

/** An unknown id, from an old message or edited storage, reads as the default
    rather than as an input the Provider rejects. */
export function marketOf(id: unknown): Market {
  return MARKETS.find((market) => market.id === id) ?? DEFAULT_MARKET;
}
