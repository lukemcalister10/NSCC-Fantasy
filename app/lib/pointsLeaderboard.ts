export interface PointsRow {
  fantasy_team_id: string;
  total_points: number;
  fantasy_teams: { name: string } | null;
}

export interface LeaderboardRound {
  id: string;
  seq: number;
  name: string;
  scorecards_frozen_at: string | null;
  matches: { status: string }[];
}

/** Only settled, published rounds belong in the historical points selector. */
export function completedLeaderboardRounds(rounds: LeaderboardRound[]): LeaderboardRound[] {
  return rounds.filter(round => round.scorecards_frozen_at !== null &&
    round.matches.length > 0 &&
    round.matches.every(match => match.status === "finalised" || match.status === "abandoned"))
    .sort((a, b) => b.seq - a.seq || a.id.localeCompare(b.id));
}

/** Competition ranking: equal totals share a rank; alphabetical order only stabilises ties. */
export function rankPointsLeaderboard(rows: PointsRow[]) {
  const sorted = [...rows].sort((a, b) => b.total_points - a.total_points ||
    (a.fantasy_teams?.name ?? "").localeCompare(b.fantasy_teams?.name ?? "") ||
    a.fantasy_team_id.localeCompare(b.fantasy_team_id));
  let rank = 0;
  return sorted.map((row, index) => {
    if (index === 0 || row.total_points !== sorted[index - 1]!.total_points) rank = index + 1;
    return { ...row, rank };
  });
}

export function selectedLeaderboardRound(rounds: LeaderboardRound[], requestedId: string | null) {
  return rounds.find(round => round.id === requestedId) ?? rounds[0];
}
