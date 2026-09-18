/**
 * Bands a number **into one tone**: good / worth a look / bad / no opinion.
 *
 * There is one of these because the same judgement is about to appear in five
 * places (Domain Rating, Spam score, bounce rate, keyword position, budget use).
 * It used to be inlined in Meter in charts.tsx, with a separate BOUNDED table in
 * Report.tsx deciding who qualified — two halves of one decision, which drift
 * apart the moment either is edited alone.
 *
 * Two rules run through the whole table:
 *
 * 1. **Red is for "this thing does not hold at all", never for "this number is
 *    lowish".**
 *
 *    The dividing line is whether the metric is **relative to industry and age**.
 *     - Where it is, amber is the strongest thing said. Ahrefs itself says a
 *       good DR "depends on your competitors and industry rather than an
 *       absolute benchmark"; bounce rate is plainer still — content sites run
 *       70-90% year-round, and for a content site that is often a good sign
 *       rather than a fault. Position is the same: CTR decays smoothly down the
 *       ranking (about 19% at #1, about 12.6% at #2), with no cliff anywhere.
 *     - Only two things are not relative: **zero**, and a **risk score** the
 *       Provider states itself. A domain with no backlinks at all, or no ranked
 *       keywords at all, is not "weak" but "absent" — and zero is zero for
 *       everyone. A spam score at or above 60 is DataForSEO's own risk figure.
 *       A budget at its cap is a functional failure: requests really are being
 *       refused.
 *
 *       **Zero means zero, not "close to zero".** The red floors were once set
 *       at 100 visits and 10 backlinks, which painted a four-month-old site with
 *       40 visits red — the very judgement DR 8 had just been spared above. It
 *       also inverted two metrics that **contain one another**: with 50 visits
 *       all from organic search, "Monthly visits 50" was red while its own
 *       subset "Organic 50" was only amber.
 *
 *    So those three cases can turn red and everything else is capped at amber.
 *
 * 2. **Colour is always a redundant second channel.** Everywhere it is used, the
 *    number itself is still beside it. A reader may disagree with the banding,
 *    but never fails to see the data.
 */

export type Tone = "good" | "warn" | "bad" | "neutral";

/** The unit is written against each one — passing the wrong unit is the only
    mistake available here. */
export type Metric =
  /** 0–100, higher is better. Ahrefs' backlink strength score. */
  | "domain-rating"
  /** 0–100, higher is worse. */
  | "spam-score"
  /** **A 0–1 fraction**, not a percentage; higher is worse. */
  | "bounce-rate"
  /** A position starting at 1; lower is better. */
  | "keyword-position"
  /** **A 0–1 fraction** = (cap - remaining) / cap; higher is worse.
      remaining already has reservations deducted, and a reservation blocks new
      requests just as a settled charge does — so settled-spend / cap is the
      wrong numerator here. */
  | "budget-used"
  /** Monthly visits, an absolute count; higher is better. */
  | "monthly-visits"
  /** Monthly visits from organic search, an absolute count; higher is better. */
  | "organic-visits"
  /** Number of ranked keywords, an absolute count; higher is better. */
  | "ranking-keywords"
  /** Backlinks or referring pages, an absolute count; higher is better. */
  | "backlinks"
  /** Referring domains or IPs, an absolute count; higher is better. */
  | "referring-domains"
  /** A global or country rank where 1 is best; lower is better. */
  | "site-rank"
  /** Pages per visit; higher is better. */
  | "pages-per-visit"
  /** Visit duration in **seconds**; higher is better. */
  | "visit-duration"
  /** Domain age in **months**; older is more settled. */
  | "domain-age";

