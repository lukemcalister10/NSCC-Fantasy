import type {
  DerivedPlayerMatchScore,
  DerivedTeamRoundScore,
  RawSelection,
} from "./types.js";

/**
 * TEAM-ROUND SCORING (deferred engine; composes the per-player `base` from
 * scoreMatch — no scoring logic here). This is where CAPTAINCY lives now
 * (D10), NOT in scoreMatch: the ×2 is driven by the fantasy team's own
 * `selections.is_captain / is_vice_captain`, never by any scorecard captain
 * field. `base` (pre-captaincy) still drives pricing (D1/G7) untouched.
 *
 *   team round total = Σ counted individual round-bases
 *                      + effective-captain's round-base
 * Round 1 (and other seasons) counts all selected players. From Round 2 of
 * NSCC Fantasy 2026/27, only the best eight individual scores count. The
 * captain bonus is independent of that ranking, even when negative.
 *
 * where round-base = Σ `base` over the round's matches the player has a score
 * row in. Effective captain (D10): the is_captain selection IF that player
 * has any score row this round, else the is_vice_captain selection if it does,
 * else none (both DNP → no double). "DNP" = NO score row at all for the round
 * (scoreMatch always emits played=true for a lineup player, so absence-of-row —
 * not a played flag — is what models a captain who did not play).
 *
 * Gate: G8 (re-verified at the team-round layer).
 */

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface TeamRoundInput {
  teamIds: string[];
  /** Active rounds only (>=1 finalised OR abandoned match), in any order. */
  roundIds: string[];
  /** Selections for the season (any team/round). */
  selections: RawSelection[];
  /** Every derived per-player match score. */
  playerMatchScores: DerivedPlayerMatchScore[];
  /** match_id → round_id, for mapping scores into rounds. */
  roundIdByMatch: Map<string, string>;
  /** Rounds using best-N individual scores. Omitted rounds retain all scores. */
  countedPlayersByRound?: Map<string, number>;
}

export interface TeamRoundPlayerContribution {
  playerId: string;
  base: number;
  played: boolean;
  isCaptain: boolean;
  isViceCaptain: boolean;
}

/** Shared arithmetic for recompute and the eventual fixture score breakdown. */
export function scoreTeamRound(
  players: TeamRoundPlayerContribution[],
  countedPlayers: number | undefined,
): { total: number; captainPlayerId: string | null; droppedPlayerIds: string[] } {
  const ranked = [...players].sort((a, b) =>
    b.base - a.base || Number(b.played) - Number(a.played) || cmp(a.playerId, b.playerId));
  const limit = countedPlayers === undefined ? ranked.length : Math.max(0, countedPlayers);
  const counted = ranked.slice(0, limit);
  const droppedPlayerIds = ranked.slice(limit).map((player) => player.playerId);
  const captain = players.find((player) => player.isCaptain);
  const vice = players.find((player) => player.isViceCaptain);
  const effectiveCaptain = captain?.played ? captain : vice?.played ? vice : null;
  return {
    total: counted.reduce((sum, player) => sum + player.base, 0) +
      (effectiveCaptain?.base ?? 0),
    captainPlayerId: effectiveCaptain?.playerId ?? null,
    droppedPlayerIds,
  };
}

export function computeTeamRoundScores(
  input: TeamRoundInput,
): DerivedTeamRoundScore[] {
  const { teamIds, roundIds, selections, playerMatchScores, roundIdByMatch, countedPlayersByRound } =
    input;

  // (roundId,playerId) → Σ base over that round's matches; also tracks presence.
  const roundBase = new Map<string, number>();
  for (const s of playerMatchScores) {
    const roundId = roundIdByMatch.get(s.matchId);
    if (roundId === undefined) continue;
    const key = roundId + "|" + s.playerId;
    roundBase.set(key, (roundBase.get(key) ?? 0) + s.base);
  }
  const playedInRound = (roundId: string, playerId: string): boolean =>
    roundBase.has(roundId + "|" + playerId);
  const baseInRound = (roundId: string, playerId: string): number =>
    roundBase.get(roundId + "|" + playerId) ?? 0;

  // Selections indexed by (teamId,roundId).
  const selByTeamRound = new Map<string, RawSelection[]>();
  for (const s of selections) {
    const key = s.fantasyTeamId + "|" + s.roundId;
    (selByTeamRound.get(key) ?? selByTeamRound.set(key, []).get(key)!).push(s);
  }

  const out: DerivedTeamRoundScore[] = [];
  for (const teamId of teamIds) {
    for (const roundId of roundIds) {
      const sels = selByTeamRound.get(teamId + "|" + roundId) ?? [];

      const result = scoreTeamRound(sels.map((sel) => ({
        playerId: sel.playerId,
        base: baseInRound(roundId, sel.playerId),
        played: playedInRound(roundId, sel.playerId),
        isCaptain: sel.isCaptain,
        isViceCaptain: sel.isViceCaptain,
      })), countedPlayersByRound?.get(roundId));

      out.push({
        fantasyTeamId: teamId,
        roundId,
        total: result.total,
        captainPlayerId: result.captainPlayerId,
      });
    }
  }

  // Deterministic emit order = the columns readDerived orders by.
  return out.sort(
    (a, b) =>
      cmp(a.fantasyTeamId, b.fantasyTeamId) || cmp(a.roundId, b.roundId),
  );
}
