import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { makeTestDb, asAuthed } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";

/**
 * G13 AUTH_BOUNDARY — RLS is the DATABASE'S job (0004_rls.sql), not the UI's. Every
 * probe below runs under a SIMULATED Supabase auth context (`asAuthed`: set
 * request.jwt.claims + SET LOCAL ROLE), so anon/authenticated/service_role are exercised
 * exactly as PostgREST would serve them — RLS applies because the acting role is not the
 * superuser owner. The scaffold is seeded as the bootstrap superuser (bypasses RLS), the
 * same trusted-backend position recompute holds in production.
 *
 * HAND-WORKED CASES (accept / reject, direct writes — "the API called directly"):
 *   0. SET ROLE actually drops privilege and makes RLS bite (smoke).
 *   1. league manager writes raw truth -> OK.
 *   2. a participant writes their OWN team's legal squad + a trade -> OK (deferred G15
 *      composition / Rider-1 captain / trade guards pass under RLS at COMMIT); own rows
 *      read back; a rival cannot see them pre-lock.
 *   3. a participant writing ANOTHER team's selection/trade -> REJECTED (RLS WITH CHECK).
 *   4. a non-manager writing raw truth -> REJECTED (RLS WITH CHECK).
 *   5. a client (participant AND manager) writing a DERIVED table -> REJECTED (no grant);
 *      service_role writes it -> OK (the recompute path).
 *   6. anon reads anything -> REJECTED (permission denied — logged-out sees nothing, D17).
 *   7. app.locks_bypass is AUTHORISED: non-manager + bypass into a locked round ->
 *      REJECTED; manager + bypass -> OK (the manager repair hatch).
 *   8. lock-gated cross-read (Decision 3): a rival's selections are invisible before that
 *      round's lock_at, visible after; own always; manager always.
 *   9. profiles: read the enumerated {id, display_name, photo_path, is_league_manager} of
 *      all; self-update a display field -> OK; self-set is_league_manager -> REJECTED.
 *  10. binding decision 2 (rider): one team per profile per season — a second
 *      self-registration is REJECTED on the UNIQUE constraint.
 */

const SEASON = "00000000-0000-0000-0000-0000000013a0";
const OWNER_A = "00000000-0000-0000-0000-0000000013a1";
const OWNER_B = "00000000-0000-0000-0000-0000000013a2";
const MANAGER = "00000000-0000-0000-0000-0000000013a3";
const OWNER_C = "00000000-0000-0000-0000-0000000013a4"; // owns no team (for self-register cases)
const FT_A = "00000000-0000-0000-0000-0000000013f0";
const FT_B = "00000000-0000-0000-0000-0000000013f1";
const R_OPEN = "00000000-0000-0000-0000-0000000013b0";
const R_LOCKED = "00000000-0000-0000-0000-0000000013b1";
// A legal fixture squad (2 BAT / 1 WK / 2 BWL / 1 AR), first is captain.
const PB1 = "00000000-0000-0000-0000-0000000013d0"; // BAT (captain)
const PB2 = "00000000-0000-0000-0000-0000000013d1"; // BAT
const PW = "00000000-0000-0000-0000-0000000013d2"; // WK
const PL1 = "00000000-0000-0000-0000-0000000013d3"; // BWL
const PL2 = "00000000-0000-0000-0000-0000000013d4"; // BWL
const PA = "00000000-0000-0000-0000-0000000013d5"; // AR

const SQUAD: ReadonlyArray<readonly [string, boolean]> = [
  [PB1, true], [PB2, false], [PW, false], [PL1, false], [PL2, false], [PA, false],
];
const PLAYERS: ReadonlyArray<readonly [string, string, string]> = [
  [PB1, "pb1", "BAT"], [PB2, "pb2", "BAT"], [PW, "pw", "WK"],
  [PL1, "pl1", "BWL"], [PL2, "pl2", "BWL"], [PA, "pa", "AR"],
];

let selCounter = 0;
const selId = () =>
  `00000000-0000-0000-0000-13c${String(++selCounter).padStart(9, "0")}`;

/** Six INSERTs forming a legal squad for (team, round). The caller supplies the
 *  transaction (asAuthed wraps one; the superuser seeder wraps its own) so the deferred
 *  composition / captain checks see the completed set at COMMIT. */
