import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * THE BROWSER BUNDLE MUST NOT BE ABLE TO REACH A SERVER SECRET.
 *
 * The recompute control needs credentials no browser may hold: a direct Postgres
 * connection string. Those live in `api/` (serverless) and `scripts/` (the
 * operator's CLI), and Vite only bundles what the app graph imports — so the
 * safety property is precisely "nothing under app/ imports the privileged path".
 *
 * That is a property a future edit can break silently and a code review can miss,
 * so it is a test rather than a convention. It fails if an app file ever imports
 * the pg driver, the pg adapter, the recompute runner, or anything from api/, or
 * if it so much as names the connection-string variable.
 */

const APP_DIR = fileURLToPath(new URL("../app/", import.meta.url));

const FORBIDDEN: [RegExp, string][] = [
  [/from\s+["']pg["']/, "imports the postgres driver"],
  [/from\s+["'].*db\/pgClient/, "imports the server-side pg adapter"],
  [/from\s+["'].*db\/runRecompute/, "imports the recompute runner (that runs server-side)"],
  [/from\s+["'].*\/api\//, "imports a serverless route"],
  [/POSTGRES_URL/, "names the database connection string"],
  [/SERVICE_ROLE/, "names the service-role key"],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("no server-side credentials can reach the browser bundle", () => {
  const files = sourceFiles(APP_DIR);

  it("finds the app sources (guard against an empty scan passing vacuously)", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  for (const [pattern, why] of FORBIDDEN) {
    it(`no app/ file ${why}`, () => {
      const offenders = files.filter((f) => pattern.test(readFileSync(f, "utf8")));
      expect(offenders.map((f) => f.slice(APP_DIR.length))).toEqual([]);
    });
  }

  it("the app talks to the recompute route over HTTP only", () => {
    const mutations = readFileSync(join(APP_DIR, "lib/adminMutations.ts"), "utf8");
    expect(mutations).toContain('fetch("/api/recompute"');
    // ...carrying the user's own Supabase session, which the server re-verifies.
    expect(mutations).toContain("authorization: `Bearer ${token}`");
  });
});
