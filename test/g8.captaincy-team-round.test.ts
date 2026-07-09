import { describe, expect, it } from "vitest";
import { computeTeamRoundScores } from "../src/recompute/teamRoundScoring.js";
import type {
  DerivedPlayerMatchScore,
  RawSelection,
} from "../src/recompute/types.js";

/**
 * G8 CAPTAINCY — RE-VERIFIED AT THE TEAM-ROUND LAYER.
 *
 * Captaincy (D10) now lives in the team-round engine, NOT in scoreMatch. The ×2
 * is driven by the fantasy team's own `selections.is_captain / is_vice_captain`
 * — never by any scorecard captain field (the orchestrator neutralises those).
 * "DNP" = the selected player has NO player_match_score row for the round
 * (scoreMatch always emits played=true for a lineup player, so absence-of-row,
 * not a played flag, is what models a captain who did not play).
 *
 * One round R1 / one match M1. Team FT selects cap (C), vc (VC) and p3. Base
 * values (pre-captaincy) are fixed; only WHO played changes across cases.
 */

const R1 = "round-1";
const M1 = "match-1";
const FT = "team-1";
const CAP = "player-cap";
const VC = "player-vc";
const P3 = "player-p3";

const roundIdByMatch = new Map([[M1, R1]]);

/** A per-player score row (only `base` and presence matter for captaincy). */
function score(playerId: string, base: number): DerivedPlayerMatchScore {
  return { matchId: M1, playerId, played: true, batting: base, bowling: 0, fielding: 0, bonuses: 0, base };
}

const selections: RawSelection[] = [
  { id: "s1", fantasyTeamId: FT, roundId: R1, playerId: CAP, isCaptain: true, isViceCaptain: false },
  { id: "s2", fantasyTeamId: FT, roundId: R1, playerId: VC, isCaptain: false, isViceCaptain: true },
  { id: "s3", fantasyTeamId: FT, roundId: R1, playerId: P3, isCaptain: false, isViceCaptain: false },
];

function run(scores: DerivedPlayerMatchScore[]) {
  return computeTeamRoundScores({
    teamIds: [FT],
    roundIds: [R1],
    selections,
    playerMatchScores: scores,
    roundIdByMatch,
  })[0]!;
}

describe("G8 CAPTAINCY (team-round layer)", () => {
  // Captain PLAYS: cap 50, vc 30, p3 20 all have score rows.
  //   Σ selected round-bases = 50 + 30 + 20 = 100
  //   effective captain = cap (has a row) → + cap round-base 50
  //   total = 100 + 50 = 150 ; captain = cap
  it("captain played → captain doubled", () => {
    const row = run([score(CAP, 50), score(VC, 30), score(P3, 20)]);
    expect(row.total).toBe(150);
    expect(row.captainPlayerId).toBe(CAP);
  });

  // Captain PLAYS but scored 0 (in the lineup, base 0) — NOT DNP. He is still
  // doubled (×2 of 0 = 0); the VC is NOT promoted.
  //   Σ selected = 0 + 30 + 20 = 50 ; + cap double 0 → total 50 ; captain = cap
  it("captain played but scored 0 → still captain (doubles 0), VC not promoted", () => {
    const row = run([score(CAP, 0), score(VC, 30), score(P3, 20)]);
    expect(row.total).toBe(50);
    expect(row.captainPlayerId).toBe(CAP);
  });

  // Captain DNP (no score row for cap) → VC inherits the ×2 (D10).
  //   Σ selected = cap 0 (no row) + vc 30 + p3 20 = 50
  //   effective captain = vc (has a row) → + vc round-base 30
  //   total = 50 + 30 = 80 ; captain = vc
  it("captain DNP → vice-captain doubled", () => {
    const row = run([score(VC, 30), score(P3, 20)]); // no cap row
    expect(row.total).toBe(80);
    expect(row.captainPlayerId).toBe(VC);
  });

  // Captain AND vice-captain both DNP (no rows) → nobody doubled.
  //   Σ selected = 0 + 0 + p3 20 = 20 ; no double → total 20 ; captain = null
  it("captain and vice-captain both DNP → nobody doubled", () => {
    const row = run([score(P3, 20)]); // only p3 played
    expect(row.total).toBe(20);
    expect(row.captainPlayerId).toBeNull();
  });
});
