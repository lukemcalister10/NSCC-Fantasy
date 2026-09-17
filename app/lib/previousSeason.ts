import history from "../data/previousSeason2526.json";

export interface PreviousSeasonLine {
  season: string;
  teamName: string;
  grade: string;
  association: string;
  matches: number;
  innings: number;
  notOuts: number;
  runs: number;
  highScore: number;
  battingAverage: number | null;
  strikeRate: number | null;
  overs: string | null;
  wickets: number;
  bestBowling: string | null;
  bowlingAverage: number | null;
  economy: number | null;
  catches: number;
  stumpings: number;
}

interface PreviousSeasonPlayer {
  clubPlayerId: string;
  clubName: string;
  seasons: PreviousSeasonLine[];
}

const byRegistryName = history as Record<string, PreviousSeasonPlayer>;

/** Historical names stay stable even when the shorter customer-facing name changes. */
export function previousSeasonFor(registryKey: string): PreviousSeasonPlayer | null {
  return byRegistryName[registryKey] ?? null;
}
