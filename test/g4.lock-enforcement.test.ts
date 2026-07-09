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
// Six players forming a legal G15 squad (2 BAT / 1 WK / 2 BWL / 1 AR): a selection
// write that SUCCEEDS pre-lock must now be a whole valid squad, not a lone row.
const PL = "00000000-0000-0000-0000-0000000004d0"; // BAT
const PL2 = "00000000-0000-0000-0000-0000000004d1"; // BAT
const PLW = "00000000-0000-0000-0000-0000000004d2"; // WK
const PLB1 = "00000000-0000-0000-0000-0000000004d3"; // BWL
const PLB2 = "00000000-0000-0000-0000-0000000004d4"; // BWL
const PLA = "00000000-0000-0000-0000-0000000004d5"; // AR

// Trade ids used across the cases (selections are seeded as whole squads).
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
      { id: PL2, registryKey: "pl2", displayName: "PL2", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
      { id: PLW, registryKey: "plw", displayName: "PLW", role: "WK", wkEligible: false, startingPrice: 50_000, active: true },
      { id: PLB1, registryKey: "plb1", displayName: "PLB1", role: "BWL", wkEligible: false, startingPrice: 50_000, active: true },
      { id: PLB2, registryKey: "plb2", displayName: "PLB2", role: "BWL", wkEligible: false, startingPrice: 50_000, active: true },
      { id: PLA, registryKey: "pla", displayName: "PLA", role: "AR", wkEligible: false, startingPrice: 40_000, active: true },
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

// A legal G15 squad (2 BAT / 1 WK / 2 BWL / 1 AR, PL captain) for (FT, round),
// committed in one transaction — used wherever a selection write must SUCCEED.
const SQUAD: ReadonlyArray<readonly [string, boolean]> = [
  [PL, true], [PL2, false], [PLW, false], [PLB1, false], [PLB2, false], [PLA, false],
];
let selc = 0;
const selId = () => `00000000-0000-0000-0000-04c1e${String(selc++).padStart(7, "0")}`;
async function seedSquad(db: DbClient, roundId: string): Promise<void> {
  await db.query("BEGIN");
  for (const [pid, cap] of SQUAD) {
    await db.query(
      "INSERT INTO selections (id, fantasy_team_id, round_id, player_id, is_captain, is_vice_captain) VALUES ($1,$2,$3,$4,$5,false)",
      [selId(), FT, roundId, pid, cap],
    );
  }
  await db.query("COMMIT");
}

const insTrade = (db: DbClient, id: string, roundId: string) =>
  db.query(
    "INSERT INTO trades (id, fantasy_team_id, kind, player_id, price, round_id) VALUES ($1,$2,'buy',$3,60000,$4)",
    [id, FT, PL, roundId],
  );

describe("G4 LOCK_ENFORCEMENT — round lock enforced in the DB", () => {
  it("selection/trade succeed pre-lock and are rejected at lock+1s (per-round)", async () => {
    const db = await setup();
    // Pre-lock (R_OPEN): a legal squad and a trade both succeed.
    await expect(seedSquad(db, R_OPEN)).resolves.toBeUndefined();
    await expect(insTrade(db, T_OPEN, R_OPEN)).resolves.toBeDefined();
    // lock+1s (R_LOCKED): the SAME writes are rejected server-side. The round-lock
    // BEFORE trigger fires immediately, before any deferred composition check — so a
    // lone insert is a faithful "team change at lock+1s" probe.
    await expect(insSelection(db, "00000000-0000-0000-0000-000000040009", R_LOCKED)).rejects.toThrow(/locked/);
    await expect(insTrade(db, "00000000-0000-0000-0000-000000040109", R_LOCKED)).rejects.toThrow(/locked/);
  });

  it("a row cannot be MOVED across the lock boundary in either direction (Rider 1)", async () => {
    const db = await setup();
    // A live legal squad in the open round.
    await seedSquad(db, R_OPEN);
    // open -> locked: moving ONE member is rejected on the NEW round (lock fires first).
    await expect(
      db.query("UPDATE selections SET round_id = $1 WHERE fantasy_team_id = $2 AND round_id = $3 AND player_id = $4", [R_LOCKED, FT, R_OPEN, PL2]),
    ).rejects.toThrow(/locked/);

    // Seed a legal squad INTO the locked round via the round-lock bypass, then move one OUT.
    await db.query("SET app.locks_bypass = 'on'");
    await seedSquad(db, R_LOCKED);
    await db.query("SET app.locks_bypass = 'off'");
    // locked -> open: rejected on the OLD round (still under lock).
    await expect(
      db.query("UPDATE selections SET round_id = $1 WHERE fantasy_team_id = $2 AND round_id = $3 AND player_id = $4", [R_OPEN, FT, R_LOCKED, PL2]),
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
