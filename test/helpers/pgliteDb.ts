import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { DbClient } from "../../src/db/repository.js";
import type { RawSeason } from "../../src/recompute/types.js";

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../supabase/migrations/", import.meta.url),
);

/**
 * SUPABASE ENVIRONMENT SHIM (TEST-ONLY — never applied on the real project).
 *
 * A real Supabase project already ships the `anon` / `authenticated` /
 * `service_role` roles and an `auth` schema with `auth.uid()` / `auth.role()`.
 * pglite does not. `0004_rls.sql` (a) references `auth.uid()` in policy
 * expressions — which must RESOLVE at CREATE POLICY time — and (b) GRANTs to /
 * REVOKEs from those three roles. This stands that environment up before the
 * migrations run so the SAME pure-Supabase 0004 executes unchanged in the gate
 * suite. SUPABASE_LIVE_VERIFY.md documents that this shim is NOT part of the
 * operator's apply steps (those objects pre-exist on the real project).
 *
 * `auth.uid()` is NULL-SAFE by design: current_setting(...,true) returns '' when
 * the GUC is unset; a bare ''::jsonb throws, so nullif(...) -> NULL keeps the cast
 * from ever raising (mirrors Supabase's own definition). This matters because the
 * G4 repair-hatch tests run as the bootstrap superuser with NO jwt claims, and the
 * manager-gated round-lock now calls app.is_manager() -> auth.uid() on that path.
 */
const SUPABASE_SHIM = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'anon'
  );
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
`;

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
  // The Supabase shim runs FIRST: 0004_rls.sql resolves auth.uid() at CREATE POLICY
  // time and grants to the anon/authenticated/service_role roles, all of which a real
  // project already provides but pglite does not.
  await pg.exec(SUPABASE_SHIM);
  for (const sql of migrationSql()) await pg.exec(sql);
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const r = await pg.query(sql, params as never[]);
      return { rows: r.rows as T[] };
    },
  };
}

/** A simulated Supabase auth context: the PostgREST connection role plus (for a
 *  logged-in user) the JWT `sub`. Anon carries no sub. */
export type AuthCtx = {
  role: "anon" | "authenticated" | "service_role";
  sub?: string;
};

/**
 * Run `fn` under a simulated Supabase auth context — exactly how PostgREST serves a
 * request: set `request.jwt.claims`, then `SET LOCAL ROLE` to drop from the
 * superuser connection to anon/authenticated/service_role so RLS actually applies.
 * Everything runs in ONE transaction so DEFERRABLE constraint triggers (G15
 * composition, Rider-1 captain, G15 trade limits) fire under the acting role at
 * COMMIT — a faithful "write committed as this user" probe. Rolls back and rethrows
 * on any error (including a failed COMMIT); the LOCAL role/GUC reset automatically.
 */
export async function asAuthed<T>(
  db: DbClient,
  ctx: AuthCtx,
  fn: () => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify(
    ctx.sub ? { sub: ctx.sub, role: ctx.role } : { role: ctx.role },
  );
  await db.query("BEGIN");
  try {
    await db.query("SELECT set_config('request.jwt.claims', $1, true)", [claims]);
    await db.query(`SET LOCAL ROLE ${ctx.role}`);
    const out = await fn();
    await db.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // Transaction already aborted (e.g. a failed COMMIT ended it) — nothing to undo.
    }
    throw err;
  }
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
