import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import type { RawSeason } from "../src/recompute/types.js";
import { makeTestDb, seedSeason } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";

/**
 * G4 LOCK_ENFORCEMENT — the round lock is the DATABASE'S job (0002_locks.sql),
 * not the UI's. Every write below is a DIRECT INSERT/UPDATE against the tables,
 * i.e. "the API called directly, bypassing the UI" (G4's wording). The guard
 * compares rounds.lock_at against now() at WRITE time, PER-ROUND (D6).
 *
 * HAND-WORKED CASES (today is well before any 2099 lock, well after any 2000 lock;
 * the test pins lock_at RELATIVE to now() so "lock+1s" is exact):
 *   R_OPEN.lock_at   = now() + 1 hour  -> now() < lock  -> writes ALLOWED
 *   R_LOCKED.lock_at = now() - 1 sec   -> now() >= lock -> writes REJECTED  (== lock+1s)
 * Cases proven:
 *   1. selection INSERT pre-lock -> OK ; at lock+1s -> REJECTED
 *   2. trade      INSERT pre-lock -> OK ; at lock+1s -> REJECTED
 *   3. per-round: the SAME write is allowed into R_OPEN and rejected into R_LOCKED
 *      in one season -> the lock is read per round, not per season
 *   4. cross-boundary UPDATE (Rider 1): moving a row open->locked is rejected on
 *      the NEW round; moving locked->open is rejected on the OLD round — a row
 *      cannot cross the boundary in EITHER direction
 *   5. repair hatch (Rider 2): with app.locks_bypass='on' a write into a LOCKED
 *      round is permitted; default (unset/off) it is rejected
 */

const SEASON = "00000000-0000-0000-0000-0000000004a0";
const R_OPEN = "00000000-0000-0000-0000-0000000004a1";
const R_LOCKED = "00000000-0000-0000-0000-0000000004a2";
const OWNER = "00000000-0000-0000-0000-0000000004b0";
const FT = "00000000-0000-0000-0000-0000000004c0";
const PL = "00000000-0000-0000-0000-0000000004d0";

// Selection / trade ids used across the cases.
const S_OPEN = "00000000-0000-0000-0000-000000040001";
const S_MOVE = "00000000-0000-0000-0000-000000040002";
const S_IN_LOCKED = "00000000-0000-0000-0000-000000040003";
const T_OPEN = "00000000-0000-0000-0000-000000040101";
const T_BYPASS = "00000000-0000-0000-0000-000000040102";

/** Minimal season: two rounds, one team, one player, NO matches/selections/trades
 *  (the test does the raw writes itself). lock_at values are placeholders — the
 *  test overrides them relative to now(). */
function buildRaw(): RawSeason {
  return {
    seasonId: SEASON,
    config: FIXTURE_CONFIG,
    players: [
      { id: PL, registryKey: "pl", displayName: "PL", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
    ],
    rounds: [
      { id: R_OPEN, seq: 1, name: "Open", lockAt: "2099-01-01T00:00:00Z" },
      { id: R_LOCKED, seq: 2, name: "Locked", lockAt: "2099-01-01T00:00:00Z" },
    ],
    matches: [],
    scorecards: [],
    fantasyTeams: [{ id: FT, ownerProfileId: OWNER, name: "FT" }],
    selections: [],
    trades: [],
  };
}

async function setup(): Promise<DbClient> {
  const db = await makeTestDb();
  await seedSeason(db, buildRaw());
  // Pin the locks relative to now(): open in the future, locked one second ago.
  await db.query("UPDATE rounds SET lock_at = now() + interval '1 hour' WHERE id = $1", [R_OPEN]);
  await db.query("UPDATE rounds SET lock_at = now() - interval '1 second' WHERE id = $1", [R_LOCKED]);
  return db;
}

const insSelection = (db: DbClient, id: string, roundId: string) =>
  db.query(
    "INSERT INTO selections (id, fantasy_team_id, round_id, player_id, is_captain, is_vice_captain) VALUES ($1,$2,$3,$4,true,false)",
    [id, FT, roundId, PL],
  );

const insTrade = (db: DbClient, id: string, roundId: string) =>
  db.query(
    "INSERT INTO trades (id, fantasy_team_id, kind, player_id, price, round_id) VALUES ($1,$2,'buy',$3,60000,$4)",
    [id, FT, PL, roundId],
  );

describe("G4 LOCK_ENFORCEMENT — round lock enforced in the DB", () => {
  it("selection/trade succeed pre-lock and are rejected at lock+1s (per-round)", async () => {
    const db = await setup();
    // Pre-lock (R_OPEN): both succeed.
    await expect(insSelection(db, S_OPEN, R_OPEN)).resolves.toBeDefined();
    await expect(insTrade(db, T_OPEN, R_OPEN)).resolves.toBeDefined();
    // lock+1s (R_LOCKED): the SAME writes are rejected server-side.
    await expect(insSelection(db, "00000000-0000-0000-0000-000000040009", R_LOCKED)).rejects.toThrow(/locked/);
    await expect(insTrade(db, "00000000-0000-0000-0000-000000040109", R_LOCKED)).rejects.toThrow(/locked/);
  });

  it("a row cannot be MOVED across the lock boundary in either direction (Rider 1)", async () => {
    const db = await setup();
    // A live selection in the open round.
    await insSelection(db, S_MOVE, R_OPEN);
    // open -> locked: rejected on the NEW round.
    await expect(
      db.query("UPDATE selections SET round_id = $1 WHERE id = $2", [R_LOCKED, S_MOVE]),
    ).rejects.toThrow(/locked/);

    // Seed a row INTO the locked round via the bypass, then try to move it OUT.
    await db.query("SET app.locks_bypass = 'on'");
    await insSelection(db, S_IN_LOCKED, R_LOCKED);
    await db.query("SET app.locks_bypass = 'off'");
    // locked -> open: rejected on the OLD round (still under lock).
    await expect(
      db.query("UPDATE selections SET round_id = $1 WHERE id = $2", [R_OPEN, S_IN_LOCKED]),
    ).rejects.toThrow(/locked/);
  });

  it("the app.locks_bypass repair hatch permits a locked-round write; default rejects (Rider 2)", async () => {
    const db = await setup();
    // Default (unset): a trade into the locked round is rejected.
    await expect(insTrade(db, "00000000-0000-0000-0000-000000040119", R_LOCKED)).rejects.toThrow(/locked/);
    // Bypass on: the manager's fix path lets the same write through.
    await db.query("SET app.locks_bypass = 'on'");
    await expect(insTrade(db, T_BYPASS, R_LOCKED)).resolves.toBeDefined();
    // Bypass off again: back to rejecting.
    await db.query("SET app.locks_bypass = 'off'");
    await expect(insTrade(db, "00000000-0000-0000-0000-000000040129", R_LOCKED)).rejects.toThrow(/locked/);
  });
});
