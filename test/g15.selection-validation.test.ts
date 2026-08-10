import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import type { RawSeason } from "../src/recompute/types.js";
import { makeTestDb, seedSeason } from "./helpers/pgliteDb.js";
import type { DbClient } from "../src/db/repository.js";

/**
 * G15 SELECTION_VALIDATION (DoD v1.2 amendment A8) — enforced in the DATABASE
 * (0003_selection_validation.sql), not the UI. Every write below is a DIRECT
 * INSERT against the tables ("the API called directly, bypassing the UI"). Both
 * guards are DEFERRABLE INITIALLY DEFERRED constraint triggers (same family as
 * Rider 1's mandatory captain): the invariant is judged at COMMIT over the
 * completed (team, round) / team row-set. There is NO bypass GUC — G15 is
 * "violations rejected server-side", full stop.
 *
 * FIXTURE_CONFIG: teamSize 6 = BAT>=2 / WK>=1 / BWL>=2 / AR>=1 (flex 0),
 * cap 1,000,000, tradesPerRound 2.
 *
 * HAND-WORKED CASES
 *  Composition (team FT, open round R1, each set carries exactly one captain so
 *  the mandatory-captain guard passes and ONLY the composition guard can speak):
 *   - valid squad {2 BAT,1 WK,2 BWL,1 AR}                 -> COMMITS
 *   - size-1 short {2 BAT,1 WK,2 BWL}      = 5 players    -> rejected /team size/
 *   - minimums short {1 BAT,1 WK,2 BWL,2 AR}= 6, BAT 1<2  -> rejected /role minimum/
 *   - WK via wk_eligible non-WK: {2 BAT,3 BWL(1 wke),1 AR}-> COMMITS  (the spare
 *       BWL is wk_eligible, so a surplus BWL keeps wicket)
 *   - STRICT no-double-count: {2 BAT(1 wke),2 BWL,2 AR,0 WK} -> rejected /WK minimum/
 *       (the wk_eligible BAT is needed to MEET the BAT minimum, so it has no spare
 *       capacity to keep wicket — a naive count(WK OR wk_eligible)>=1 would wrongly
 *       pass this squad; strict counting rejects it.)
 *  Trades (team FT). Since D26 / migration 0010, holdings ARE the selection set,
 *  so every trade transaction must END on a legal squad — the trade cases below
 *  are written as complete builds and as sell+buy PAIRS, which is also what the
 *  UI writes. The tightening itself is pinned in the last describe block.
 *   - initial full-squad build (founding round R1, no prior holdings): 6 buys in
 *       one go COMMIT despite tradesPerRound 2 -> zero trades consumed
 *   - at the limit (non-founding round R2): 2 PAIRS COMMIT
 *   - over the limit (non-founding round R2): 3 PAIRS rejected /trades/
 *   - salary cap: a buy taking net spend over cap rejected /cap/; a founding
 *       build inside the cap COMMITS
 *  Partial-config guard:
 *   - a season config missing squad.teamSize/roleMinimums -> selection rejected
 *       /config missing/ (loud, at validation time — never a silent pass)
 *   - a season config missing squad.cap -> trade rejected /config missing/
 */

const SEASON = "00000000-0000-0000-0000-0000000015a0";
const R1 = "00000000-0000-0000-0000-0000000015a1"; // seq 1
const R2 = "00000000-0000-0000-0000-0000000015a2"; // seq 2
const OWNER = "00000000-0000-0000-0000-0000000015b0";
const FT = "00000000-0000-0000-0000-0000000015c0";

// Player pool spanning every role, incl. one WK-role, one wk_eligible BWL and one
// wk_eligible BAT (for the strict no-double-count case).
const BAT1 = "00000000-0000-0000-0000-0000000015d1";
const BAT2 = "00000000-0000-0000-0000-0000000015d2";
const WK1 = "00000000-0000-0000-0000-0000000015d3";
const BWL1 = "00000000-0000-0000-0000-0000000015d4";
const BWL2 = "00000000-0000-0000-0000-0000000015d5";
const AR1 = "00000000-0000-0000-0000-0000000015d6";
const AR2 = "00000000-0000-0000-0000-0000000015d7";
const BWLE = "00000000-0000-0000-0000-0000000015d8"; // BWL, wk_eligible
const BATE = "00000000-0000-0000-0000-0000000015d9"; // BAT, wk_eligible

