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
 * G3 RECOMPUTE_IDEMPOTENCE (FULL CHAIN). Enter a scorecard with a deliberate
 * error, compute, correct it, recompute → ALL derived state (scores, prices,
 * cap, team-round scores, H2H, ladder, overall leaderboard) byte-identical to
 * the correct-first-time path, with no orphaned derived rows.
 *
 * Two fantasy teams with selections make the whole chain non-empty and let the
 * error CASCADE: FT2 selects the erroneously-added player X, so X's presence
 * changes FT2's round total → its H2H points → its ladder/overall standings.
 */

const SEASON = "00000000-0000-0000-0000-000000000001";
const R1 = "00000000-0000-0000-0000-0000000000a1";
const M1 = "00000000-0000-0000-0000-0000000000b1";
const SC1 = "00000000-0000-0000-0000-0000000000c1";
const A = "00000000-0000-0000-0000-0000000000a0";
const B = "00000000-0000-0000-0000-0000000000b0";
const X = "00000000-0000-0000-0000-0000000000e0"; // the erroneously-added extra
const FT1 = "00000000-0000-0000-0000-0000000000f1";
const FT2 = "00000000-0000-0000-0000-0000000000f2";
const OWNER = "00000000-0000-0000-0000-00000000000f";
const OWNER2 = "00000000-0000-0000-0000-0000000000ef";
const T1 = "00000000-0000-0000-0000-0000000000d1";
const T2 = "00000000-0000-0000-0000-0000000000d2";
const SEL1 = "00000000-0000-0000-0000-000000000101";
const SEL2 = "00000000-0000-0000-0000-000000000102";
const SEL3 = "00000000-0000-0000-0000-000000000103";
const SEL4 = "00000000-0000-0000-0000-000000000104";
const SEL5 = "00000000-0000-0000-0000-000000000105";
// G15 (v1.2): both teams' selection sets must now be legal fixture squads
// (size 6 = 2 BAT/1 WK/2 BWL/1 AR). Each team is padded up to 6 with players who
// are NEVER in M1's lineup — they are DNP (no player_match_score row → contribute
// 0), so every hand-worked total below is UNCHANGED (inputs expanded, zero
// expected-value change). The padding players are untraded, exactly as FT2's
// existing A/B/X selections are (selection != ownership in this scaffold).
const PAD_BAT = "00000000-0000-0000-0000-0000000000aa";
const PAD_WK = "00000000-0000-0000-0000-0000000000ab";
const PAD_BWL = "00000000-0000-0000-0000-0000000000ac";
const PAD_AR = "00000000-0000-0000-0000-0000000000ad";
const SEL6 = "00000000-0000-0000-0000-000000000106";
const SEL7 = "00000000-0000-0000-0000-000000000107";
const SEL8 = "00000000-0000-0000-0000-000000000108";
const SEL9 = "00000000-0000-0000-0000-000000000109";
const SEL10 = "00000000-0000-0000-0000-00000000010a";
const SEL11 = "00000000-0000-0000-0000-00000000010b";
const SEL12 = "00000000-0000-0000-0000-00000000010c";