async function insertSquad(db: DbClient, team: string, round: string): Promise<void> {
  for (const [pid, cap] of SQUAD) {
    await db.query(
      "INSERT INTO selections (id, fantasy_team_id, round_id, player_id, is_captain, is_vice_captain) VALUES ($1,$2,$3,$4,$5,false)",
      [selId(), team, round, pid, cap],
    );
  }
}

/** Seed a squad as the superuser (its own txn). `bypass` must already be set on the
 *  session when the target round is locked. */
async function seedSquadSuperuser(db: DbClient, team: string, round: string): Promise<void> {
  await db.query("BEGIN");
  try {
    await insertSquad(db, team, round);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}

const insTrade = (db: DbClient, id: string, team: string, round: string, price = 60000) =>
  db.query(
    "INSERT INTO trades (id, fantasy_team_id, kind, player_id, price, round_id) VALUES ($1,$2,'buy',$3,$4,$5)",
    [id, team, PB1, price, round],
  );

/** Seed the raw scaffold as the bootstrap superuser (RLS bypassed): one season, three
 *  team-owning profiles + a manager + a team-less owner, six players, two teams, two
 *  rounds. R_OPEN locks in the future; R_LOCKED locked one second ago. */
async function setup(): Promise<DbClient> {
  const db = await makeTestDb();
  await db.query("INSERT INTO seasons (id, name, config) VALUES ($1,$2,$3)", [
    SEASON, "g13 season", JSON.stringify(FIXTURE_CONFIG),
  ]);
  const profiles: ReadonlyArray<readonly [string, boolean]> = [
    [OWNER_A, false], [OWNER_B, false], [MANAGER, true], [OWNER_C, false],
  ];
  for (const [id, mgr] of profiles) {
    await db.query(
      "INSERT INTO profiles (id, display_name, is_league_manager, photo_path) VALUES ($1,$2,$3,$4)",
      [id, `name-${id.slice(-2)}`, mgr, `photos/${id.slice(-2)}.jpg`],
    );
  }
  for (const [id, key, role] of PLAYERS) {
    await db.query(
      "INSERT INTO players (id, season_id, registry_key, display_name, role, wk_eligible, starting_price, active) VALUES ($1,$2,$3,$4,$5,false,50000,true)",
      [id, SEASON, key, key.toUpperCase(), role],
    );
  }
  for (const [id, seq, name] of [[R_OPEN, 1, "Open"], [R_LOCKED, 2, "Locked"]] as const) {
    await db.query(
      "INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,$3,$4,'2099-01-01T00:00:00Z')",
      [id, SEASON, seq, name],
    );
  }
  await db.query("INSERT INTO fantasy_teams (id, season_id, owner_profile_id, name) VALUES ($1,$2,$3,'Team A')", [FT_A, SEASON, OWNER_A]);
  await db.query("INSERT INTO fantasy_teams (id, season_id, owner_profile_id, name) VALUES ($1,$2,$3,'Team B')", [FT_B, SEASON, OWNER_B]);
  await db.query("UPDATE rounds SET lock_at = now() + interval '1 hour'  WHERE id = $1", [R_OPEN]);
  await db.query("UPDATE rounds SET lock_at = now() - interval '1 second' WHERE id = $1", [R_LOCKED]);
  return db;
}

const authed = (sub: string) => ({ role: "authenticated" as const, sub });

describe("G13 AUTH_BOUNDARY — RLS enforced in the DB", () => {
  it("0. SET ROLE drops privilege and RLS applies; anon is denied (smoke)", async () => {
    const db = await setup();
    const who = await asAuthed(db, authed(OWNER_A), () =>
      db.query<{ current_user: string }>("SELECT current_user"),
    );
    expect(who.rows[0]!.current_user).toBe("authenticated");
    // authenticated may read league data...
    const seen = await asAuthed(db, authed(OWNER_A), () =>
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM players"),
    );
    expect(Number(seen.rows[0]!.n)).toBe(6);
    // ...anon may read nothing.
    await expect(
      asAuthed(db, { role: "anon" }, () => db.query("SELECT count(*) FROM players")),
    ).rejects.toThrow(/permission denied/);
  });

  it("1. league manager writes raw truth (players) -> OK", async () => {
    const db = await setup();
    await expect(
      asAuthed(db, authed(MANAGER), () =>
        db.query(
          "INSERT INTO players (id, season_id, registry_key, display_name, role, wk_eligible, starting_price, active) VALUES ($1,$2,'new','New',$3,false,9000,true)",
          ["00000000-0000-0000-0000-0000000013de", SEASON, "BAT"],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("2. participant writes OWN squad + trade -> OK; own read visible, rival blind pre-lock", async () => {
    const db = await setup();
    // Own legal squad committed as OWNER_A (deferred composition/captain fire under RLS).
    await expect(
      asAuthed(db, authed(OWNER_A), () => insertSquad(db, FT_A, R_OPEN)),
    ).resolves.toBeUndefined();
    // Own trade committed as OWNER_A (founding buy: exempt from the count, within cap).
    await expect(
      asAuthed(db, authed(OWNER_A), () =>
        insTrade(db, "00000000-0000-0000-0000-000000013e01", FT_A, R_OPEN)),
    ).resolves.toBeDefined();
    // OWNER_A reads their own selections (own => always visible, even in an open round).
    const own = await asAuthed(db, authed(OWNER_A), () =>
      db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM selections WHERE fantasy_team_id=$1 AND round_id=$2",
        [FT_A, R_OPEN]),
    );
    expect(Number(own.rows[0]!.n)).toBe(6);
    // OWNER_B cannot see OWNER_A's selections while R_OPEN is unlocked.
    const rival = await asAuthed(db, authed(OWNER_B), () =>
      db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM selections WHERE fantasy_team_id=$1 AND round_id=$2",
        [FT_A, R_OPEN]),
    );
    expect(Number(rival.rows[0]!.n)).toBe(0);
  });

  it("3. participant writing ANOTHER team's rows -> REJECTED (RLS WITH CHECK)", async () => {
    const db = await setup();
    await expect(
      asAuthed(db, authed(OWNER_A), () =>
        db.query(
          "INSERT INTO selections (id, fantasy_team_id, round_id, player_id, is_captain, is_vice_captain) VALUES ($1,$2,$3,$4,true,false)",
          [selId(), FT_B, R_OPEN, PB1]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asAuthed(db, authed(OWNER_A), () =>
        insTrade(db, "00000000-0000-0000-0000-000000013e03", FT_B, R_OPEN)),
    ).rejects.toThrow(/row-level security/);
  });

  it("4. non-manager writing raw truth -> REJECTED (RLS WITH CHECK)", async () => {
    const db = await setup();
    await expect(
      asAuthed(db, authed(OWNER_A), () =>
        db.query(
          "INSERT INTO players (id, season_id, registry_key, display_name, role, wk_eligible, starting_price, active) VALUES ($1,$2,'x','X','BAT',false,9000,true)",
          ["00000000-0000-0000-0000-0000000013df", SEASON]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("5. client writes to a DERIVED table -> REJECTED; service_role writes it -> OK", async () => {
    const db = await setup();
    const insLadder = (r: DbClient) =>
      r.query(
        "INSERT INTO ladder (season_id, fantasy_team_id, played, wins, losses, ties, points_for, ladder_points) VALUES ($1,$2,0,0,0,0,0,0)",
        [SEASON, FT_A]);
    // A participant is denied (no write grant on derived tables at all).
    await expect(asAuthed(db, authed(OWNER_A), () => insLadder(db))).rejects.toThrow(/permission denied/);
    // The MANAGER is ALSO denied — a manager is `authenticated`, and derived tables take
    // no client writes (recompute only).
    await expect(asAuthed(db, authed(MANAGER), () => insLadder(db))).rejects.toThrow(/permission denied/);
    // The service role (recompute) writes it.
    await expect(asAuthed(db, { role: "service_role" }, () => insLadder(db))).resolves.toBeDefined();
  });

  it("6. anon reads anything -> REJECTED (logged-out sees nothing, D17)", async () => {
    const db = await setup();
    for (const table of ["profiles", "players", "ladder", "fantasy_teams"]) {
      await expect(
        asAuthed(db, { role: "anon" }, () => db.query(`SELECT * FROM ${table} LIMIT 1`)),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("7. app.locks_bypass is manager-only: non-manager REJECTED, manager OK", async () => {
    const db = await setup();
    // Non-manager sets the GUC and writes into the LOCKED round -> bypass ignored -> rejected.
    await expect(
      asAuthed(db, authed(OWNER_A), async () => {
        await db.query("SET LOCAL app.locks_bypass = 'on'");
        return insTrade(db, "00000000-0000-0000-0000-000000013e07", FT_A, R_LOCKED);
      }),
    ).rejects.toThrow(/locked/);
    // Manager's repair hatch: bypass honoured -> the same locked-round write succeeds.
    await expect(
      asAuthed(db, authed(MANAGER), async () => {
        await db.query("SET LOCAL app.locks_bypass = 'on'");
        return insTrade(db, "00000000-0000-0000-0000-000000013e08", FT_A, R_LOCKED);
      }),
    ).resolves.toBeDefined();
  });

  it("8. cross-read is lock-gated (Decision 3): rival blind pre-lock, visible post-lock", async () => {
    const db = await setup();
    // Seed squads via the superuser manager bypass (R_LOCKED is already locked).
    await db.query("SET app.locks_bypass = 'on'");
    await seedSquadSuperuser(db, FT_A, R_OPEN);
    await seedSquadSuperuser(db, FT_B, R_OPEN);
    await seedSquadSuperuser(db, FT_B, R_LOCKED);
    await db.query("SET app.locks_bypass = 'off'");

    const countFor = (sub: string, team: string, round: string) =>
      asAuthed(db, authed(sub), () =>
        db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM selections WHERE fantasy_team_id=$1 AND round_id=$2",
          [team, round]),
      ).then((r) => Number(r.rows[0]!.n));

    // OWNER_A vs rival FT_B: invisible while R_OPEN is unlocked, visible once R_LOCKED has locked.
    expect(await countFor(OWNER_A, FT_B, R_OPEN)).toBe(0);
    expect(await countFor(OWNER_A, FT_B, R_LOCKED)).toBe(6);
    // Own team is always visible even in the open round.
    expect(await countFor(OWNER_A, FT_A, R_OPEN)).toBe(6);
    // Manager sees everything at all times, including the unlocked rival round.
    expect(await countFor(MANAGER, FT_B, R_OPEN)).toBe(6);
  });

  it("9. profiles: read the enumerated set; self-update display OK; self-set manager REJECTED", async () => {
    const db = await setup();
    // Reads the four enumerated columns of every profile.
    const rows = await asAuthed(db, authed(OWNER_A), () =>
      db.query("SELECT id, display_name, photo_path, is_league_manager FROM profiles"),
    );
    expect(rows.rows.length).toBe(4);
    // Self-update of a display field succeeds.
    await expect(
      asAuthed(db, authed(OWNER_A), () =>
        db.query("UPDATE profiles SET display_name='Renamed A' WHERE id=$1", [OWNER_A])),
    ).resolves.toBeDefined();
    const after = await db.query<{ display_name: string }>(
      "SELECT display_name FROM profiles WHERE id=$1", [OWNER_A]);
    expect(after.rows[0]!.display_name).toBe("Renamed A");
    // Self-set of is_league_manager is barred for EVERY client (column not granted).
    await expect(
      asAuthed(db, authed(OWNER_A), () =>
        db.query("UPDATE profiles SET is_league_manager=true WHERE id=$1", [OWNER_A])),
    ).rejects.toThrow(/permission denied/);
    // Updating someone else's row is a no-op (RLS USING(id=auth.uid()) filters it out).
    await asAuthed(db, authed(OWNER_A), () =>
      db.query("UPDATE profiles SET display_name='hax' WHERE id=$1", [OWNER_B]));
    const b = await db.query<{ display_name: string }>(
      "SELECT display_name FROM profiles WHERE id=$1", [OWNER_B]);
    expect(b.rows[0]!.display_name).not.toBe("hax");
  });

  it("10. one team per profile per season: second self-registration REJECTED (rider)", async () => {
    const db = await setup();
    // OWNER_C owns no team: their first self-registration succeeds...
    await expect(
      asAuthed(db, authed(OWNER_C), () =>
        db.query(
          "INSERT INTO fantasy_teams (id, season_id, owner_profile_id, name) VALUES ($1,$2,$3,'C1')",
          ["00000000-0000-0000-0000-0000000013fc", SEASON, OWNER_C]),
      ),
    ).resolves.toBeDefined();
    // ...a SECOND team in the same season is rejected on the UNIQUE index (RLS passes —
    // owner is still auth.uid() — so it is the constraint, not the policy, that bites).
    await expect(
      asAuthed(db, authed(OWNER_C), () =>
        db.query(
          "INSERT INTO fantasy_teams (id, season_id, owner_profile_id, name) VALUES ($1,$2,$3,'C2')",
          ["00000000-0000-0000-0000-0000000013fd", SEASON, OWNER_C]),
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