export function toneOf(metric: Metric, value: number): Tone {
  // One guard here, so five call sites do not each repeat Number.isFinite.
  // Negatives get no opinion: none of these metrics has a domain including them,
  // so a negative means something upstream miscalculated, and colouring it would
  // be worse than not — it would suggest the number can be trusted.
  if (!Number.isFinite(value) || value < 0) return "neutral";

  switch (metric) {
    /*
     * DR is logarithmic: 50 and up is genuinely strong, 20-49 is established,
     * under 20 has not got going yet.
     *
     * The direction matches every other higher-is-better metric: **green high,
     * amber low, no opinion in between**. It was once written inverted (warn at
     * >= 20), which painted DR 30 amber while DR 8 stayed plain — the colour
     * ranking the weaker domain above the stronger one.
     *
     * **No red band.** A low DR is not a fault but a young or thinly linked
     * site, and Ahrefs itself says DR is mainly for comparing against similar
     * sites rather than an absolute pass mark — so amber says "this one is
     * weak", not "something here is broken".
     * https://help.ahrefs.com/en/articles/1409408-what-is-domain-rating-dr
     */
    case "domain-rating":
      return value >= 50 ? "good" : value < 20 ? "warn" : "neutral";

    /*
     * The 30 and 60 cut points are **carried over verbatim** from the old Meter
     * in charts.tsx and were not re-derived. No green band either: a low spam
     * score is the ordinary case, and colouring the ordinary case green would
     * turn most of the screen green.
     */
    case "spam-score":
      return value >= 60 ? "bad" : value >= 30 ? "warn" : "neutral";

    /*
     * 40% or less is multi-page browsing, 40-70% is the normal band for most
     * content sites, and above 70% means most sessions read one page and leave.
     *
     * **No red band.** Similarweb is explicit that what counts as good depends
     * on the site's category and the visitor's intent — a documentation site
     * sitting at 80% is behaving exactly as it should.
     * https://support.similarweb.com/hc/en-us/articles/115000501625-Bounce-Rate
     * Note also that this is Similarweb's modelled bounce rate, not GA's — good
     * enough for three bands, not to be read as an exact figure.
     */
    case "bounce-rate":
      return value <= 0.4 ? "good" : value > 0.7 ? "warn" : "neutral";

    /*
     * Page one (the top 10) takes the overwhelming majority of organic clicks
     * and counts as good; page two (11-20) is still within reach and counts as
     * ordinary; past that there is effectively no traffic, which counts as weak.
     * This band reads as "opportunity", not "quality" — so amber is the
     * strongest thing it says.
     */
    case "keyword-position":
      // Positions start at 1. A 0 is not "better than first" but no position.
      // Page one is good, page two is ordinary, past that there is no traffic.
      return value < 1 ? "neutral" : value <= 10 ? "good" : value <= 20 ? "neutral" : "warn";

    /*
     * At 1.0 reserve() really is refusing requests (src/ledger/store.ts), which
     * is a genuinely bad state. No green band: spending little is not an
     * achievement.
     */
    case "budget-used":
      return value >= 1 ? "bad" : value >= 0.8 ? "warn" : "neutral";

    /*
     * ── Below are **magnitudes**, not scores ───────────────────────────────
     *
     * These band by **order of magnitude** rather than linearly: these
     * quantities are distributed logarithmically on the web, so 766 and 7,660
     * differ far more than 766 and 1,500 do. Each band is roughly 10-100x the
     * last.
     *
     * Three bands at most, and the only red is **absence**. A six-month-old
     * domain with 14 organic visits is not faulty but not yet grown — amber says
     * "this one is weak", not "something here is broken".
     */

    // 100k a month is the "has real traffic" order of magnitude; under a
    // thousand is barely indexed at all.
    // Red only lights at **an actual 0** — tracked, yet with no visit at all.
    case "monthly-visits":
      return value < 1 ? "bad" : value >= 100_000 ? "good" : value < 1_000 ? "warn" : "neutral";

    // Organic traffic is harder to earn than total traffic, so the bar is one
    // step lower.
    case "organic-visits":
      return value < 1 ? "bad" : value >= 10_000 ? "good" : value < 100 ? "warn" : "neutral";

    // Not one ranked keyword — that is not weak, that is never having appeared
    // in a search result.
    case "ranking-keywords":
      return value < 1 ? "bad" : value >= 1_000 ? "good" : value < 10 ? "warn" : "neutral";

    case "backlinks":
      return value < 1 ? "bad" : value >= 10_000 ? "good" : value < 100 ? "warn" : "neutral";

    // Referring **domains** run two orders of magnitude below link counts: one
    // site sending ten thousand links still counts as one domain.
    // None at all means no site anywhere links to it.
    case "referring-domains":
      return value < 1 ? "bad" : value >= 1_000 ? "good" : value < 10 ? "warn" : "neutral";

    /*
     * Rank runs the other way: 1 is best.
     * The top 100k is the "measurable traffic" band; past 200k the rank itself
     * stops saying much.
     */
    case "site-rank":
      return value < 1
        ? "neutral"
        : value <= 100_000
          ? "good"
          : value > 200_000
            ? "warn"
            : "neutral";

    case "pages-per-visit":
      return value >= 3 ? "good" : value < 1.5 ? "warn" : "neutral";

    // Seconds. Over three minutes is genuine reading; under thirty seconds is
    // opening and leaving.
    case "visit-duration":
      return value >= 180 ? "good" : value < 30 ? "warn" : "neutral";

    // Months. Over three years is established; under six months is too new for
    // there to be any history to judge.
    case "domain-age":
      return value >= 36 ? "good" : value < 6 ? "warn" : "neutral";
  }
}