/**
 * @param withExtra when true, player X is (wrongly) added to the lineup + batting
 *   — the deliberate error. The correction removes X.
 *
 * Base scores (FIXTURE_CONFIG): A = 100 runs + 1 outfield catch·8 = 108; B = 2
 * wkt·25 = 50; X = 20 runs = 20 (only when withExtra). Selections (same either
 * way): FT1 = A(C)+B(VC); FT2 = B(C)+A(VC)+X. So:
 *   FT1 total = A108 + B50 + captain A doubled 108           = 266  (both paths)
 *   FT2 total = B50 + A108 + X(20|0) + captain B doubled 50
 *             = 228 with the error, 208 corrected  ← the cascade
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
      // DNP padding so each fantasy team is a legal G15 squad; never in M1's lineup.
      { id: PAD_BAT, registryKey: PAD_BAT, displayName: "PadBat", role: "BAT", wkEligible: false, startingPrice: 9_000, active: true },
      { id: PAD_WK, registryKey: PAD_WK, displayName: "PadWk", role: "WK", wkEligible: false, startingPrice: 9_000, active: true },
      { id: PAD_BWL, registryKey: PAD_BWL, displayName: "PadBwl", role: "BWL", wkEligible: false, startingPrice: 9_000, active: true },
      { id: PAD_AR, registryKey: PAD_AR, displayName: "PadAr", role: "AR", wkEligible: false, startingPrice: 9_000, active: true },
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
    fantasyTeams: [
      { id: FT1, ownerProfileId: OWNER, name: "Team 1" },
      { id: FT2, ownerProfileId: OWNER2, name: "Team 2" },
    ],
    selections: [
      // FT1 = A(C) + B(VC) + DNP padding → 2 BAT / 1 WK / 2 BWL / 1 AR = legal squad.
      { id: SEL1, fantasyTeamId: FT1, roundId: R1, playerId: A, isCaptain: true, isViceCaptain: false },
      { id: SEL2, fantasyTeamId: FT1, roundId: R1, playerId: B, isCaptain: false, isViceCaptain: true },
      { id: SEL6, fantasyTeamId: FT1, roundId: R1, playerId: PAD_BAT, isCaptain: false, isViceCaptain: false },
      { id: SEL7, fantasyTeamId: FT1, roundId: R1, playerId: PAD_WK, isCaptain: false, isViceCaptain: false },
      { id: SEL8, fantasyTeamId: FT1, roundId: R1, playerId: PAD_BWL, isCaptain: false, isViceCaptain: false },
      { id: SEL9, fantasyTeamId: FT1, roundId: R1, playerId: PAD_AR, isCaptain: false, isViceCaptain: false },
      // FT2 = B(C) + A(VC) + X + DNP padding → 2 BAT(A,X) / 1 WK / 2 BWL / 1 AR.
      { id: SEL3, fantasyTeamId: FT2, roundId: R1, playerId: B, isCaptain: true, isViceCaptain: false },
      { id: SEL4, fantasyTeamId: FT2, roundId: R1, playerId: A, isCaptain: false, isViceCaptain: true },
      { id: SEL5, fantasyTeamId: FT2, roundId: R1, playerId: X, isCaptain: false, isViceCaptain: false },
      { id: SEL10, fantasyTeamId: FT2, roundId: R1, playerId: PAD_WK, isCaptain: false, isViceCaptain: false },
      { id: SEL11, fantasyTeamId: FT2, roundId: R1, playerId: PAD_BWL, isCaptain: false, isViceCaptain: false },
      { id: SEL12, fantasyTeamId: FT2, roundId: R1, playerId: PAD_AR, isCaptain: false, isViceCaptain: false },
    ],
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

describe("G3 RECOMPUTE_IDEMPOTENCE — full chain cascades and reconciles", () => {
  it("derives team-round scores, H2H, ladder and overall from the corrected truth", () => {
    const d = recomputeSeason(buildRaw(false));

    // Team-round totals (captaincy at this layer): FT1 266, FT2 208.
    expect(d.teamRoundScores).toEqual([
      { fantasyTeamId: FT1, roundId: R1, total: 266, captainPlayerId: A },
      { fantasyTeamId: FT2, roundId: R1, total: 208, captainPlayerId: B },
    ]);

    // Two teams → one H2H fixture (FT1 sorts first → home). 266 > 208 → FT1 win.
    expect(d.h2hResults).toEqual([
      { roundId: R1, homeTeamId: FT1, awayTeamId: FT2, homePoints: 266, awayPoints: 208, byeMedian: null, outcome: "home" },
    ]);

    // Ladder: FT1 1 win (pf 266), FT2 1 loss (pf 208).
    expect(d.ladder).toEqual([
      { fantasyTeamId: FT1, played: 1, wins: 1, losses: 0, ties: 0, pointsFor: 266, ladderPoints: 2 },
      { fantasyTeamId: FT2, played: 1, wins: 0, losses: 1, ties: 0, pointsFor: 208, ladderPoints: 0 },
    ]);

    expect(d.overallLeaderboard).toEqual([
      { fantasyTeamId: FT1, totalPoints: 266 },
      { fantasyTeamId: FT2, totalPoints: 208 },
    ]);
  });

  it("the scorecard error visibly moves FT2 down the chain (228 → 208), then reconciles", () => {
    const errored = recomputeSeason(buildRaw(true));
    const corrected = recomputeSeason(buildRaw(false));
    const ft2Total = (d: typeof errored) =>
      d.teamRoundScores.find((t) => t.fantasyTeamId === FT2)!.total;
    // X's phantom 20 inflates FT2 before correction...
    expect(ft2Total(errored)).toBe(228);
    // ...and correcting-then-recomputing lands on the correct-first-time chain.
    expect(ft2Total(corrected)).toBe(208);
    expect(corrected).toEqual(recomputeSeason(buildRaw(false)));
  });
});

describe("G3 RECOMPUTE_IDEMPOTENCE (full chain) — pglite persistence", () => {
  it("DB round-trips derived state identical to the recompute output", async () => {
    const db = await makeTestDb();
    await seedSeason(db, buildRaw(false));
    const derived = recomputeSeason(await loadRawSeason(db, SEASON));
    await writeDerived(db, SEASON, derived);
    // Round-trip covers every family incl. team-round/H2H/ladder/overall.
    expect(await readDerived(db, SEASON)).toEqual(derived);
    expect(derived.h2hResults.length).toBe(1);
    expect(derived.ladder.length).toBe(2);
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

    // The full-chain tables are rebuilt wholesale — no orphans from the errored
    // run survive (one H2H fixture + two ladder rows for the two teams, one round).
    const h2h = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM h2h_results WHERE round_id = $1",
      [R1],
    );
    expect(Number(h2h.rows[0]!.n)).toBe(1);
    const ladder = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM ladder WHERE season_id = $1",
      [SEASON],
    );
    expect(Number(ladder.rows[0]!.n)).toBe(2);
  });
});
