/**
 * robots.txt as Google and RFC 9309 read it.
 *
 * Kept here, apart from the page scan, so the rules are tested on text alone:
 * the scan only fetches the file, and every decision about it is made here.
 */
type Rule = { readonly allow: boolean; readonly pattern: string };
type Group = { readonly agents: readonly string[]; readonly rules: readonly Rule[] };

export type Robots = { readonly groups: readonly Group[] };

export function parseRobots(text: string): Robots {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  // Whether the current group has had a rule line, empty ones included: an
  // empty Disallow still ends the run of user-agent lines (RFC 9309 2.2), so
  // a user-agent after it starts a new group rather than joining this one.
  let current: { agents: string[]; rules: Rule[]; closed: boolean } | null = null;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      // Consecutive user-agent lines share the rules that follow them.
      if (!current || current.closed) {
        current = { agents: [], rules: [], closed: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && current) {
      current.closed = true;
      // An empty Disallow is no rule at all, not a block on everything.
      if (value !== "") current.rules.push({ allow: field === "allow", pattern: normalize(value) });
    }
  }
  return { groups };
}

/**
 * Whether the agent may fetch the path. A group naming the agent wins over
 * "*", and every group naming it counts together. Among the rules, the
 * longest pattern decides; on a tie, Allow wins.
 */
export function isAllowed(robots: Robots, agent: string, path: string): boolean {
  const token = agent.toLowerCase();
  const own = robots.groups.filter((group) => group.agents.includes(token));
  const groups = own.length > 0 ? own : robots.groups.filter((g) => g.agents.includes("*"));
  let best: Rule | null = null;
  const target = normalize(path);
  for (const rule of groups.flatMap((group) => group.rules)) {
    if (!matches(rule.pattern, target)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    )
      best = rule;
  }
  return best?.allow ?? true;
}

/**
 * One spelling for a path and a pattern before they are compared (RFC 9309
 * 2.2.2): characters outside ASCII become UTF-8 percent-escapes, an escaped
 * unreserved character is unescaped, and other escapes use upper-case hex. So
 * /café matches /caf%C3%A9, and /%70rivate matches /private.
 */
export function normalize(path: string): string {
  return path
    .replace(/[^\x00-\x7F]+/g, (run) => {
      try {
        return encodeURIComponent(run);
      } catch {
        // A lone surrogate has no UTF-8 form; leave it to fail to match.
        return run;
      }
    })
    .replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) => {
      const char = String.fromCharCode(Number.parseInt(hex, 16));
      return /[A-Za-z0-9\-._~]/.test(char) ? char : `%${hex.toUpperCase()}`;
    });
}

/** * matches any run of characters, and a final $ anchors the end. */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

export type Crawler = {
  readonly token: string;
  readonly owner: string;
  /** "answers" crawlers fetch pages to cite them in AI answers; "training"
      ones collect text to train models. Blocking one does not block the other. */
  readonly use: "answers" | "training";
};

/** Tokens as each company documents them. Google-Extended is a robots.txt
    token only: Googlebot does the fetching, and the token decides Gemini use. */
export const AI_CRAWLERS: readonly Crawler[] = [
  { token: "OAI-SearchBot", owner: "OpenAI", use: "answers" },
  { token: "Claude-SearchBot", owner: "Anthropic", use: "answers" },
  { token: "PerplexityBot", owner: "Perplexity", use: "answers" },
  { token: "GPTBot", owner: "OpenAI", use: "training" },
  { token: "ClaudeBot", owner: "Anthropic", use: "training" },
  { token: "Google-Extended", owner: "Google", use: "training" },
  { token: "Applebot-Extended", owner: "Apple", use: "training" },
  { token: "Meta-ExternalAgent", owner: "Meta", use: "training" },
  { token: "CCBot", owner: "Common Crawl", use: "training" },
];

/** What the scan found at /robots.txt. Google reads a 4xx as "no rules" and
    stops crawling on a 5xx or a 429, so the two are kept apart. */
export type RobotsFile =
  | { readonly kind: "found"; readonly text: string }
  | { readonly kind: "missing"; readonly status: number }
  | { readonly kind: "unreadable"; readonly reason: string };

/** null means the file gives no answer, so the card says so and does not guess. */
export function robotsFor(file: RobotsFile): Robots | null {
  if (file.kind === "found") return parseRobots(file.text);
  if (file.kind === "missing") return { groups: [] };
  return null;
}
