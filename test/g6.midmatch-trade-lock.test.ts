import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import type { RawSeason } from "../src/recompute/types.js";
import { makeTestDb, seedSeason } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";

/**
 * G6 MIDMATCH_TRADE_LOCK (D7) — a player whose match is in progress can be
 * neither bought nor sold, enforced in the DB (0002_locks.sql), both directions.
 * "In a match in progress" = the player is in the named XI (scorecard_lineup) of
 * a match with status 'in_progress'. The round itself is OPEN here (lock_at in the
 * future) so the ROUND lock is not what bites — this isolates the MID-MATCH lock.
 *
 * HAND-WORKED CASES (player PL is in match M's lineup):
 *   status 'in_progress' -> buy REJECTED and sell REJECTED
 *   status 'finalised'   -> buy OK and sell OK        (repriced, tradeable again)
 *   status 'abandoned'   -> buy OK and sell OK        (D19: washout RELEASES the lock)
 * The guard fires ONLY on 'in_progress', so both the finalised and abandoned
 * releases fall out of the same predicate.
 */

const SEASON = "00000000-0000-0000-0000-0000000006a0";
const ROUND = "00000000-0000-0000-0000-0000000006a1";
const MATCH = "00000000-0000-0000-0000-0000000006a2";
const SC = "00000000-0000-0000-0000-0000000006a3";
const OWNER = "00000000-0000-0000-0000-0000000006b0";
const FT = "00000000-0000-0000-0000-0000000006c0";
const PL = "00000000-0000-0000-0000-0000000006d0";

/** One open round, one match (status set per-test), the player in its lineup. */
function buildRaw(status: string): RawSeason {
  return {
    seasonId: SEASON,
    config: FIXTURE_CONFIG,
    players: [
      { id: PL, registryKey: "pl", displayName: "PL", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
    ],
    // Far-future lock so the ROUND lock never fires — only the mid-match lock can.
    rounds: [{ id: ROUND, seq: 1, name: "R", lockAt: "2099-01-01T00:00:00Z" }],
    matches: [
      { id: MATCH, roundId: ROUND, grade: "A", opponent: "Opp", status: status as never, finalDayDate: "2026-10-04", finalisedAt: null },
    ],
    scorecards: [
      { id: SC, matchId: MATCH, wicketKeeperPlayerId: null, reviewState: "committed", lineup: [PL], batting: [], bowling: [], dismissals: [] },
    ],
    fantasyTeams: [{ id: FT, ownerProfileId: OWNER, name: "FT" }],
    selections: [],
    trades: [],
  };
}

let idc = 0;
const buy = (db: DbClient) =>
  db.query("INSERT INTO trades (id, fantasy_team_id, kind, player_id, price, round_id) VALUES ($1,$2,'buy',$3,60000,$4)",
    [`00000000-0000-0000-0000-0000006e${String(idc++).padStart(4, "0")}`, FT, PL, ROUND]);
const sell = (db: DbClient) =>
  db.query("INSERT INTO trades (id, fantasy_team_id, kind, player_id, price, round_id) VALUES ($1,$2,'sell',$3,60000,$4)",
    [`00000000-0000-0000-0000-0000005e${String(idc++).padStart(4, "0")}`, FT, PL, ROUND]);

describe("G6 MIDMATCH_TRADE_LOCK — enforced in the DB, both directions", () => {
  it("rejects BOTH buy and sell while the player's match is in progress", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw("in_progress"));
    await expect(buy(db)).rejects.toThrow(/in progress/);
    await expect(sell(db)).rejects.toThrow(/in progress/);
  });

  it("allows BOTH once the match is finalised (repriced)", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw("in_progress"));
    // While in progress: locked.
    await expect(buy(db)).rejects.toThrow(/in progress/);
    // Finalise -> released.
    await db.query("UPDATE matches SET status = 'finalised', finalised_at = now() WHERE id = $1", [MATCH]);
    await expect(buy(db)).resolves.toBeDefined();
    await expect(sell(db)).resolves.toBeDefined();
  });

  it("allows BOTH once the match is abandoned — washout releases the lock (D19)", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw("in_progress"));
    await expect(sell(db)).rejects.toThrow(/in progress/);
    // Abandon -> released (a match dying between days cannot freeze trading forever).
    await db.query("UPDATE matches SET status = 'abandoned' WHERE id = $1", [MATCH]);
    await expect(buy(db)).resolves.toBeDefined();
    await expect(sell(db)).resolves.toBeDefined();
  });
});
