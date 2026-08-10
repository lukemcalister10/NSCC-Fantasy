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
 * THE FIXTURE INDEX IS A PROPERTY OF THE ROUND (D29). It is `seq − 1` — the
 * round's own number — and NEVER the round's position among ACTIVE rounds, which
 * is what this function used to receive. The difference is not cosmetic: under
 * the positional rule an empty round that later acquires its first match shifts
 * every later round's index by one and retroactively rewrites who played whom in
 * rounds already settled. D19 makes it reachable (a round with no entered matches
 * does not exist for H2H), and the operator has explicitly ruled out results
 * changing with hindsight (D24, same principle, different door). With seq − 1 a
 * round's fixture is knowable before it is played, publishable in advance, and
 * immune to what happens in any other round — which is what D21's determinism
 * means. It also agrees with app/lib/queries.ts, which always used seq − 1, and
 * with generateRound's own contract ("roundIndex is 0-based (round seq − 1)").
 *
 * Gate: G9 (5-team H2H round, bye vs median, reconciled by hand). G9's single
 * round is seq 1 → index 0, unchanged either way, so the gate stays green
 * BYTE-IDENTICALLY across this change.
 */

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** An active round, carrying its own sequence number (D29). */
export interface H2hRound {
  id: string;
  /** The round's number in the season, 1-based. Fixture index is seq − 1. */
  seq: number;
}

export interface H2hInput {
  teamIds: string[];
  /** Active rounds in ascending seq order, each carrying its own seq (D29). */
  activeRounds: H2hRound[];
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
  const { teamIds, activeRounds, teamRoundScores } = input;

  // (roundId,teamId) → total.
  const totalByTeamRound = new Map<string, number>();
  for (const tr of teamRoundScores) {
    totalByTeamRound.set(tr.roundId + "|" + tr.fantasyTeamId, tr.total);
  }
  const totalOf = (roundId: string, teamId: string): number =>
    totalByTeamRound.get(roundId + "|" + teamId) ?? 0;

  const out: DerivedH2hResult[] = [];
  for (const { id: roundId, seq } of activeRounds) {
    // D29: the round's own number decides its fixture, not its position here.
    const fixtures = generateRound(teamIds, seq - 1);
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
  }

  // Deterministic emit order = the columns readDerived orders by.
  return out.sort(
    (a, b) => cmp(a.roundId, b.roundId) || cmp(a.homeTeamId, b.homeTeamId),
  );
}
