/** Never expose an open round's selections in a public matchup preview. */
export function latestLockedSquadRound<T extends { seq: number; lock_at: string }>(
  rounds: T[], targetSeq: number, now: number = Date.now(),
): T | undefined {
  return rounds
    .filter((round) => round.seq <= targetSeq && new Date(round.lock_at).getTime() <= now)
    .sort((a, b) => b.seq - a.seq)[0];
}
