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
const P1 = "00000000-0000-0000-0000-0000000c1d01";
const P2 = "00000000-0000-0000-0000-0000000c1d02";
const P3 = "00000000-0000-0000-0000-0000000c1d03";

function buildRaw(): RawSeason {
  return {
    seasonId: SEASON,
    config: FIXTURE_CONFIG,
    players: [
      { id: P1, registryKey: "p1", displayName: "P1", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
      { id: P2, registryKey: "p2", displayName: "P2", role: "BWL", wkEligible: false, startingPrice: 50_000, active: true },
      { id: P3, registryKey: "p3", displayName: "P3", role: "AR", wkEligible: false, startingPrice: 40_000, active: true },
    ],
    rounds: [{ id: ROUND, seq: 1, name: "R", lockAt: "2099-01-01T00:00:00Z" }],
    matches: [],
    scorecards: [],
    fantasyTeams: [{ id: FT, ownerProfileId: OWNER, name: "FT" }],
    selections: [],
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
    await db.query("BEGIN");
    await insSel(db, P1, false, true); // vice-captain
    await insSel(db, P2, false); // plain
    await expect(db.query("COMMIT")).rejects.toThrow(/exactly one captain/);
  });

  it("commits when the vice-captain is inserted BEFORE the captain (order-independent)", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await db.query("BEGIN");
    await insSel(db, P1, false, true); // vice first
    await insSel(db, P2, true); // captain second
    await insSel(db, P3, false); // plain
    await expect(db.query("COMMIT")).resolves.toBeDefined();
  });

  it("rejects a SECOND captain via the existing partial unique index (<= 1 half)", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await insSel(db, P1, true); // first captain — fine on its own
    await expect(insSel(db, P2, true)).rejects.toThrow(/unique|one_captain/i);
  });
});
