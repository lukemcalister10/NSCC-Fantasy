import type { RoundBasic } from "./teamQueries";

/** Most recent settled round, not the current (possibly locked but unfinished) one. */
export function lastCompletedRoundOf(rounds: RoundBasic[] | undefined): RoundBasic | null {
  return [...(rounds ?? [])]
    .filter((round) => round.matches.length > 0 && round.matches.every((match) =>
      match.status === "finalised" || match.status === "abandoned"))
    .sort((a, b) => b.seq - a.seq)[0] ?? null;
}
