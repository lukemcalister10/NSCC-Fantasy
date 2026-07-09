import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { scoreMatch } from "../src/engines/scoring.js";
import {
  REF_MATCH_BATTING,
  REF_MATCH_BOWLING,
} from "../src/fixtures/reference-scorecards.js";
import type { MatchScorecard } from "../src/types.js";
import { referenceTotals } from "./helpers/references.js";

const cfg = FIXTURE_CONFIG.scoring;

/** Extract the `total` (post-captaincy) for each player as a plain object. */
function totals(card: MatchScorecard): Record<string, number> {
  return referenceTotals(card, cfg);
}

describe("G1 REFERENCE_SCORECARD — batting-heavy", () => {
  // Hand computation (fixture: run 1, four +1, six +2, wkt 25, catch/keeper 8,
  // stump 10, runout 10/5, SR +10 if SR>=150 & balls>=10, econ +10 if <=3 & >=3ov):
  //   alice (C, ×2): bat 80 + 10·1 + 2·2 = 94; SR 160 -> +10; catch 8;
  //                  base 112 -> ×2 = 224
  //   bob:          bat 45 + 5 = 50; SR 112.5 no bonus                     = 50
  //   cara (kpr):   bat 18 + 1 + 2 = 21; SR 200 but 9 balls -> NO bonus;
  //                  keeper catch 8 + stumping 10 = 18; base               = 39
  //   dan:          bat 5; 2 wkt ×25 = 50; econ 5.0 no bonus               = 55
  //   evan:         bat 2; 2 wkt ×25 = 50; econ 7.5 no bonus               = 52
  //   finn (VC):    bat 30 + 2 + 2 = 34; SR exactly 150 -> +10;
  //                  1 wkt 25; econ 6.0 no bonus; run-out 10; base         = 79
  it("reproduces hand-scored points exactly", () => {
    expect(totals(REF_MATCH_BATTING)).toEqual({
      alice: 224,
      bob: 50,
      cara: 39,
      dan: 55,
      evan: 52,
      finn: 79,
    });
  });

  it("awards no SR bonus for the 9-balls-at-SR-200 edge (cara batting alone)", () => {
    const result = scoreMatch(REF_MATCH_BATTING, cfg);
    const cara = result.scores.get("cara")!;
    // 21 batting + 18 fielding, zero bonus.
    expect(cara.bonuses).toBe(0);
    expect(cara.batting).toBe(21);
    expect(cara.fielding).toBe(18);
  });

  it("doubles the named captain (alice), not the vice-captain", () => {
    const result = scoreMatch(REF_MATCH_BATTING, cfg);
    expect(result.effectiveCaptain).toBe("alice");
    expect(result.scores.get("alice")!.captainMultiplier).toBe(2);
    expect(result.scores.get("finn")!.captainMultiplier).toBe(1);
  });
});

describe("G1 REFERENCE_SCORECARD — bowling/fielding-heavy", () => {
  // Hand computation:
  //   hana:         bat 3; 3 wkt ×25 = 75; econ 2.5 -> +10; c&b catch 8    = 96
  //   ivan (VC→C):  bat 25 + 2 + 2 = 29; SR 178.6 -> +10; 2 wkt 50;
  //                  econ 3.0 -> +10; catch 8; base 107 -> ×2              = 214
  //   jack (kpr):   bat 8 + 1 = 9; keeper catch 8 + stumping 10 = 18       = 27
  //   kim:          bat 12 + 1 = 13; assisted run-out 5                    = 18
  //   leo:          bat 6; assisted run-out 5                              = 11
  //   mike:         bat 0; 1 wkt 25; econ 3.0 -> +10; run-out 10           = 45
  it("reproduces hand-scored points exactly", () => {
    expect(totals(REF_MATCH_BOWLING)).toEqual({
      hana: 96,
      ivan: 214,
      jack: 27,
      kim: 18,
      leo: 11,
      mike: 45,
    });
  });

  it("credits economy bonus at the <= 3.0 boundary (ivan, mike)", () => {
    const result = scoreMatch(REF_MATCH_BOWLING, cfg);
    // ivan bonuses = SR(10) + econ(10) = 20; mike bonuses = econ(10).
    expect(result.scores.get("mike")!.bonuses).toBe(10);
    expect(result.scores.get("ivan")!.bonuses).toBe(20);
  });
});

describe("G8 CAPTAINCY", () => {
  it("captain DNP -> vice-captain inherits the ×2", () => {
    const result = scoreMatch(REF_MATCH_BOWLING, cfg);
    // greg (captain) is not in the lineup; ivan (VC) is doubled.
    expect(result.effectiveCaptain).toBe("ivan");
    expect(result.scores.has("greg")).toBe(false);
    expect(result.scores.get("ivan")!.captainMultiplier).toBe(2);
  });

  it("captain and vice-captain both DNP -> nobody doubled", () => {
    const card: MatchScorecard = {
      matchId: "G8-BOTH-DNP",
      lineup: ["bob", "dan"],
      captain: "alice", // not in lineup
      viceCaptain: "finn", // not in lineup
      clubBatting: [{ player: "bob", runs: 20, ballsFaced: 30, fours: 2, sixes: 0 }],
      clubBowling: [{ player: "dan", overs: 4, runsConceded: 40, wickets: 1 }],
      oppositionDismissals: [],
    };
    const result = scoreMatch(card, cfg);
    expect(result.effectiveCaptain).toBeNull();
    for (const ps of result.scores.values()) {
      expect(ps.captainMultiplier).toBe(1);
    }
    // bob: 20 + 2 = 22 (no double); dan: 1 wkt 25 (econ 10.0 no bonus).
    expect(result.scores.get("bob")!.total).toBe(22);
    expect(result.scores.get("dan")!.total).toBe(25);
  });
});
