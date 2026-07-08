import type { MatchScorecard, RegistryPlayer } from "../types.js";

/**
 * Two hand-scored reference scorecards for Gate G1. Expected per-player fantasy
 * points are hand-computed in test/scoring.test.ts against the FIXTURE CONFIG.
 *
 *  - REF_MATCH_BATTING: batting-heavy. Contains the SR-bonus edge (cara: 18 off
 *    9 balls = SR 200 but < 10 balls -> NO bonus) and a SR-exactly-150 boundary
 *    (finn). Captain (alice) plays, so she is doubled.
 *  - REF_MATCH_BOWLING: bowling/fielding-heavy. Contains economy-bonus at the
 *    <= 3.0 boundary and captain DNP -> vice-captain (ivan) inherits the ×2
 *    (Gate G8). Caught-and-bowled and assisted run-out fielding credits appear.
 */

export const REF_REGISTRY: RegistryPlayer[] = [
  { id: "alice", displayName: "Alice", role: "BAT" },
  { id: "bob", displayName: "Bob", role: "BAT" },
  { id: "cara", displayName: "Cara", role: "WK", wkEligible: true },
  { id: "dan", displayName: "Dan", role: "BWL" },
  { id: "evan", displayName: "Evan", role: "BWL" },
  { id: "finn", displayName: "Finn", role: "AR" },
  { id: "greg", displayName: "Greg", role: "BWL" },
  { id: "hana", displayName: "Hana", role: "BWL" },
  { id: "ivan", displayName: "Ivan", role: "AR" },
  { id: "jack", displayName: "Jack", role: "WK", wkEligible: true },
  { id: "kim", displayName: "Kim", role: "BAT" },
  { id: "leo", displayName: "Leo", role: "BAT" },
  { id: "mike", displayName: "Mike", role: "BWL" },
];

export const REF_MATCH_BATTING: MatchScorecard = {
  matchId: "REF-BAT",
  lineup: ["alice", "bob", "cara", "dan", "evan", "finn"],
  wicketKeeper: "cara",
  captain: "alice",
  viceCaptain: "finn",
  clubBatting: [
    { player: "alice", runs: 80, ballsFaced: 50, fours: 10, sixes: 2 },
    { player: "bob", runs: 45, ballsFaced: 40, fours: 5, sixes: 0 },
    { player: "cara", runs: 18, ballsFaced: 9, fours: 1, sixes: 1 }, // SR 200 but 9 balls -> no bonus
    { player: "dan", runs: 5, ballsFaced: 8, fours: 0, sixes: 0 },
    { player: "evan", runs: 2, ballsFaced: 3, fours: 0, sixes: 0 },
    { player: "finn", runs: 30, ballsFaced: 20, fours: 2, sixes: 1 }, // SR exactly 150 -> bonus
  ],
  clubBowling: [
    { player: "dan", overs: 4, runsConceded: 20, wickets: 2 }, // econ 5.0 -> no bonus
    { player: "evan", overs: 4, runsConceded: 30, wickets: 2 }, // econ 7.5 -> no bonus
    { player: "finn", overs: 3, runsConceded: 18, wickets: 1 }, // econ 6.0 -> no bonus
  ],
  oppositionDismissals: [
    "c cara b evan", // cara keeper catch
    "c alice b evan", // alice outfield catch
    "b dan", // dan wicket (figures), no fielding
    "lbw b dan", // dan wicket (figures), no fielding
    "run out (finn)", // finn unassisted run-out
    "st cara b finn", // cara stumping; finn wicket (figures)
  ],
};

export const REF_MATCH_BOWLING: MatchScorecard = {
  matchId: "REF-BWL",
  lineup: ["hana", "ivan", "jack", "kim", "leo", "mike"],
  wicketKeeper: "jack",
  captain: "greg", // DNP: not in lineup -> VC inherits (G8)
  viceCaptain: "ivan",
  clubBatting: [
    { player: "kim", runs: 12, ballsFaced: 15, fours: 1, sixes: 0 },
    { player: "leo", runs: 6, ballsFaced: 10, fours: 0, sixes: 0 },
    { player: "ivan", runs: 25, ballsFaced: 14, fours: 2, sixes: 1 }, // SR 178.6 -> bonus
    { player: "hana", runs: 3, ballsFaced: 5, fours: 0, sixes: 0 },
    { player: "jack", runs: 8, ballsFaced: 12, fours: 1, sixes: 0 },
    { player: "mike", runs: 0, ballsFaced: 2, fours: 0, sixes: 0 }, // played, 0 batting
  ],
  clubBowling: [
    { player: "hana", overs: 6, runsConceded: 15, wickets: 3 }, // econ 2.5 -> bonus
    { player: "ivan", overs: 4, runsConceded: 12, wickets: 2 }, // econ 3.0 -> bonus (boundary)
    { player: "mike", overs: 3, runsConceded: 9, wickets: 1 }, // econ 3.0, 3 overs -> bonus (boundary)
  ],
  oppositionDismissals: [
    "c jack b hana", // jack keeper catch; hana wicket
    "c ivan b hana", // ivan catch; hana wicket
    "c & b hana", // hana caught-and-bowled catch; hana wicket
    "st jack b ivan", // jack stumping; ivan wicket
    "lbw b ivan", // ivan wicket, no fielding
    "b mike", // mike wicket, no fielding
    "run out (kim/leo)", // assisted run-out: kim + leo
    "run out (mike)", // unassisted run-out: mike
  ],
};
