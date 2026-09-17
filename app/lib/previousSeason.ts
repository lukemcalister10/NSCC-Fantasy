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

function seasonLineOrder(line: PreviousSeasonLine): number {
  const grade = line.grade.toLowerCase();
  const association = line.association.toLowerCase();
  if (grade.includes("3rd")) return 0;
  if (grade.includes("5th") && association.includes("northern")) return 1;
  if (
    grade.includes("5th") &&
    (association.includes("manly") || association.includes("mwca"))
  ) {
    return 2;
  }
  return 3;
}

/** Historical names stay stable even when the shorter customer-facing name changes. */
export function previousSeasonFor(registryKey: string): PreviousSeasonPlayer | null {
  const player = byRegistryName[registryKey];
  if (!player) return null;
  return {
    ...player,
    seasons: [...player.seasons].sort(
      (a, b) =>
        seasonLineOrder(a) - seasonLineOrder(b) ||
        a.grade.localeCompare(b.grade) ||
        a.association.localeCompare(b.association),
    ),
  };
}
