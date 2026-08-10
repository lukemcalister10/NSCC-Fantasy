import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * C6 — SPA ROUTING. Any typed URL or page refresh returned Vercel's 404 instead
 * of the app, because Vercel resolves the path against the filesystem and answers
 * before the client router ever runs. It affected EVERY route and had been true
 * since the first deploy; it went unnoticed only because every smoke test to date
 * navigated by CLICKING, which never leaves the already-loaded bundle.
 * Participants bookmark, refresh and share links, so this bites in week one.
 *
 * The fix is `vercel.json`, which is configuration and therefore exactly the kind
 * of artifact C11 is about: a file no test applies is a file that is correct only
 * by luck. This applies the rewrite the way Vercel does and pins the behaviour
 * that matters, including the two things the rewrite must NOT swallow.
 */

const CONFIG = JSON.parse(
  readFileSync(fileURLToPath(new URL("../vercel.json", import.meta.url)), "utf8"),
) as {
  rewrites?: { source: string; destination: string }[];
  functions?: Record<string, { maxDuration?: number }>;
};

/**
 * Vercel compiles `source` as a path-to-regexp pattern anchored at both ends.
 * The pattern here is a bare regex group, which path-to-regexp passes through, so
 * anchoring it is a faithful evaluation of the same match.
 */
function rewriteFor(path: string): string | null {
  for (const rule of CONFIG.rewrites ?? []) {
    if (new RegExp(`^${rule.source}$`).test(path)) return rule.destination;
  }
  return null;
}

describe("C6 vercel.json — unmatched paths reach the SPA", () => {
  it("declares a rewrite", () => {
    expect(CONFIG.rewrites?.length).toBeGreaterThan(0);
  });

  // Every route in App.tsx, as a participant would type or bookmark it.
  const appRoutes = [
    "/",
    "/login",
    "/players",
    "/players/71a70000-0000-4000-8000-000000000001",
    "/rounds",
    "/team",
    "/team/trades",
    "/admin",
    "/admin/players",
    "/admin/rounds",
    "/admin/scorecards",
    "/admin/settings",
    "/some/route/that/does/not/exist",
  ];

  for (const path of appRoutes) {
    it(`${path} is served the app shell`, () => {
      expect(rewriteFor(path)).toBe("/index.html");
    });
  }

  /**
   * The serverless recompute route must answer for itself. Vercel checks the
   * filesystem (static files AND functions) BEFORE rewrites, so this exclusion is
   * belt-and-braces rather than load-bearing — but a rewrite that swallowed
   * /api/* would break the manager's recompute button in a way no unit test of
   * the button could ever catch.
   */
  it("does not swallow the /api/* function routes", () => {
    expect(rewriteFor("/api/recompute")).toBeNull();
    expect(rewriteFor("/api/anything/else")).toBeNull();
  });

  /**
   * C9's other half lives in the same file: the hosted function needs a duration
   * ceiling it can be held to, and the UI's own budget is written against it.
   */
  it("gives the recompute function an explicit duration ceiling (C9)", () => {
    const fn = CONFIG.functions?.["api/recompute.ts"];
    expect(fn).toBeDefined();
    expect(fn?.maxDuration).toBeGreaterThanOrEqual(60);
  });
});
