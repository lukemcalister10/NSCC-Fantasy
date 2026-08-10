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
// A legal squad around PL, plus the spare each trade PAIR swaps against. Since
// D26 / migration 0010 the ledger materialises into the selection set, so a trade
// has to leave the team on a legal squad — a lone buy or sell no longer commits
// (pinned in test/g15). Trading in pairs is what the UI does anyway, and it keeps
// the MID-MATCH lock the only guard that can speak here.
const SPARE = "00000000-0000-0000-0000-0000000006d1"; // BAT — swaps with PL
const BAT2 = "00000000-0000-0000-0000-0000000006d2";
const WK1 = "00000000-0000-0000-0000-0000000006d3";
const BWL1 = "00000000-0000-0000-0000-0000000006d4";
const BWL2 = "00000000-0000-0000-0000-0000000006d5";
const AR1 = "00000000-0000-0000-0000-0000000006d6";

/** The founding squad, which deliberately does NOT hold PL: the "buy PL" cases
 *  swap the spare out for him, the "sell PL" cases swap him back. */
const FOUNDING = [SPARE, BAT2, WK1, BWL1, BWL2, AR1];

/** One open round, one match (status set per-test), the player in its lineup. */
function buildRaw(status: string): RawSeason {
  return {
    seasonId: SEASON,
    config: FIXTURE_CONFIG,
    players: [
      { id: PL, registryKey: "pl", displayName: "PL", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
      { id: SPARE, registryKey: "spare", displayName: "Spare", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
      { id: BAT2, registryKey: "bat2", displayName: "Bat2", role: "BAT", wkEligible: false, startingPrice: 50_000, active: true },
      { id: WK1, registryKey: "wk1", displayName: "Wk1", role: "WK", wkEligible: false, startingPrice: 50_000, active: true },
      { id: BWL1, registryKey: "bwl1", displayName: "Bwl1", role: "BWL", wkEligible: false, startingPrice: 50_000, active: true },
      { id: BWL2, registryKey: "bwl2", displayName: "Bwl2", role: "BWL", wkEligible: false, startingPrice: 50_000, active: true },
      { id: AR1, registryKey: "ar1", displayName: "Ar1", role: "AR", wkEligible: false, startingPrice: 40_000, active: true },
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
const trdId = () => `00000000-0000-0000-0000-0000006e${String(idc++).padStart(4, "0")}`;

const trade = (db: DbClient, kind: "buy" | "sell", pid: string) =>
  db.query(
    "INSERT INTO trades (id, fantasy_team_id, kind, player_id, price, round_id) VALUES ($1,$2,$3,$4,60000,$5)",
    [trdId(), FT, kind, pid, ROUND],
  );

/** The founding build: six buys in one transaction, no PL. */
async function found(db: DbClient): Promise<void> {
  await db.query("BEGIN");
  for (const pid of FOUNDING) await trade(db, "buy", pid);
  await db.query("COMMIT");
}

/** One trade PAIR — sell `out`, buy `in` — as one transaction, the way
 *  executeTradePair writes it. Rejections surface as the COMMIT (or the insert
 *  itself, for immediate BEFORE-trigger guards like the mid-match lock). */
async function pair(db: DbClient, out: string, into: string): Promise<unknown> {
  await db.query("BEGIN");
  try {
    await trade(db, "sell", out);
    await trade(db, "buy", into);
    return await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

/** Buy PL (swapping the spare out) and sell PL (swapping the spare back). */
const buy = (db: DbClient) => pair(db, SPARE, PL);
const sell = (db: DbClient) => pair(db, PL, SPARE);

describe("G6 MIDMATCH_TRADE_LOCK — enforced in the DB, both directions", () => {
  it("rejects BOTH buy and sell while the player's match is in progress", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw("in_progress"));
    await found(db);
    await expect(buy(db)).rejects.toThrow(/in progress/);
    await expect(sell(db)).rejects.toThrow(/in progress/);
  });

  it("allows BOTH once the match is finalised (repriced)", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw("in_progress"));
    await found(db);
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
    await found(db);
    await expect(sell(db)).rejects.toThrow(/in progress/);
    // Abandon -> released (a match dying between days cannot freeze trading forever).
    await db.query("UPDATE matches SET status = 'abandoned' WHERE id = $1", [MATCH]);
    await expect(buy(db)).resolves.toBeDefined();
    await expect(sell(db)).resolves.toBeDefined();
  });
});
