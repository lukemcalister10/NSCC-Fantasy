import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { DbClient } from "../../src/db/repository.js";
import type { RawSeason } from "../../src/recompute/types.js";

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../supabase/migrations/", import.meta.url),
);

/** Every migration file, applied in filename order — exactly as a real run would.
 *  Picks up 0002_locks.sql (triggers/constraints) alongside 0001_init.sql, so the
 *  lock gates (G4/G6/G10) execute against pglite like the rest of the suite. */
function migrationSql(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(new URL(f, `file://${MIGRATIONS_DIR}`), "utf8"));
}

/**
 * Boot an in-process Postgres (pglite, no Docker) with the real migrations
 * applied, exposed through the same `DbClient` surface production uses. This is
 * what makes the DB half of G3 (schema executes; no orphaned derived rows) and
 * the lock gates (G4/G6/G10 triggers) verifiable in CI / a cold-acceptance run.
 */
export async function makeTestDb(): Promise<DbClient> {
  const pg = new PGlite();
  for (const sql of migrationSql()) await pg.exec(sql);
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const r = await pg.query(sql, params as never[]);
      return { rows: r.rows as T[] };
    },
  };
}

/**
 * Insert a whole RawSeason (raw truth + config) so recompute can load it. Wrapped
 * in ONE transaction: the mandatory-captain guard (0002) is a DEFERRABLE INITIALLY
 * DEFERRED constraint trigger, so a team's selections may be seeded in any order
 * and the "exactly one captain per (team, round)" check runs once, at COMMIT, over
 * the completed set. (A real season is registered atomically anyway.)
 */
export async function seedSeason(db: DbClient, raw: RawSeason): Promise<void> {
  await db.query("BEGIN");
  try {
    await seedSeasonInner(db, raw);
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

async function seedSeasonInner(db: DbClient, raw: RawSeason): Promise<void> {
  await db.query("INSERT INTO seasons (id, name, config) VALUES ($1,$2,$3)", [
    raw.seasonId,
    "test season",
    JSON.stringify(raw.config),
  ]);

  const owners = [...new Set(raw.fantasyTeams.map((t) => t.ownerProfileId))];
  for (const id of owners) {
    await db.query(
      "INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,$2,$3)",
      [id, "owner", false],
    );
  }

  for (const p of raw.players) {
    await db.query(
      `INSERT INTO players (id, season_id, registry_key, display_name, role, wk_eligible, starting_price, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [p.id, raw.seasonId, p.registryKey, p.displayName, p.role, p.wkEligible, p.startingPrice, p.active],
    );
  }
  for (const r of raw.rounds) {
    await db.query(
      "INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,$3,$4,$5)",
      [r.id, raw.seasonId, r.seq, r.name, r.lockAt],
    );
  }
  for (const m of raw.matches) {
    await db.query(
      `INSERT INTO matches (id, round_id, grade, opponent, status, final_day_date, finalised_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [m.id, m.roundId, m.grade, m.opponent, m.status, m.finalDayDate, m.finalisedAt],
    );
  }
  for (const s of raw.scorecards) {
    await db.query(
      "INSERT INTO scorecards (id, match_id, wicket_keeper_player_id, review_state) VALUES ($1,$2,$3,$4)",
      [s.id, s.matchId, s.wicketKeeperPlayerId, s.reviewState],
    );
    for (const pid of s.lineup) {
      await db.query(
        "INSERT INTO scorecard_lineup (scorecard_id, player_id) VALUES ($1,$2)",
        [s.id, pid],
      );
    }
    for (const b of s.batting) {
      await db.query(
        `INSERT INTO batting_lines (scorecard_id, player_id, runs, balls_faced, fours, sixes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [s.id, b.playerId, b.runs, b.ballsFaced, b.fours, b.sixes],
      );
    }
    for (const b of s.bowling) {
      await db.query(
        `INSERT INTO bowling_lines (scorecard_id, player_id, overs, runs_conceded, wickets)
         VALUES ($1,$2,$3,$4,$5)`,
        [s.id, b.playerId, b.overs, b.runsConceded, b.wickets],
      );
    }
    for (let i = 0; i < s.dismissals.length; i++) {
      await db.query(
        "INSERT INTO dismissals (scorecard_id, seq, raw_text) VALUES ($1,$2,$3)",
        [s.id, i, s.dismissals[i]],
      );
    }
  }
  for (const t of raw.fantasyTeams) {
    await db.query(
      "INSERT INTO fantasy_teams (id, season_id, owner_profile_id, name) VALUES ($1,$2,$3,$4)",
      [t.id, raw.seasonId, t.ownerProfileId, t.name],
    );
  }
  for (const s of raw.selections) {
    await db.query(
      `INSERT INTO selections (id, fantasy_team_id, round_id, player_id, is_captain, is_vice_captain)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [s.id, s.fantasyTeamId, s.roundId, s.playerId, s.isCaptain, s.isViceCaptain],
    );
  }
  for (const t of raw.trades) {
    await db.query(
      `INSERT INTO trades (id, fantasy_team_id, kind, player_id, price, round_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [t.id, t.fantasyTeamId, t.kind, t.playerId, t.price, t.roundId, t.createdAt],
    );
  }
}
