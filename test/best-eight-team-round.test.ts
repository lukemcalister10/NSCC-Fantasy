import { describe, expect, it } from "vitest";
import { countedPlayersForRound, NSCC_2026_27_SEASON_ID } from "../src/recompute/roundScoringPolicy.js";
import { computeTeamRoundScores, scoreTeamRound } from "../src/recompute/teamRoundScoring.js";
import type { DerivedPlayerMatchScore, RawSelection } from "../src/recompute/types.js";

const team = "team";
const first = "round-1";
const second = "round-2";
const match1 = "match-1";
const match2 = "match-2";
const players = Array.from({ length: 9 }, (_, i) => `player-${i + 1}`);
const selections: RawSelection[] = [first, second].flatMap((roundId) => players.map((playerId, i) => ({
  id: `${roundId}-${playerId}`,
  fantasyTeamId: team,
  roundId,
  playerId,
  isCaptain: i === 0,
  isViceCaptain: i === 1,
})));

function score(matchId: string, playerId: string, base: number): DerivedPlayerMatchScore {
  return {
    matchId, playerId, played: true, batting: base, bowling: 0, fielding: 0,
    bonuses: 0, secondInningsAdjustment: 0, base,
  };
}

function rounds(bases: number[], captainPlayed = true) {
  const scores = bases.flatMap((base, i) =>
    i === 0 && !captainPlayed ? [] : [score(match2, players[i]!, base)]);
  return computeTeamRoundScores({
    teamIds: [team],
    roundIds: [first, second],
    countedPlayersByRound: new Map([[second, countedPlayersForRound(NSCC_2026_27_SEASON_ID, 2)!]]),
    selections,
    playerMatchScores: [
      ...bases.map((base, i) => score(match1, players[i]!, base)),
      ...scores,
    ],
    roundIdByMatch: new Map([[match1, first], [match2, second]]),
  });
}

describe("best eight begins in Round 2", () => {
  it("keeps Round 1 and unrelated seasons on the original rule", () => {
    expect(countedPlayersForRound(NSCC_2026_27_SEASON_ID, 1)).toBeUndefined();
    expect(countedPlayersForRound(NSCC_2026_27_SEASON_ID, 2)).toBe(8);
    expect(countedPlayersForRound("another-season", 2)).toBeUndefined();
    const result = rounds([10, 9, 8, 7, 6, 5, 4, 3, 2]);
    expect(result[0]?.total).toBe(64); // all nine (54) + captain (10)
    expect(result[1]?.total).toBe(62); // best eight (52) + captain (10)
  });

  it("keeps the bonus when the captain is the dropped ninth scorer", () => {
    const result = rounds([-3, 30, 20, 19, 18, 17, 16, 15, 14]);
    expect(result[1]?.total).toBe(146); // other eight sum 149, captain bonus -3
    expect(result[1]?.captainPlayerId).toBe(players[0]);
  });

  it("distinguishes a captain who played for zero from a captain who did not play", () => {
    const bases = [0, 30, 20, 19, 18, 17, 16, 15, 14];
    const played = rounds(bases)[1]!;
    const absent = rounds(bases, false)[1]!;
    expect(played.total).toBe(149);
    expect(played.captainPlayerId).toBe(players[0]);
    expect(absent.total).toBe(179);
    expect(absent.captainPlayerId).toBe(players[1]);
  });

  it("uses a deterministic dropped player for tied zeros", () => {
    const result = scoreTeamRound(players.map((playerId, i) => ({
      playerId, base: i < 7 ? 10 : 0, played: i !== 8,
      isCaptain: i === 0, isViceCaptain: i === 1,
    })), 8);
    expect(result.droppedPlayerIds).toEqual([players[8]]);
    expect(result.total).toBe(80);
  });
});
