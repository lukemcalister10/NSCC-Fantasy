import type { DerivedOverallRow, DerivedTeamRoundScore } from "./types.js";

/**
 * OVERALL LEADERBOARD (deferred engine, D11) — the SEPARATE overall-points
 * competition, distinct from the H2H ladder. total_points = Σ the team's round
 * totals (captain-doubled) over active rounds. Ranking is a display concern;
 * rows are stored keyed by team.
 */

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function computeOverallLeaderboard(
  teamIds: string[],
  teamRoundScores: DerivedTeamRoundScore[],
): DerivedOverallRow[] {
  const totals = new Map<string, number>();
  for (const t of teamIds) totals.set(t, 0);
  for (const tr of teamRoundScores) {
    totals.set(tr.fantasyTeamId, (totals.get(tr.fantasyTeamId) ?? 0) + tr.total);
  }

  return teamIds
    .map((t) => ({ fantasyTeamId: t, totalPoints: totals.get(t) ?? 0 }))
    .sort((a, b) => cmp(a.fantasyTeamId, b.fantasyTeamId));
}