function buildRaw(): RawSeason {
  return {
    seasonId: SEASON,
    config: FIXTURE_CONFIG,
    players: [
      { id: BAT1, registryKey: "bat1", displayName: "Bat1", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
      { id: BAT2, registryKey: "bat2", displayName: "Bat2", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
      { id: WK1, registryKey: "wk1", displayName: "Wk1", role: "WK", wkEligible: false, startingPrice: 50_000, active: true },
      { id: BWL1, registryKey: "bwl1", displayName: "Bwl1", role: "BWL", wkEligible: false, startingPrice: 50_000, active: true },
      { id: BWL2, registryKey: "bwl2", displayName: "Bwl2", role: "BWL", wkEligible: false, startingPrice: 50_000, active: true },
      { id: AR1, registryKey: "ar1", displayName: "Ar1", role: "AR", wkEligible: false, startingPrice: 40_000, active: true },
      { id: AR2, registryKey: "ar2", displayName: "Ar2", role: "AR", wkEligible: false, startingPrice: 40_000, active: true },
      { id: BWLE, registryKey: "bwle", displayName: "BwlE", role: "BWL", wkEligible: true, startingPrice: 50_000, active: true },
      { id: BATE, registryKey: "bate", displayName: "BatE", role: "BAT", wkEligible: true, startingPrice: 60_000, active: true },
    ],
    rounds: [
      { id: R1, seq: 1, name: "R1", lockAt: "2099-01-01T00:00:00Z" },
      { id: R2, seq: 2, name: "R2", lockAt: "2099-01-01T00:00:00Z" },
    ],
    matches: [],
    scorecards: [],
    fantasyTeams: [{ id: FT, ownerProfileId: OWNER, name: "FT" }],
    selections: [],
    trades: [],
  };
}

let selc = 0;
const selId = () => `00000000-0000-0000-0000-5e1ec${String(selc++).padStart(7, "0")}`;
let trdc = 0;
const trdId = () => `00000000-0000-0000-0000-77ade${String(trdc++).padStart(7, "0")}`;

type Member = { pid: string; cap?: boolean };

/** Insert a whole selection set for (FT, R1) inside one transaction, then COMMIT.
 *  The deferred composition + mandatory-captain guards fire once, at COMMIT. */
async function commitSet(db: DbClient, members: Member[]): Promise<{ rows: unknown[] }> {
  await db.query("BEGIN");
  for (const m of members) {
    await db.query(
      `INSERT INTO selections (id, fantasy_team_id, round_id, player_id, is_captain, is_vice_captain)
       VALUES ($1,$2,$3,$4,$5,false)`,
      [selId(), FT, R1, m.pid, !!m.cap],
    );
  }
  return db.query("COMMIT");
}

const buy = (db: DbClient, pid: string, roundId: string, price: number) =>
  db.query(
    "INSERT INTO trades (id, fantasy_team_id, kind, player_id, price, round_id) VALUES ($1,$2,'buy',$3,$4,$5)",
    [trdId(), FT, pid, price, roundId],
  );

const sell = (db: DbClient, pid: string, roundId: string, price: number) =>
  db.query(
    "INSERT INTO trades (id, fantasy_team_id, kind, player_id, price, round_id) VALUES ($1,$2,'sell',$3,$4,$5)",
    [trdId(), FT, pid, price, roundId],
  );

/**
 * A legal founding squad {2 BAT, 1 WK, 2 BWL, 1 AR} in the founding round.
 *
 * WHY EVERY TRADE TEST BELOW NOW STARTS FROM A COMPLETE SQUAD (D26 / migration
 * 0010). Selections are materialised from the trades ledger, so a transaction
 * that leaves the team holding anything other than teamSize players now produces
 * an illegal selection set and the COMPOSITION guard refuses it at COMMIT. These
 * tests used to isolate the trade guards with a lone buy; a lone buy is no longer
 * a legal position to end a transaction in.
 *
 * That is the tightening A12 asked for, not a workaround: G15's composition check
 * now fires IN FRONT OF the participant at trade time rather than silently at lock
 * with nobody watching. It is pinned in its own right at the bottom of this file.
 */
async function foundSquad(db: DbClient, price = 9_000): Promise<void> {
  await db.query("BEGIN");
  for (const pid of FOUNDING) await buy(db, pid, R1, price);
  await db.query("COMMIT");
}

const FOUNDING = [BAT1, BAT2, WK1, BWL1, BWL2, AR1];

describe("G15 — selection composition / size / WK, at commit", () => {
  it("a valid squad {2 BAT,1 WK,2 BWL,1 AR} commits", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await expect(
      commitSet(db, [{ pid: BAT1, cap: true }, { pid: BAT2 }, { pid: WK1 }, { pid: BWL1 }, { pid: BWL2 }, { pid: AR1 }]),
    ).resolves.toBeDefined();
  });

  it("a size-short set (5 players) is rejected /team size/", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await expect(
      commitSet(db, [{ pid: BAT1, cap: true }, { pid: BAT2 }, { pid: WK1 }, { pid: BWL1 }, { pid: BWL2 }]),
    ).rejects.toThrow(/team size/);
  });

  it("a minimums-short set (6 players, only 1 BAT) is rejected /role minimum/", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await expect(
      commitSet(db, [{ pid: BAT1, cap: true }, { pid: WK1 }, { pid: BWL1 }, { pid: BWL2 }, { pid: AR1 }, { pid: AR2 }]),
    ).rejects.toThrow(/role minimum/);
  });

  it("WK minimum satisfied via a wk_eligible non-WK (surplus BWL) commits", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    // 2 BAT, 3 BWL (BWLE is the spare, wk_eligible), 1 AR, 0 WK-role.
    await expect(
      commitSet(db, [{ pid: BAT1, cap: true }, { pid: BAT2 }, { pid: BWL1 }, { pid: BWL2 }, { pid: BWLE }, { pid: AR1 }]),
    ).resolves.toBeDefined();
  });

  it("STRICT counting: a wk_eligible player needed for its own role minimum cannot also keep wicket → rejected /WK minimum/", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    // {2 BAT (BATE wk_eligible), 2 BWL, 2 AR, 0 WK}: BATE is one of the two required
    // BATs, so it has no spare capacity to keep; no legal keeper assignment exists.
    await expect(
      commitSet(db, [{ pid: BAT1, cap: true }, { pid: BATE }, { pid: BWL1 }, { pid: BWL2 }, { pid: AR1 }, { pid: AR2 }]),
    ).rejects.toThrow(/WK minimum/);
  });
});

