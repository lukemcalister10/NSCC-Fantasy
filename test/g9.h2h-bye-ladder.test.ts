import { describe, expect, it } from "vitest";
import { computeH2hResults } from "../src/recompute/h2h.js";
import { computeLadder } from "../src/recompute/ladder.js";
import { computeOverallLeaderboard } from "../src/recompute/overallLeaderboard.js";
import { generateRound } from "../src/recompute/roundRobin.js";
import type { DerivedTeamRoundScore } from "../src/recompute/types.js";

/**
 * G9 BYE_MEDIAN — 5-team H2H round; bye scored against the round median; ladder
 * and points-for reconciled BY HAND (same worked-arithmetic standard as G11).
 *
 * Five teams (ids sort t1<t2<t3<t4<t5), one round R1. Their round totals
 * (captain-doubled team-round scores — the single canonical number) are fixed
 * by hand below; the H2H/ladder engines settle from them.
 *
 * FIXTURES — repeated round-robin, round index 0 over sorted [t1..t5] (odd → one
 * ghost, so exactly one bye). Circle method yields:
 *     t1 BYE   ·   t2 (home) v t5   ·   t3 (home) v t4
 *
 * ROUND TOTALS:   t1 72   t2 90   t3 55   t4 60   t5 40
 * MEDIAN over ALL five (incl. the bye team, operator decision):
 *     sort [40, 55, 60, 72, 90] → middle (index 2) = 60
 *
 * SETTLE:
 *   t1 bye: 72 vs median 60 → 72 > 60 → WIN
 *   t2 v t5: 90 vs 40       → home (t2) WIN,  t5 LOSS
 *   t3 v t4: 55 vs 60       → away (t4) WIN,  t3 LOSS
 *
 * LADDER (played/W/L/T · points_for = own round total · ladder_points = 2W+T):
 *   t2  1 · 1/0/0 · pf 90 · lp 2
 *   t1  1 · 1/0/0 · pf 72 · lp 2
 *   t4  1 · 1/0/0 · pf 60 · lp 2
 *   t3  1 · 0/1/0 · pf 55 · lp 0
 *   t5  1 · 0/1/0 · pf 40 · lp 0
 * RANK by (wins desc, points_for desc) → t2, t1, t4, t3, t5.
 * OVERALL (Σ round totals) desc → t2 90, t1 72, t4 60, t3 55, t5 40.
 */

const R1 = "round-1";
const TEAMS = ["team-1", "team-2", "team-3", "team-4", "team-5"];
const [t1, t2, t3, t4, t5] = TEAMS as [string, string, string, string, string];

const teamRoundScores: DerivedTeamRoundScore[] = [
  { fantasyTeamId: t1, roundId: R1, total: 72, captainPlayerId: null },
  { fantasyTeamId: t2, roundId: R1, total: 90, captainPlayerId: null },
  { fantasyTeamId: t3, roundId: R1, total: 55, captainPlayerId: null },
  { fantasyTeamId: t4, roundId: R1, total: 60, captainPlayerId: null },
  { fantasyTeamId: t5, roundId: R1, total: 40, captainPlayerId: null },
];

const h2h = computeH2hResults({
  teamIds: TEAMS,
  activeRoundIdsBySeq: [R1],
  teamRoundScores,
});

describe("G9 BYE_MEDIAN — fixtures & bye median", () => {
  it("generates one bye + two pairings via the round-robin", () => {
    const fx = generateRound(TEAMS, 0);
    expect(fx).toEqual([
      { home: t1, away: null }, // t1 bye
      { home: t2, away: t5 },
      { home: t3, away: t4 },
    ]);
  });

  it("scores the bye team against the round median (60), a WIN at 72", () => {
    const bye = h2h.find((r) => r.awayTeamId === null)!;
    expect(bye.homeTeamId).toBe(t1);
    expect(bye.byeMedian).toBe(60);
    expect(bye.homePoints).toBe(72);
    expect(bye.outcome).toBe("bye"); // fixture type; result settled on ladder
  });

  it("settles the two real pairings on totals", () => {
    const p25 = h2h.find((r) => r.homeTeamId === t2)!;
    expect(p25).toMatchObject({ awayTeamId: t5, homePoints: 90, awayPoints: 40, outcome: "home" });
    const p34 = h2h.find((r) => r.homeTeamId === t3)!;
    expect(p34).toMatchObject({ awayTeamId: t4, homePoints: 55, awayPoints: 60, outcome: "away" });
  });
});

describe("G9 BYE_MEDIAN — ladder & overall reconcile by hand", () => {
  const ladder = computeLadder({ teamIds: TEAMS, teamRoundScores, h2hResults: h2h });
  const byTeam = new Map(ladder.map((l) => [l.fantasyTeamId, l]));

  it("each team's W/L/T, points-for and ladder points match the hand table", () => {
    expect(byTeam.get(t1)).toMatchObject({ played: 1, wins: 1, losses: 0, ties: 0, pointsFor: 72, ladderPoints: 2 });
    expect(byTeam.get(t2)).toMatchObject({ played: 1, wins: 1, losses: 0, ties: 0, pointsFor: 90, ladderPoints: 2 });
    expect(byTeam.get(t3)).toMatchObject({ played: 1, wins: 0, losses: 1, ties: 0, pointsFor: 55, ladderPoints: 0 });
    expect(byTeam.get(t4)).toMatchObject({ played: 1, wins: 1, losses: 0, ties: 0, pointsFor: 60, ladderPoints: 2 });
    expect(byTeam.get(t5)).toMatchObject({ played: 1, wins: 0, losses: 1, ties: 0, pointsFor: 40, ladderPoints: 2 - 2 }); // 0
  });

  it("ranks by wins then points-for: t2, t1, t4, t3, t5", () => {
    const ranked = [...ladder].sort(
      (a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor,
    );
    expect(ranked.map((l) => l.fantasyTeamId)).toEqual([t2, t1, t4, t3, t5]);
  });

  it("overall leaderboard ranks by Σ round totals", () => {
    const overall = computeOverallLeaderboard(TEAMS, teamRoundScores);
    const ranked = [...overall].sort((a, b) => b.totalPoints - a.totalPoints);
    expect(ranked).toEqual([
      { fantasyTeamId: t2, totalPoints: 90 },
      { fantasyTeamId: t1, totalPoints: 72 },
      { fantasyTeamId: t4, totalPoints: 60 },
      { fantasyTeamId: t3, totalPoints: 55 },
      { fantasyTeamId: t5, totalPoints: 40 },
    ]);
  });

  it("byes rotate through all five teams over a full round-robin cycle", () => {
    const byes = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const bye = generateRound(TEAMS, i).find((f) => f.away === null);
      if (bye) byes.add(bye.home);
    }
    expect(byes).toEqual(new Set(TEAMS));
  });
});
