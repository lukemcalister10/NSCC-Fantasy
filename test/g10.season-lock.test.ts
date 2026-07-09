import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { recomputeSeason } from "../src/recompute/orchestrator.js";
import { loadRawSeason } from "../src/db/repository.js";
import type { RawSeason } from "../src/recompute/types.js";
import { makeTestDb, seedSeason } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";

/**
 * G10 SEASON_LOCK — the season lock is enforced in the DB (0002_locks.sql). One
 * operator action (setting seasons.locked_at) freezes the economy; the DB is the
 * gatekeeper for what may change before vs after.
 *
 * HAND-WORKED CASES:
 *   PRE-LOCK
 *     - settings propagate: bump scoring.perRun 1->2 in seasons.config; A's 100
 *       runs move base 100 -> 200 through recompute (config drives scoring)
 *     - starting prices editable (UPDATE players.starting_price OK)
 *     - team registration open (INSERT fantasy_teams OK)
 *   LOCK TRANSITION (Rider 3 / the 0001 COMMENT binding)
 *     - locking is REFUSED while any player has a NULL starting_price; once every
 *       seed is materialised the lock succeeds
 *   POST-LOCK (all rejected via direct API, not just the UI)
 *     - seasons.config mutation REJECTED           (settings incl. the config column)
 *     - players.starting_price mutation REJECTED    (starting prices)
 *     - fantasy_teams INSERT and DELETE REJECTED    (team registration, D21)
 *     - recompute still seeds price from the STORED starting_price only (never
 *       re-derived) — seq-0 price == players.starting_price
 */

const SEASON = "00000000-0000-0000-0000-000000010a00";
const ROUND = "00000000-0000-0000-0000-000000010a01";
const MATCH = "00000000-0000-0000-0000-000000010a02";
const SC = "00000000-0000-0000-0000-000000010a03";
const OWNER = "00000000-0000-0000-0000-000000010b00";
const OWNER2 = "00000000-0000-0000-0000-000000010b01";
const FT = "00000000-0000-0000-0000-000000010c00";
const FT2 = "00000000-0000-0000-0000-000000010c01";
const A = "00000000-0000-0000-0000-000000010d00"; // bats 100, in the match
const B = "00000000-0000-0000-0000-000000010d01"; // bench, used for the NULL-seed case

function buildRaw(): RawSeason {
  return {
    seasonId: SEASON,
    config: FIXTURE_CONFIG,
    players: [
      { id: A, registryKey: "a", displayName: "A", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
      { id: B, registryKey: "b", displayName: "B", role: "BWL", wkEligible: false, startingPrice: 50_000, active: true },
    ],
    rounds: [{ id: ROUND, seq: 1, name: "R", lockAt: "2099-01-01T00:00:00Z" }],
    matches: [
      { id: MATCH, roundId: ROUND, grade: "A", opponent: "Opp", status: "finalised", finalDayDate: "2026-10-04", finalisedAt: "2026-10-04T06:00:00Z" },
    ],
    scorecards: [
      { id: SC, matchId: MATCH, wicketKeeperPlayerId: null, reviewState: "committed", lineup: [A], batting: [{ playerId: A, runs: 100, ballsFaced: 100, fours: 0, sixes: 0 }], bowling: [], dismissals: [] },
    ],
    fantasyTeams: [{ id: FT, ownerProfileId: OWNER, name: "FT" }],
    selections: [],
    trades: [],
  };
}

const lock = (db: DbClient) =>
  db.query("UPDATE seasons SET locked_at = now() WHERE id = $1", [SEASON]);
const baseOfA = (d: ReturnType<typeof recomputeSeason>) =>
  d.playerMatchScores.find((s) => s.playerId === A)!.base;

describe("G10 SEASON_LOCK — pre-lock everything is tunable", () => {
  it("a scoring-config change propagates through recompute (settings drive scoring)", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    expect(baseOfA(recomputeSeason(await loadRawSeason(db, SEASON)))).toBe(100); // perRun 1
    // Bump perRun 1 -> 2 in the stored config (pre-lock: allowed).
    await db.query("UPDATE seasons SET config = jsonb_set(config, '{scoring,perRun}', '2') WHERE id = $1", [SEASON]);
    expect(baseOfA(recomputeSeason(await loadRawSeason(db, SEASON)))).toBe(200); // propagated
  });

  it("starting prices and team registration are editable pre-lock", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await expect(db.query("UPDATE players SET starting_price = 70000 WHERE id = $1", [A])).resolves.toBeDefined();
    await db.query("INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,'o2',false)", [OWNER2]);
    await expect(
      db.query("INSERT INTO fantasy_teams (id, season_id, owner_profile_id, name) VALUES ($1,$2,$3,'FT2')", [FT2, SEASON, OWNER2]),
    ).resolves.toBeDefined();
  });
});

describe("G10 SEASON_LOCK — the lock transition requires materialised seeds (Rider 3)", () => {
  it("refuses to lock while any player has a NULL starting_price, then locks once materialised", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    // Null out B's seed (pre-lock edit, allowed) — the season is now un-lockable.
    await db.query("UPDATE players SET starting_price = NULL WHERE id = $1", [B]);
    await expect(lock(db)).rejects.toThrow(/NULL starting_price|materialise/i);
    // Materialise B's seed; now the lock succeeds.
    await db.query("UPDATE players SET starting_price = 50000 WHERE id = $1", [B]);
    await expect(lock(db)).resolves.toBeDefined();
  });
});

describe("G10 SEASON_LOCK — post-lock immutability (direct API, not just UI)", () => {
  async function locked(): Promise<DbClient> {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await lock(db);
    return db;
  }

  it("rejects mutation of seasons.config", async () => {
    const db = await locked();
    await expect(
      db.query("UPDATE seasons SET config = jsonb_set(config, '{scoring,perRun}', '3') WHERE id = $1", [SEASON]),
    ).rejects.toThrow(/locked/);
  });

  it("rejects mutation of players.starting_price", async () => {
    const db = await locked();
    await expect(db.query("UPDATE players SET starting_price = 99000 WHERE id = $1", [A])).rejects.toThrow(/locked|frozen/);
  });

  it("rejects fantasy-team registration and deregistration (D21)", async () => {
    const db = await locked();
    await db.query("INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,'o2',false)", [OWNER2]);
    await expect(
      db.query("INSERT INTO fantasy_teams (id, season_id, owner_profile_id, name) VALUES ($1,$2,$3,'FT2')", [FT2, SEASON, OWNER2]),
    ).rejects.toThrow(/locked|frozen/);
    await expect(db.query("DELETE FROM fantasy_teams WHERE id = $1", [FT])).rejects.toThrow(/locked|frozen/);
  });

  it("recompute still seeds the price path from the STORED starting_price only", async () => {
    const db = await locked();
    const d = recomputeSeason(await loadRawSeason(db, SEASON));
    const seedA = d.priceHistory.find((p) => p.playerId === A && p.seq === 0)!;
    expect(seedA.price).toBe(60_000); // == players.starting_price, never re-derived
  });
});