describe("G15 — trade limits and salary cap, at commit", () => {
  it("initial full-squad build (founding round) commits despite tradesPerRound 2 — zero trades consumed", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await db.query("BEGIN");
    for (const pid of [BAT1, BAT2, WK1, BWL1, BWL2, AR1]) await buy(db, pid, R1, 9_000);
    await expect(db.query("COMMIT")).resolves.toBeDefined(); // 6 buys, no prior holdings
  });

  it("trades at the limit (2 buys in a non-founding round) commit", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await foundSquad(db); // founding R1 → establishes prior holdings for R2
    // TWO PAIRS, each one sell + one buy, so the squad stays size 6 and legal:
    // BAT2 → BATE (BAT), AR1 → AR2 (AR). Two buys = two trades consumed.
    await db.query("BEGIN");
    await sell(db, BAT2, R2, 9_000);
    await buy(db, BATE, R2, 9_000);
    await sell(db, AR1, R2, 9_000);
    await buy(db, AR2, R2, 9_000);
    await expect(db.query("COMMIT")).resolves.toBeDefined(); // 2 <= tradesPerRound
  });

  it("trades over the limit (3 buys in a non-founding round) are rejected /trades/", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await foundSquad(db); // founding R1
    // THREE pairs — the squad stays legal (BAT2→BATE, AR1→AR2, BWL2→BWLE), so the
    // composition guard has nothing to say and the TRADE-COUNT guard is
    // unambiguously the one refusing. The /trades/ regex proves which spoke.
    await db.query("BEGIN");
    await sell(db, BAT2, R2, 9_000);
    await buy(db, BATE, R2, 9_000);
    await sell(db, AR1, R2, 9_000);
    await buy(db, AR2, R2, 9_000);
    await sell(db, BWL2, R2, 9_000);
    await buy(db, BWLE, R2, 9_000);
    await expect(db.query("COMMIT")).rejects.toThrow(/trades/); // 3 > tradesPerRound
  });

  it("a buy taking net spend over the cap is rejected /cap/ (even in the founding round)", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await expect(buy(db, BAT1, R1, 1_100_000)).rejects.toThrow(/cap/); // > cap 1,000,000
  });

  it("a founding build within the cap commits", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    // One $900,000 star plus five at $9,000 = $945,000, inside the $1,000,000 cap.
    await db.query("BEGIN");
    await buy(db, BAT1, R1, 900_000);
    for (const pid of FOUNDING.filter((p) => p !== BAT1)) await buy(db, pid, R1, 9_000);
    await expect(db.query("COMMIT")).resolves.toBeDefined();
  });
});

