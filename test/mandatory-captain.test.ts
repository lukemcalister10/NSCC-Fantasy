import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import type { RawSeason } from "../src/recompute/types.js";
import { makeTestDb, seedSeason } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";

/**
 * RIDER 1 — MANDATORY CAPTAIN, both halves, enforced in the DB.
 *   "<= 1 captain per (team, round)": 0001's one_captain_per_team_round partial
 *     unique index (fires immediately).
 *   ">= 1 captain per (team, round) that has any selection": 0002's DEFERRABLE
 *     INITIALLY DEFERRED constraint trigger (fires at COMMIT, so a team's
 *     selections may be written in any order within the transaction).
 *
 * HAND-WORKED CASES (team FT, open round R):
 *   - selections present, ZERO captains        -> rejected at COMMIT
 *   - vice-captain inserted BEFORE the captain -> COMMITS (order-independent)
 *   - a SECOND captain                         -> rejected immediately (unique index)
 *   - a (team, round) with NO selections is fine (nothing to caption)
 */

const SEASON = "00000000-0000-0000-0000-0000000c1a00";
const ROUND = "00000000-0000-0000-0000-0000000c1a01";
const OWNER = "00000000-0000-0000-0000-0000000c1b00";
const FT = "00000000-0000-0000-0000-0000000c1c00";
// Six players forming a legal G15 squad (2 BAT / 1 WK / 2 BWL / 1 AR) so the
// composition guard (0003) passes and only the captain rules are under test here.
const P1 = "00000000-0000-0000-0000-0000000c1d01"; // BAT
const P2 = "00000000-0000-0000-0000-0000000c1d02"; // BWL
const P3 = "00000000-0000-0000-0000-0000000c1d03"; // AR
const P4 = "00000000-0000-0000-0000-0000000c1d04"; // BAT
const P5 = "00000000-0000-0000-0000-0000000c1d05"; // WK
const P6 = "00000000-0000-0000-0000-0000000c1d06"; // BWL

/** @param withSquad seed the six selections (P2 as the sole captain) — used by the
 *  "second captain" case, which then needs a valid, already-captained squad. */
function buildRaw(withSquad = false): RawSeason {
  return {
    seasonId: SEASON,
    config: FIXTURE_CONFIG,
    players: [
      { id: P1, registryKey: "p1", displayName: "P1", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
      { id: P2, registryKey: "p2", displayName: "P2", role: "BWL", wkEligible: false, startingPrice: 50_000, active: true },
      { id: P3, registryKey: "p3", displayName: "P3", role: "AR", wkEligible: false, startingPrice: 40_000, active: true },
      { id: P4, registryKey: "p4", displayName: "P4", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
      { id: P5, registryKey: "p5", displayName: "P5", role: "WK", wkEligible: false, startingPrice: 50_000, active: true },
      { id: P6, registryKey: "p6", displayName: "P6", role: "BWL", wkEligible: false, startingPrice: 50_000, active: true },
    ],
    rounds: [{ id: ROUND, seq: 1, name: "R", lockAt: "2099-01-01T00:00:00Z" }],
    matches: [],
    scorecards: [],
    fantasyTeams: [{ id: FT, ownerProfileId: OWNER, name: "FT" }],
    selections: withSquad
      ? [
          { id: sid(), fantasyTeamId: FT, roundId: ROUND, playerId: P2, isCaptain: true, isViceCaptain: false },
          { id: sid(), fantasyTeamId: FT, roundId: ROUND, playerId: P1, isCaptain: false, isViceCaptain: false },
          { id: sid(), fantasyTeamId: FT, roundId: ROUND, playerId: P3, isCaptain: false, isViceCaptain: false },
          { id: sid(), fantasyTeamId: FT, roundId: ROUND, playerId: P4, isCaptain: false, isViceCaptain: false },
          { id: sid(), fantasyTeamId: FT, roundId: ROUND, playerId: P5, isCaptain: false, isViceCaptain: false },
          { id: sid(), fantasyTeamId: FT, roundId: ROUND, playerId: P6, isCaptain: false, isViceCaptain: false },
        ]
      : [],
    trades: [],
  };
}

let idc = 0;
const sid = () => `00000000-0000-0000-0000-0000c1e${String(idc++).padStart(5, "0")}`;
const insSel = (db: DbClient, playerId: string, isCaptain: boolean, isVice = false) =>
  db.query(
    "INSERT INTO selections (id, fantasy_team_id, round_id, player_id, is_captain, is_vice_captain) VALUES ($1,$2,$3,$4,$5,$6)",
    [sid(), FT, ROUND, playerId, isCaptain, isVice],
  );

describe("RIDER 1 — mandatory captain (>= 1) at commit time", () => {
  it("rejects a team-round that has selections but no captain, at COMMIT", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    // A legal squad (so G15 composition passes) but with ZERO captains.
    await db.query("BEGIN");
    await insSel(db, P1, false, true); // vice-captain
    await insSel(db, P2, false);
    await insSel(db, P3, false);
    await insSel(db, P4, false);
    await insSel(db, P5, false);
    await insSel(db, P6, false);
    await expect(db.query("COMMIT")).rejects.toThrow(/exactly one captain/);
  });

  it("commits when the vice-captain is inserted BEFORE the captain (order-independent)", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await db.query("BEGIN");
    await insSel(db, P5, false, true); // vice first
    await insSel(db, P2, true); // captain second
    await insSel(db, P1, false);
    await insSel(db, P3, false);
    await insSel(db, P4, false);
    await insSel(db, P6, false);
    await expect(db.query("COMMIT")).resolves.toBeDefined();
  });

  it("rejects a SECOND captain via the existing partial unique index (<= 1 half)", async () => {
    const db = await makeTestDb();
    // Seed a legal, already-captained (P2) squad, then promote a second captain:
    // the partial unique index fires IMMEDIATELY (before the deferred guards).
    await seedSeason(db, buildRaw(true));
    await expect(
      db.query(
        "UPDATE selections SET is_captain = true WHERE fantasy_team_id = $1 AND round_id = $2 AND player_id = $3",
        [FT, ROUND, P1],
      ),
    ).rejects.toThrow(/unique|one_captain/i);
  });
});
