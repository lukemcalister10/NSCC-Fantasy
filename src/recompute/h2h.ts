import { generateRound } from "./roundRobin.js";
import type { DerivedH2hResult, DerivedTeamRoundScore } from "./types.js";

/**
 * H2H RESULTS (deferred engine, D11/D18). For each active round it derives the
 * fixtures (repeated round-robin, see roundRobin.ts) and settles each on the
 * teams' round TOTALS (captain-doubled — the single canonical round number that
 * H2H, the bye median, points-for and the overall leaderboard all read).
 *
 * Bye: the byed team is scored against the ROUND MEDIAN — the median over ALL
 * teams' round totals that round, INCLUDING the bye team (operator decision:
 * whole-league "median game"). For odd N (the only case that byes) the median
 * is the true middle element, an integer. The bye team then wins/loses/ties
 * against that median exactly like a normal fixture.
 *
 * Gate: G9 (5-team H2H round, bye vs median, reconciled by hand).
 */

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface H2hInput {
  teamIds: string[];
  /** Active round ids in ascending seq order (drives the round-robin index). */
  activeRoundIdsBySeq: string[];
  teamRoundScores: DerivedTeamRoundScore[];
}

/**
 * Median over ALL teams' totals for the round. Ascending sort; the middle
 * element for odd counts (the byeing case). For even counts (never byes, so
 * never actually consulted for a bye) the lower-middle keeps it an integer.
 */
function roundMedian(totals: number[]): number {
  const sorted = [...totals].sort((a, b) => a - b);
  const mid = Math.floor((sorted.length - 1) / 2);
  return sorted[mid] ?? 0;
}

export function computeH2hResults(input: H2hInput): DerivedH2hResult[] {
  const { teamIds, activeRoundIdsBySeq, teamRoundScores } = input;

  // (roundId,teamId) → total.
  const totalByTeamRound = new Map<string, number>();
  for (const tr of teamRoundScores) {
    totalByTeamRound.set(tr.roundId + "|" + tr.fantasyTeamId, tr.total);
  }
  const totalOf = (roundId: string, teamId: string): number =>
    totalByTeamRound.get(roundId + "|" + teamId) ?? 0;

  const out: DerivedH2hResult[] = [];
  activeRoundIdsBySeq.forEach((roundId, index) => {
    const fixtures = generateRound(teamIds, index);
    const medianThisRound = roundMedian(
      teamIds.map((t) => totalOf(roundId, t)),
    );

    for (const fx of fixtures) {
      const homePoints = totalOf(roundId, fx.home);
      if (fx.away === null) {
        // Bye: the outcome label is 'bye' (the fixture TYPE); the bye team's
        // actual W/L/T is settled by the ladder from homePoints vs byeMedian.
        out.push({
          roundId,
          homeTeamId: fx.home,
          awayTeamId: null,
          homePoints,
          awayPoints: null,
          byeMedian: medianThisRound,
          outcome: "bye",
        });
      } else {
        const awayPoints = totalOf(roundId, fx.away);
        const outcome =
          homePoints > awayPoints
            ? "home"
            : homePoints < awayPoints
              ? "away"
              : "tie";
        out.push({
          roundId,
          homeTeamId: fx.home,
          awayTeamId: fx.away,
          homePoints,
          awayPoints,
          byeMedian: null,
          outcome,
        });
      }
    }
  });

  // Deterministic emit order = the columns readDerived orders by.
  return out.sort(
    (a, b) => cmp(a.roundId, b.roundId) || cmp(a.homeTeamId, b.homeTeamId),
  );
}
