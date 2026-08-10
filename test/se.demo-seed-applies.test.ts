import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeTestDb } from "./helpers/pgliteDb.js";

/**
 * C11 CARRIED ACTION — "audit whether anything else generates SQL or other
 * artifacts that no test applies end-to-end".
 *
 * It does. `supabase/seed/seed_raw.sql` + `seed_derived.sql` — the DEMO pair,
 * which VERCEL_DEPLOY.md step 2 tells the operator to paste into the Supabase SQL
 * editor — was applied by NO test. Only the DEV odd-count pair under
 * `supabase/seed/dev/` was covered (test/c2-bye-display.test.ts), by the test S-C
 * added after the original C11 finding. So the exact failure mode C11 records was
 * still live in the neighbouring file: the demo pair is correct today only
 * because commit 5e21590 fixed the `raw_text` → `resolved_text` rename BY HAND,
 * and nothing would have caught the next such drift.
 *
 * This closes that gap the same way S-C closed the first one: by applying the
 * EMITTED FILES against the real migration stack, rather than the scenario object
 * they were generated from. The generator's own in-process run proves the engine;
 * only this proves the paste.
 */

const SEED_DIR = fileURLToPath(new URL("../supabase/seed/", import.meta.url));

/** Fixed in scripts/generate-seed.ts, and re-asserted below so a change to
 *  either has to be a deliberate change to both. */
const SEASON = "5ea50000-0000-4000-8000-000000000001";
const OWNERS = ["__OWNER_A__", "__OWNER_B__", "__OWNER_C__", "__OWNER_D__"];

/** Machine-generated SQL: strip comment lines, split on statement boundaries. */
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const read = (file: string) => readFileSync(new URL(file, `file://${SEED_DIR}`), "utf8");

async function applyPair(ownerIds: string[]): Promise<Awaited<ReturnType<typeof makeTestDb>>> {
  const db = await makeTestDb();
  for (const id of ownerIds) {
    await db.query(
      "INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,$2,false)",
      [id, "owner"],
    );
  }
  const substitute = (sql: string) =>
    OWNERS.reduce((acc, token, i) => acc.split(token).join(ownerIds[i]!), sql);

  for (const file of ["seed_raw.sql", "seed_derived.sql"]) {
    for (const statement of statements(substitute(read(file)))) {
      await db.query(statement);
    }
  }
  return db;
}

const owners = (tag: string) =>
  OWNERS.map((_, i) => `00000000-0000-0000-0000-0000005e${tag}${i.toString().padStart(3, "0")}`);

describe("C11 — the DEMO seed pair applies against the real schema", () => {
  it("seed_raw.sql then seed_derived.sql apply cleanly, through the live trigger stack", async () => {
    const db = await applyPair(owners("d"));

    const season = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM seasons WHERE id = $1",
      [SEASON],
    );
    expect(Number(season.rows[0]!.n)).toBe(1);

    const teams = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM fantasy_teams WHERE season_id = $1",
      [SEASON],
    );
    expect(Number(teams.rows[0]!.n)).toBe(OWNERS.length);

    const players = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM players WHERE season_id = $1",
      [SEASON],
    );
    expect(Number(players.rows[0]!.n)).toBeGreaterThan(0);

    // The derived half landed too: a ladder for every team.
    const ladder = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM ladder WHERE season_id = $1",
      [SEASON],
    );
    expect(Number(ladder.rows[0]!.n)).toBe(OWNERS.length);
  }, 60_000);

  /**
   * The specific regression C11 is named for: 0006 renamed `dismissals.raw_text`
   * to `resolved_text`, and this emitter kept writing the old name. Restoring it
   * makes the INSERT above fail on an unknown column — but only if a test applies
   * the file, which is the whole point. Asserted directly as well, so the failure
   * message says what broke instead of just "syntax".
   */
  it("writes dismissals under the 0006 column name, with fielding credit surviving (D25)", async () => {
    const db = await applyPair(owners("e"));

    const raw = read("seed_raw.sql");
    expect(raw).toContain("resolved_text");
    expect(raw).not.toContain("raw_text");

    const dismissals = await db.query<{ n: string }>("SELECT count(*) AS n FROM dismissals");
    expect(Number(dismissals.rows[0]!.n)).toBeGreaterThan(0);

    const fielding = await db.query<{ total: string | null }>(
      "SELECT sum(fielding) AS total FROM player_match_scores",
    );
    expect(Number(fielding.rows[0]!.total)).toBeGreaterThan(0);
  }, 60_000);

  it("re-applying the pair is idempotent, as the runbook promises", async () => {
    const ids = owners("f");
    const db = await makeTestDb();
    for (const id of ids) {
      await db.query(
        "INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,$2,false)",
        [id, "owner"],
      );
    }
    const substitute = (sql: string) =>
      OWNERS.reduce((acc, token, i) => acc.split(token).join(ids[i]!), sql);

    for (let pass = 0; pass < 2; pass++) {
      for (const file of ["seed_raw.sql", "seed_derived.sql"]) {
        for (const statement of statements(substitute(read(file)))) {
          await db.query(statement);
        }
      }
    }

    const teams = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM fantasy_teams WHERE season_id = $1",
      [SEASON],
    );
    expect(Number(teams.rows[0]!.n)).toBe(OWNERS.length);

    const ladder = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM ladder WHERE season_id = $1",
      [SEASON],
    );
    expect(Number(ladder.rows[0]!.n)).toBe(OWNERS.length);
  }, 60_000);

  it("still carries the owner tokens the runbook tells the operator to replace", () => {
    const raw = read("seed_raw.sql");
    for (const token of OWNERS) expect(raw).toContain(token);
    expect(raw).toContain(SEASON);
  });
});
