import type {
  DerivedH2hResult,
  DerivedLadderRow,
  DerivedTeamRoundScore,
} from "./types.js";

/**
 * LADDER (deferred engine, D11). Wins are primary, points-for is the tiebreak
 * (the ranking itself is a display/query concern — rows are stored keyed by
 * team, not ranked). A BYE counts as a played game and is settled W/L/T against
 * its round median (recovered here from the h2h row's `byeMedian`).
 *
 *   points_for   = Σ the team's OWN round totals over active rounds
 *                  (NOT the home_points column — a team is the away side in some
 *                  fixtures, so summing home_points would drop those rounds)
 *   ladder_points = 2·wins + 1·ties   (structural convention, operator-confirmed)
 *
 * Gate: G9 (ladder + points-for reconcile by hand).
 */

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface LadderInput {
  teamIds: string[];
  teamRoundScores: DerivedTeamRoundScore[];
  h2hResults: DerivedH2hResult[];
}

interface Tally {
  played: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export function computeLadder(input: LadderInput): DerivedLadderRow[] {
  const { teamIds, teamRoundScores, h2hResults } = input;

  const tally = new Map<string, Tally>();
  for (const t of teamIds) {
    tally.set(t, { played: 0, wins: 0, losses: 0, ties: 0, pointsFor: 0 });
  }

  // points_for = Σ own round totals over active rounds.
  for (const tr of teamRoundScores) {
    const t = tally.get(tr.fantasyTeamId);
    if (t) t.pointsFor += tr.total;
  }

  const win = (t: string): void => {
    const x = tally.get(t);
    if (x) (x.played++, x.wins++);
  };
  const loss = (t: string): void => {
    const x = tally.get(t);
    if (x) (x.played++, x.losses++);
  };
  const tie = (t: string): void => {
    const x = tally.get(t);
    if (x) (x.played++, x.ties++);
  };

  for (const r of h2hResults) {
    if (r.awayTeamId === null) {
      // Bye: settle the bye team vs its round median.
      const median = r.byeMedian ?? 0;
      if (r.homePoints > median) win(r.homeTeamId);
      else if (r.homePoints < median) loss(r.homeTeamId);
      else tie(r.homeTeamId);
    } else if (r.outcome === "home") {
      win(r.homeTeamId);
      loss(r.awayTeamId);
    } else if (r.outcome === "away") {
      loss(r.homeTeamId);
      win(r.awayTeamId);
    } else {
      tie(r.homeTeamId);
      tie(r.awayTeamId);
    }
  }

  const out: DerivedLadderRow[] = teamIds.map((t) => {
    const x = tally.get(t)!;
    return {
      fantasyTeamId: t,
      played: x.played,
      wins: x.wins,
      losses: x.losses,
      ties: x.ties,
      pointsFor: x.pointsFor,
      ladderPoints: 2 * x.wins + x.ties,
    };
  });

  // Deterministic emit order = readDerived's ORDER BY fantasy_team_id.
  return out.sort((a, b) => cmp(a.fantasyTeamId, b.fantasyTeamId));
}
