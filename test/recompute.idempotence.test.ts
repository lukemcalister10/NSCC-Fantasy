import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { recomputeSeason } from "../src/recompute/orchestrator.js";
import type { RawSeason } from "../src/recompute/types.js";
import {
  loadRawSeason,
  readDerived,
  writeDerived,
} from "../src/db/repository.js";
import { makeTestDb, seedSeason } from "./helpers/pgliteDb.js";

/**
 * G3 RECOMPUTE_IDEMPOTENCE (PARTIAL: scores / prices / cap; H2H + ladder are the
 * deferred full-chain slice). Enter a scorecard with a deliberate error, compute,
 * correct it, recompute → derived state byte-identical to the correct-first-time
 * path, with no orphaned derived rows.
 */

const SEASON = "00000000-0000-0000-0000-000000000001";
const R1 = "00000000-0000-0000-0000-0000000000a1";
const M1 = "00000000-0000-0000-0000-0000000000b1";
const SC1 = "00000000-0000-0000-0000-0000000000c1";
const A = "00000000-0000-0000-0000-0000000000a0";
const B = "00000000-0000-0000-0000-0000000000b0";
const X = "00000000-0000-0000-0000-0000000000e0"; // the erroneously-added extra
const FT1 = "00000000-0000-0000-0000-0000000000f1";
const OWNER = "00000000-0000-0000-0000-00000000000f";
const T1 = "00000000-0000-0000-0000-0000000000d1";
const T2 = "00000000-0000-0000-0000-0000000000d2";

/**
 * @param withExtra when true, player X is (wrongly) added to the lineup + batting
 *   — the deliberate error. The correction removes X.
 */
function buildRaw(withExtra: boolean): RawSeason {
  const lineup = withExtra ? [A, B, X] : [A, B];
  const batting = [
    { playerId: A, runs: 100, ballsFaced: 100, fours: 0, sixes: 0 },
    ...(withExtra
      ? [{ playerId: X, runs: 20, ballsFaced: 20, fours: 0, sixes: 0 }]
      : []),
  ];
  return {
    seasonId: SEASON,
    config: FIXTURE_CONFIG,
    players: [
      { id: A, registryKey: A, displayName: "A", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
      { id: B, registryKey: B, displayName: "B", role: "BWL", wkEligible: false, startingPrice: 50_000, active: true },
      { id: X, registryKey: X, displayName: "X", role: "BAT", wkEligible: false, startingPrice: 30_000, active: true },
    ],
    rounds: [{ id: R1, seq: 1, name: "R1", lockAt: "2026-10-01T00:30:00Z" }],
    matches: [
      {
        id: M1,
        roundId: R1,
        grade: "A",
        opponent: "Opp",
        status: "finalised",
        finalDayDate: "2026-10-04",
        finalisedAt: "2026-10-04T06:00:00Z",
      },
    ],
    scorecards: [
      {
        id: SC1,
        matchId: M1,
        wicketKeeperPlayerId: null,
        reviewState: "committed",
        lineup,
        batting,
        bowling: [{ playerId: B, overs: 4, runsConceded: 20, wickets: 2 }],
        dismissals: ["c " + A + " b " + B], // A takes an outfield catch
      },
    ],
    fantasyTeams: [{ id: FT1, ownerProfileId: OWNER, name: "Team 1" }],
    selections: [],
    // Round-1 trades at price-entering-round-1 = starting price (Rider 2 holds).
    trades: [
      { id: T1, fantasyTeamId: FT1, kind: "buy", playerId: A, price: 60_000, roundId: R1, createdAt: "2026-09-30T00:00:00Z" },
      { id: T2, fantasyTeamId: FT1, kind: "buy", playerId: B, price: 50_000, roundId: R1, createdAt: "2026-09-30T00:01:00Z" },
    ],
  };
}

describe("G3 RECOMPUTE_IDEMPOTENCE (partial) — object level", () => {
  it("recompute is a pure function of raw truth (byte-identical on re-run)", () => {
    const correct = buildRaw(false);
    expect(recomputeSeason(correct)).toEqual(recomputeSeason(correct));
  });

  it("correcting the error reproduces the correct-first-time derived state", () => {
    const errored = recomputeSeason(buildRaw(true));
    const correctFirstTime = recomputeSeason(buildRaw(false));
    // The error is visible before correction...
    expect(errored).not.toEqual(correctFirstTime);
    // ...and correcting-then-recomputing lands exactly on the first-time path.
    const corrected = recomputeSeason(buildRaw(false));
    expect(corrected).toEqual(correctFirstTime);
    // The extra player's derived rows do not exist in the corrected state.
    expect(corrected.playerMatchScores.some((s) => s.playerId === X)).toBe(false);
  });

  it("throws loudly when a trade price disagrees with the derived price (Rider 2)", () => {
    const raw = buildRaw(false);
    raw.trades[0]!.price = 61_000; // A's real price entering R1 is its seed, 60,000
    expect(() => recomputeSeason(raw)).toThrow(/price-integrity/);
  });
});

describe("G3 RECOMPUTE_IDEMPOTENCE (partial) — pglite persistence", () => {
  it("DB round-trips derived state identical to the recompute output", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw(false));
    const derived = recomputeSeason(await loadRawSeason(db, SEASON));
    await writeDerived(db, SEASON, derived);
    expect(await readDerived(db, SEASON)).toEqual(derived);
  });

  it("recompute replaces derived rows with no orphans after a correction", async () => {
    const db = await makeTestDb();
    // 1. Seed the errored scorecard, recompute, persist.
    await seedSeason(db, buildRaw(true));
    await writeDerived(db, SEASON, recomputeSeason(await loadRawSeason(db, SEASON)));
    // The extra player has a seed + a movement row (2) from the errored run.
    const before = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM price_history WHERE player_id = $1",
      [X],
    );
    expect(Number(before.rows[0]!.n)).toBe(2);

    // 2. Correct the scorecard in place (remove X from lineup + batting).
    await db.query("DELETE FROM scorecard_lineup WHERE scorecard_id = $1 AND player_id = $2", [SC1, X]);
    await db.query("DELETE FROM batting_lines WHERE scorecard_id = $1 AND player_id = $2", [SC1, X]);

    // 3. Recompute from corrected truth and persist.
    const corrected = recomputeSeason(await loadRawSeason(db, SEASON));
    await writeDerived(db, SEASON, corrected);

    // 4. DB matches the correct-first-time path, and X's orphaned movement is gone.
    expect(await readDerived(db, SEASON)).toEqual(recomputeSeason(buildRaw(false)));
    const after = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM price_history WHERE player_id = $1",
      [X],
    );
    expect(Number(after.rows[0]!.n)).toBe(1); // only the seed remains
    const scores = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM player_match_scores WHERE player_id = $1",
      [X],
    );
    expect(Number(scores.rows[0]!.n)).toBe(0); // no orphaned score row
  });
});
