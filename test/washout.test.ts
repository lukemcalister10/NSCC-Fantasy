import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { recomputeSeason } from "../src/recompute/orchestrator.js";
import type { RawSeason } from "../src/recompute/types.js";

/**
 * WASHOUT CONVENTION (operator addition, this slice). An `abandoned` match is a
 * washout: it produces NO score rows and NO price movements (everyone treated as
 * DNP, prices frozen per D2), yet it still marks its round ACTIVE (a round is
 * active if it has >=1 finalised OR abandoned match). A round whose matches are
 * ALL abandoned is therefore active with all-zero totals → every pairing ties
 * and the bye ties against a median of 0.
 */

const SEASON = "season-w";
const R1 = "round-w1";
const M1 = "match-w1";

describe("WASHOUT — an abandoned match yields no scores and no price movement", () => {
  const raw: RawSeason = {
    seasonId: SEASON,
    config: FIXTURE_CONFIG,
    players: [
      { id: "pa", registryKey: "pa", displayName: "PA", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
      { id: "pb", registryKey: "pb", displayName: "PB", role: "BWL", wkEligible: false, startingPrice: 50_000, active: true },
    ],
    rounds: [{ id: R1, seq: 1, name: "R1", lockAt: "2026-10-01T00:30:00Z" }],
    // Abandoned — even WITH a scorecard present, it must not be scored.
    matches: [
      { id: M1, roundId: R1, grade: "A", opponent: "Opp", status: "abandoned", finalDayDate: "2026-10-04", finalisedAt: null },
    ],
    scorecards: [
      {
        id: "sc-w1", matchId: M1, wicketKeeperPlayerId: null, reviewState: "committed",
        lineup: ["pa", "pb"],
        batting: [{ playerId: "pa", runs: 80, ballsFaced: 40, fours: 8, sixes: 2 }],
        bowling: [{ playerId: "pb", overs: 4, runsConceded: 10, wickets: 3 }],
        dismissals: [],
      },
    ],
    fantasyTeams: [],
    selections: [],
    trades: [],
  };

  const derived = recomputeSeason(raw);

  it("scores no player for the abandoned match", () => {
    expect(derived.playerMatchScores).toEqual([]);
  });

  it("freezes prices: only the starting seed, no movement row (D2)", () => {
    // Two players → two seed rows (seq 0), and nothing else.
    expect(derived.priceHistory).toEqual([
      { playerId: "pa", matchId: null, seq: 0, price: 60_000 },
      { playerId: "pb", matchId: null, seq: 0, price: 50_000 },
    ]);
  });
});

describe("WASHOUT — an all-abandoned round is active with all-zero totals", () => {
  const [wt1, wt2, wt3] = ["team-1", "team-2", "team-3"];
  const raw: RawSeason = {
    seasonId: SEASON,
    config: FIXTURE_CONFIG,
    players: [
      { id: "pa", registryKey: "pa", displayName: "PA", role: "BAT", wkEligible: false, startingPrice: 60_000, active: true },
      { id: "pb", registryKey: "pb", displayName: "PB", role: "BWL", wkEligible: false, startingPrice: 50_000, active: true },
      { id: "pc", registryKey: "pc", displayName: "PC", role: "AR", wkEligible: false, startingPrice: 40_000, active: true },
    ],
    rounds: [{ id: R1, seq: 1, name: "R1", lockAt: "2026-10-01T00:30:00Z" }],
    matches: [
      { id: M1, roundId: R1, grade: "A", opponent: "Opp", status: "abandoned", finalDayDate: "2026-10-04", finalisedAt: null },
    ],
    scorecards: [],
    fantasyTeams: [
      { id: wt1, ownerProfileId: "o1", name: "W1" },
      { id: wt2, ownerProfileId: "o2", name: "W2" },
      { id: wt3, ownerProfileId: "o3", name: "W3" },
    ],
    selections: [
      { id: "x1", fantasyTeamId: wt1, roundId: R1, playerId: "pa", isCaptain: true, isViceCaptain: false },
      { id: "x2", fantasyTeamId: wt2, roundId: R1, playerId: "pb", isCaptain: true, isViceCaptain: false },
      { id: "x3", fantasyTeamId: wt3, roundId: R1, playerId: "pc", isCaptain: true, isViceCaptain: false },
    ],
    trades: [],
  };

  const derived = recomputeSeason(raw);

  it("marks the round active with every team scoring 0 (captains DNP → no double)", () => {
    expect(derived.teamRoundScores).toEqual([
      { fantasyTeamId: wt1, roundId: R1, total: 0, captainPlayerId: null },
      { fantasyTeamId: wt2, roundId: R1, total: 0, captainPlayerId: null },
      { fantasyTeamId: wt3, roundId: R1, total: 0, captainPlayerId: null },
    ]);
  });

  it("ties every pairing and ties the bye against a median of 0", () => {
    // 3 teams, round index 0: wt1 bye, wt2 v wt3. All totals 0 → median 0.
    const bye = derived.h2hResults.find((r) => r.awayTeamId === null)!;
    expect(bye).toMatchObject({ homeTeamId: wt1, byeMedian: 0, homePoints: 0, outcome: "bye" });
    const pair = derived.h2hResults.find((r) => r.awayTeamId !== null)!;
    expect(pair).toMatchObject({ homeTeamId: wt2, awayTeamId: wt3, homePoints: 0, awayPoints: 0, outcome: "tie" });
  });

  it("gives every team a tie on the ladder (played 1, ties 1, ladder_points 1)", () => {
    for (const l of derived.ladder) {
      expect(l).toMatchObject({ played: 1, wins: 0, losses: 0, ties: 1, pointsFor: 0, ladderPoints: 1 });
    }
  });
});
