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
 *   team round total = Σ (selected player's round-base)
 *                      + effective-captain's round-base    (the ×2)
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
}

export function computeTeamRoundScores(
  input: TeamRoundInput,
): DerivedTeamRoundScore[] {
  const { teamIds, roundIds, selections, playerMatchScores, roundIdByMatch } =
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

      let total = 0;
      for (const sel of sels) total += baseInRound(roundId, sel.playerId);

      // Effective captain (D10): captain if it played this round, else VC if it
      // played, else nobody. Doubling = add the captain's round-base once more.
      const captainSel = sels.find((s) => s.isCaptain);
      const viceSel = sels.find((s) => s.isViceCaptain);
      let effectiveCaptain: string | null = null;
      if (captainSel && playedInRound(roundId, captainSel.playerId)) {
        effectiveCaptain = captainSel.playerId;
      } else if (viceSel && playedInRound(roundId, viceSel.playerId)) {
        effectiveCaptain = viceSel.playerId;
      }
      if (effectiveCaptain !== null) {
        total += baseInRound(roundId, effectiveCaptain);
      }

      out.push({
        fantasyTeamId: teamId,
        roundId,
        total,
        captainPlayerId: effectiveCaptain,
      });
    }
  }

  // Deterministic emit order = the columns readDerived orders by.
  return out.sort(
    (a, b) =>
      cmp(a.fantasyTeamId, b.fantasyTeamId) || cmp(a.roundId, b.roundId),
  );
}
