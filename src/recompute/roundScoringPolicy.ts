/**
 * Mid-season rule adopted for NSCC Fantasy 2026/27. Keep this keyed to the
 * actual season and round sequence: recompute rebuilds every historical round,
 * and Round 1 must always retain its original nine-player total.
 */
export const NSCC_2026_27_SEASON_ID = "edd67f68-d2a1-45f5-98ff-e8c718d1562b";

export function countedPlayersForRound(
  seasonId: string,
  roundSeq: number,
): number | undefined {
  return seasonId === NSCC_2026_27_SEASON_ID && roundSeq >= 2 ? 8 : undefined;
}