describe("G15 — partial-config guard (fails loudly at validation time)", () => {
  const PSEASON = "00000000-0000-0000-0000-0000000015f0";
  const PROUND = "00000000-0000-0000-0000-0000000015f1";
  const POWNER = "00000000-0000-0000-0000-0000000015f2";
  const PFT = "00000000-0000-0000-0000-0000000015f3";
  const PPLAYER = "00000000-0000-0000-0000-0000000015f4";

  async function seedPartial(db: DbClient, squad: Record<string, unknown>): Promise<void> {
    await db.query("INSERT INTO seasons (id, name, config) VALUES ($1,$2,$3)", [
      PSEASON,
      "partial",
      JSON.stringify({ squad }),
    ]);
    await db.query("INSERT INTO profiles (id, display_name, is_league_manager) VALUES ($1,'o',false)", [POWNER]);
    await db.query(
      "INSERT INTO players (id, season_id, registry_key, display_name, role, wk_eligible, starting_price, active) VALUES ($1,$2,'pp','PP','BAT',false,9000,true)",
      [PPLAYER, PSEASON],
    );
    await db.query("INSERT INTO rounds (id, season_id, seq, name, lock_at) VALUES ($1,$2,1,'PR','2099-01-01T00:00:00Z')", [PROUND, PSEASON]);
    await db.query("INSERT INTO fantasy_teams (id, season_id, owner_profile_id, name) VALUES ($1,$2,$3,'PFT')", [PFT, PSEASON, POWNER]);
  }

  it("a config missing squad.teamSize/roleMinimums rejects a selection /config missing/", async () => {
    const db = await makeTestDb();
    await seedPartial(db, { cap: 1_000_000, tradesPerRound: 2 }); // no teamSize / roleMinimums
    await expect(
      db.query(
        "INSERT INTO selections (id, fantasy_team_id, round_id, player_id, is_captain, is_vice_captain) VALUES ($1,$2,$3,$4,true,false)",
        [selId(), PFT, PROUND, PPLAYER],
      ),
    ).rejects.toThrow(/config missing/);
  });

  it("a config missing squad.cap rejects a trade /config missing/", async () => {
    const db = await makeTestDb();
    await seedPartial(db, { teamSize: 6, roleMinimums: { BAT: 2, WK: 1, BWL: 2, AR: 1 }, tradesPerRound: 2 }); // no cap
    await expect(
      db.query(
        "INSERT INTO trades (id, fantasy_team_id, kind, player_id, price, round_id) VALUES ($1,$2,'buy',$3,9000,$4)",
        [trdId(), PFT, PPLAYER, PROUND],
      ),
    ).rejects.toThrow(/config missing/);
  });
});

/**
 * THE TIGHTENING D26 BROUGHT WITH IT — stated, so it is a property rather than a
 * side effect somebody discovers later.
 *
 * Before migration 0010, selections were written by the client, so a trade that
 * left a team holding five or seven players committed happily and the illegal
 * squad surfaced only when somebody opened /team — or not at all, and then
 * silently at lock. Now holdings ARE the selection set (D26a), so composition is
 * judged on every write that touches the ledger, at the moment the participant
 * makes it. A12 named this the decisive argument for the eager design.
 */
describe("G15 — composition is now judged at TRADE time (D26 / migration 0010)", () => {
  it("refuses a lone buy that would leave a one-player team", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await expect(buy(db, BAT1, R1, 9_000)).rejects.toThrow(/team size/);
  });

  it("refuses a buy that would take a complete squad to seven", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await foundSquad(db);
    await expect(buy(db, BATE, R2, 9_000)).rejects.toThrow(/team size/);
  });

  it("refuses a lone sell that would leave five", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await foundSquad(db);
    await expect(sell(db, BAT2, R2, 9_000)).rejects.toThrow(/team size/);
  });

  it("accepts the paired sell+buy the trade UI actually writes", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await foundSquad(db);
    await db.query("BEGIN");
    await sell(db, BAT2, R2, 9_000);
    await buy(db, BATE, R2, 9_000);
    await expect(db.query("COMMIT")).resolves.toBeDefined();
  });

  it("refuses a PAIR that breaks a role minimum, even though the size is right", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw());
    await foundSquad(db);
    // Selling the only WK for a second AR keeps the size at 6 and breaks WK ≥ 1.
    await db.query("BEGIN");
    await sell(db, WK1, R2, 9_000);
    await buy(db, AR2, R2, 9_000);
    await expect(db.query("COMMIT")).rejects.toThrow(/WK minimum/);
  });
});
