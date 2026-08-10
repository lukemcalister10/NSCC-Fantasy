import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { recomputeSeason } from "../src/recompute/orchestrator.js";
import { generateRound } from "../src/recompute/roundRobin.js";
import type { DerivedH2hResult, RawMatch, RawSeason } from "../src/recompute/types.js";

/**
 * D29 — THE FIXTURE INDEX IS A PROPERTY OF THE ROUND, NOT OF THE SCHEDULE SO FAR.
 *
 * The H2H round index is `seq − 1`, never the round's position among ACTIVE
 * rounds. This is a DETERMINISM defect, not a display mismatch (C10 reclassified):
 * D19 says a round with no entered matches does not exist for H2H, so an empty
 * round is skipped — and under the positional rule, the day that round acquires
 * its first match every LATER round's index shifts by one and the fixtures of
 * rounds ALREADY SETTLED are rewritten. That is the ladder changing with
 * hindsight, which the operator has explicitly ruled out (D24, same principle).
 *
 * THIS TEST FAILS ON THE PRE-D29 ENGINE. With four teams the round-robin cycle is
 * three, so index 1 and index 2 are different fixtures: round 3 is settled as
 * index 1 while round 2 is empty, and becomes index 2 the moment round 2 gets a
 * match. That is the retroactive rewrite, reproduced.
 */

const SEASON = "d29-season";
const [T1, T2, T3, T4] = ["team-1", "team-2", "team-3", "team-4"];
const TEAMS = [T1, T2, T3, T4];
const R1 = "round-1";
const R2 = "round-2";
const R3 = "round-3";

/** One finalised match per round we want ACTIVE, with a scorecard behind it. */
function matchIn(roundId: string, id: string): RawMatch {
  return {
    id,
    roundId,
    grade: "A",
    opponent: "Opp",
    status: "finalised",
    finalDayDate: "2026-10-04",
    finalisedAt: `2026-10-04T06:00:0${id.slice(-1)}Z`,
  };
}

/**
 * @param round2HasAMatch when true, the previously-empty round 2 has acquired its
 *   first entered match — the event D19 makes reachable and D29 makes harmless.
 */
function buildRaw(round2HasAMatch: boolean): RawSeason {
  const matches = [matchIn(R1, "match-1"), matchIn(R3, "match-3")];
  if (round2HasAMatch) matches.push(matchIn(R2, "match-2"));

  return {
    seasonId: SEASON,
    config: FIXTURE_CONFIG,
    // One player, in every lineup, so each round has a real (if small) score. The
    // fixtures are what this test is about; the totals only have to exist.
    players: [
      {
        id: "p1", registryKey: "p1", displayName: "P1", role: "BAT",
        wkEligible: false, startingPrice: 50_000, active: true,
      },
    ],
    rounds: [
      { id: R1, seq: 1, name: "R1", lockAt: "2099-01-01T00:00:00Z" },
      { id: R2, seq: 2, name: "R2", lockAt: "2099-01-02T00:00:00Z" },
      { id: R3, seq: 3, name: "R3", lockAt: "2099-01-03T00:00:00Z" },
    ],
    matches,
    scorecards: matches.map((m) => ({
      id: `sc-${m.id}`,
      matchId: m.id,
      wicketKeeperPlayerId: null,
      reviewState: "committed" as const,
      lineup: ["p1"],
      batting: [
        { playerId: "p1", innings: 1, runs: 30, ballsFaced: 30, fours: 0, sixes: 0, notOut: false },
      ],
      bowling: [],
      dismissals: [],
    })),
    fantasyTeams: TEAMS.map((id) => ({ id, ownerProfileId: `owner-${id}`, name: id })),
    // Every team selects the one player, so every team has a round total and the
    // fixtures settle rather than being skipped.
    selections: TEAMS.flatMap((team) =>
      [R1, R2, R3].map((round) => ({
        id: `sel-${team}-${round}`,
        fantasyTeamId: team,
        roundId: round,
        playerId: "p1",
        isCaptain: true,
        isViceCaptain: false,
      })),
    ),
    trades: [],
  };
}

/** The pairings of one round, as a comparable set of "home vs away" strings. */
function pairingsOf(results: DerivedH2hResult[], roundId: string): string[] {
  return results
    .filter((r) => r.roundId === roundId)
    .map((r) => `${r.homeTeamId} v ${r.awayTeamId ?? "BYE"}`)
    .sort();
}

describe("D29 FIXTURE INDEX — an empty round filling in rewrites nothing", () => {
  const before = recomputeSeason(buildRaw(false)).h2hResults;
  const after = recomputeSeason(buildRaw(true)).h2hResults;

  it("settles rounds 1 and 3 while round 2 has no entered matches (D19)", () => {
    expect(pairingsOf(before, R1)).toHaveLength(2);
    expect(pairingsOf(before, R3)).toHaveLength(2);
    // D19: a round with no entered matches does not exist for H2H at all.
    expect(pairingsOf(before, R2)).toEqual([]);
  });

  it("does NOT change round 3's fixture when round 2 acquires its first match", () => {
    // THE GATE OF THIS TEST. Pre-D29, round 3 was index 1 (second ACTIVE round)
    // and becomes index 2 (third active round) — a different set of pairings for a
    // round that has already been played, scored and put on the ladder.
    expect(pairingsOf(after, R3)).toEqual(pairingsOf(before, R3));
  });

  it("leaves round 1 alone as well", () => {
    expect(pairingsOf(after, R1)).toEqual(pairingsOf(before, R1));
  });

  it("gives every round exactly the fixture its own seq implies", () => {
    // The positive statement of the rule: a round's fixture is knowable from the
    // round alone, before it is played and regardless of any other round.
    for (const [roundId, seq] of [[R1, 1], [R2, 2], [R3, 3]] as const) {
      const expected = generateRound(TEAMS, seq - 1)
        .map((f) => `${f.home} v ${f.away ?? "BYE"}`)
        .sort();
      expect(pairingsOf(after, roundId)).toEqual(expected);
    }
  });

  it("round 3's fixture is the seq-3 fixture, which is NOT the seq-2 one", () => {
    // Proves the previous assertions have teeth: if index 1 and index 2 happened
    // to produce the same pairings, none of this would be detecting anything.
    const asIndex1 = generateRound(TEAMS, 1).map((f) => `${f.home} v ${f.away ?? "BYE"}`).sort();
    const asIndex2 = generateRound(TEAMS, 2).map((f) => `${f.home} v ${f.away ?? "BYE"}`).sort();
    expect(asIndex1).not.toEqual(asIndex2);
    expect(pairingsOf(before, R3)).toEqual(asIndex2);
  });

  it("agrees with what the fixtures page derives from seq − 1 (C10 closed)", () => {
    // app/lib/queries.ts has always indexed on seq − 1. The engine now does too,
    // so the disagreement banner S-C added as the safety net has nothing left to
    // report — the two derivations are the same derivation.
    for (const { roundId, homeTeamId, awayTeamId } of after) {
      const seq = { [R1]: 1, [R2]: 2, [R3]: 3 }[roundId]!;
      const uiFixtures = generateRound(TEAMS, seq - 1);
      expect(uiFixtures).toContainEqual({ home: homeTeamId, away: awayTeamId });
    }
  });
});
