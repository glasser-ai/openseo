import { expect, it } from "vitest";
import { isAllowed, parseRobots, robotsFor } from "../robots.js";

it("lets the longest rule decide, and Allow win a tie", () => {
  const robots = parseRobots(`
User-agent: *
Disallow: /private
Allow: /private/open
Disallow: /tie
Allow: /tie
`);
  expect(isAllowed(robots, "Googlebot", "/")).toBe(true);
  expect(isAllowed(robots, "Googlebot", "/private/x")).toBe(false);
  expect(isAllowed(robots, "Googlebot", "/private/open/page")).toBe(true);
  expect(isAllowed(robots, "Googlebot", "/tie")).toBe(true);
});

it("reads a named group instead of *, and joins groups that share a name", () => {
  const robots = parseRobots(`
User-agent: *
Disallow: /

User-agent: GPTBot
User-agent: ClaudeBot
Allow: /

user-agent: gptbot
disallow: /drafts # comment
`);
  expect(isAllowed(robots, "PerplexityBot", "/")).toBe(false);
  expect(isAllowed(robots, "GPTBot", "/")).toBe(true);
  expect(isAllowed(robots, "ClaudeBot", "/")).toBe(true);
  expect(isAllowed(robots, "GPTBot", "/drafts/a")).toBe(false);
});

it("matches * and an end anchor, and ignores an empty Disallow", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow:\n");
  expect(isAllowed(robots, "Googlebot", "/a/b.pdf")).toBe(false);
  expect(isAllowed(robots, "Googlebot", "/a/b.pdf?x=1")).toBe(true);
  expect(isAllowed(robots, "Googlebot", "/a")).toBe(true);
});

/* RFC 9309 2.2: a rule line ends the run of user-agent lines, even an empty
   one, so the next user-agent starts a new group. */
it("does not join a group to the next one after an empty Disallow", () => {
  const robots = parseRobots("User-agent: GPTBot\nDisallow:\n\nUser-agent: *\nDisallow: /\n");
  expect(isAllowed(robots, "GPTBot", "/")).toBe(true);
  expect(isAllowed(robots, "CCBot", "/")).toBe(false);
});

/* RFC 9309 2.2.2: compare paths and patterns after percent-encoding them one
   way. */
it("matches a rule however the path is percent-encoded", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /café\nDisallow: /%70rivate\n");
  expect(isAllowed(robots, "Googlebot", "/caf%C3%A9/menu")).toBe(false);
  expect(isAllowed(robots, "Googlebot", "/caf%c3%a9")).toBe(false);
  expect(isAllowed(robots, "Googlebot", "/private/x")).toBe(false);
  expect(isAllowed(robots, "Googlebot", "/public")).toBe(true);
});

/* Google reads a 4xx robots.txt as no rules and a 5xx as a stop. */
it("allows all for a missing file and gives no answer for an unreadable one", () => {
  const missing = robotsFor({ kind: "missing", status: 404 });
  expect(missing && isAllowed(missing, "GPTBot", "/")).toBe(true);
  expect(robotsFor({ kind: "unreadable", reason: "HTTP 503" })).toBeNull();
});
