import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { scoreMatch } from "../src/engines/scoring.js";
import type { MatchScorecard } from "../src/types.js";
import { O4_CONFIG } from "./fixtures/o4-config.js";

/**
 * O4'S SHAPE AND D28'S MULTIPLIER, hand-scored.
 *
 * G1 proves the engine reproduces two hand-scored reference scorecards under the
 * FROZEN fixture config — where every O4 key added by this slice is zero and the
 * multiplier is 1.0, so G1 says nothing about them. This file is the other half:
 * the same engine, no code change, driven by the operator's actual chosen economy
 * (test/fixtures/o4-config.ts), with every number below derived by hand.
 *
 * It is not a gate. It is the evidence that the reshape implements O4 rather than
 * merely admitting O4-shaped keys.
 */

const cfg = O4_CONFIG.scoring;

/** Innings 1 only, one batter, so a single term can be isolated. */
function battingCard(
  line: { runs: number; ballsFaced: number; fours?: number; sixes?: number; notOut?: boolean },
): MatchScorecard {
  return {
    matchId: "O4-BAT",
    lineup: ["solo"],
    captain: "nobody",
    viceCaptain: "nobody",
    clubBatting: [
      {
        player: "solo",
        runs: line.runs,
        ballsFaced: line.ballsFaced,
        fours: line.fours ?? 0,
        sixes: line.sixes ?? 0,
        ...(line.notOut === undefined ? {} : { notOut: line.notOut }),
      },
    ],
    clubBowling: [],
    oppositionDismissals: [],
  };
}

const baseOf = (card: MatchScorecard): number =>
  scoreMatch(card, cfg).scores.get("solo")!.base;

describe("O4 batting — milestones, ducks and not-outs", () => {
  it("scores runs, fours and sixes at O4's rates", () => {
    // 40 runs, 5 fours, 1 six = 40·1 + 5·1 + 3 = 48. Under 50, so no milestone.
    expect(baseOf(battingCard({ runs: 40, ballsFaced: 30, fours: 5, sixes: 1 }))).toBe(48);
  });

  it("adds the fifty bonus once the batter reaches 50", () => {
    // 50 runs + fifty bonus 10 = 60. The boundary itself, not 51.
    expect(baseOf(battingCard({ runs: 50, ballsFaced: 40 }))).toBe(60);
    // 49 is not a fifty.
    expect(baseOf(battingCard({ runs: 49, ballsFaced: 40 }))).toBe(49);
  });

  it("REPLACES the fifty bonus with the century bonus rather than stacking them", () => {
    // OPERATOR RULING, 10/08/2026. A century scores perCentury ALONE: 100 runs
    // + 20 = 120, NOT 100 + 10 + 20 = 130. O4 lists the two bonuses as separate
    // lines, which reads as cumulative unless someone says otherwise; this is the
    // assertion that pins the ruling so a future reader cannot re-read the list.
    expect(baseOf(battingCard({ runs: 100, ballsFaced: 80 }))).toBe(120);
    expect(baseOf(battingCard({ runs: 100, ballsFaced: 80 }))).not.toBe(130);

    // And the fifty bonus is still the one that applies just below the hundred.
    expect(baseOf(battingCard({ runs: 99, ballsFaced: 80 }))).toBe(109);
  });

  it("scores a duck only when the batter was DISMISSED for 0", () => {
    // Dismissed for 0 → the duck penalty. Note the config carries the operator's
    // own −5, so this is an addition of a negative, not a subtraction in code.
    expect(baseOf(battingCard({ runs: 0, ballsFaced: 3, notOut: false }))).toBe(-5);
    // Unbeaten on 0 is NOT a duck — it is a not-out. This is the distinction
    // migration 0006 captured `not_out` for; runs alone cannot express it.
    expect(baseOf(battingCard({ runs: 0, ballsFaced: 3, notOut: true }))).toBe(5);
  });

  it("pays the not-out bonus alongside runs and milestones", () => {
    // 60 not out off 45, 6 fours: 60 + 6 + fifty 10 + not out 5 = 81.
    expect(
      baseOf(battingCard({ runs: 60, ballsFaced: 45, fours: 6, notOut: true })),
    ).toBe(81);
  });

  it("awards no strike-rate bonus — O5 is superseded and held at zero", () => {
    // 60 off 20 is SR 300; under O4 that is worth nothing beyond the runs.
    const hot = baseOf(battingCard({ runs: 60, ballsFaced: 20 }));
    const cold = baseOf(battingCard({ runs: 60, ballsFaced: 120 }));
    expect(hot).toBe(cold);
  });
});

describe("O4 bowling — wickets, maidens, five-fors and the economy bonus", () => {
  function bowlingCard(line: {
    overs: number;
    runsConceded: number;
    wickets: number;
    maidens?: number;
  }): MatchScorecard {
    return {
      matchId: "O4-BWL",
      lineup: ["solo"],
      captain: "nobody",
      viceCaptain: "nobody",
      clubBatting: [],
      clubBowling: [
        {
          player: "solo",
          overs: line.overs,
          runsConceded: line.runsConceded,
          wickets: line.wickets,
          ...(line.maidens === undefined ? {} : { maidens: line.maidens }),
        },
      ],
      oppositionDismissals: [],
    };
  }

  it("scores wickets and maidens at O4's rates", () => {
    // 6 overs (36 balls), 30 runs, 2 wickets, 1 maiden:
    //   wickets 2·19 = 38, maiden 1, economy floor(0.25 × (36 − 30)) = floor(1.5) = 1
    expect(baseOf(bowlingCard({ overs: 6, runsConceded: 30, wickets: 2, maidens: 1 }))).toBe(40);
  });

  it("adds the five-wicket haul at five wickets IN THE INNINGS, not four", () => {
    // 10 overs (60 balls), 60 runs → economy term floor(0.25 × 0) = 0, isolating
    // the wicket terms. 4 wkt = 76; 5 wkt = 95 + 10 = 105.
    expect(baseOf(bowlingCard({ overs: 10, runsConceded: 60, wickets: 4 }))).toBe(76);
    expect(baseOf(bowlingCard({ overs: 10, runsConceded: 60, wickets: 5 }))).toBe(105);
  });

  it("computes the continuous economy bonus, discarding the fraction", () => {
    // 8 overs (48 balls), 22 runs, 0 wickets: floor(0.25 × 26) = floor(6.5) = 6.
    expect(baseOf(bowlingCard({ overs: 8, runsConceded: 22, wickets: 0 }))).toBe(6);
    // 5 overs (30 balls), 19 runs: floor(0.25 × 11) = floor(2.75) = 2.
    expect(baseOf(bowlingCard({ overs: 5, runsConceded: 19, wickets: 0 }))).toBe(2);
  });

  it("never goes negative above 6 an over — the clamp IS 'no penalty' (O4)", () => {
    // 4 overs (24 balls) for 60 runs is 15 an over. 0.25 × (24 − 60) = −9, which
    // clamps to 0 rather than docking the bowler.
    expect(baseOf(bowlingCard({ overs: 4, runsConceded: 60, wickets: 0 }))).toBe(0);
  });

  it("has no minimum-overs threshold (O4 drops O5's gate)", () => {
    // One over (6 balls) for 0 runs: floor(0.25 × 6) = 1. Under O5's threshold
    // style this would have paid nothing at all below 3 overs.
    expect(baseOf(bowlingCard({ overs: 1, runsConceded: 0, wickets: 0 }))).toBe(1);
  });
});

/**
 * THE HAND-WORKED SECOND-INNINGS CASE (D28), reproduced in the slice report so
 * the operator can check the arithmetic without reading code.
 *
 *   INNINGS 1  batting  62 off 40 (7 fours, 1 six), dismissed
 *                       62 + 10 (fifty) + 7 + 3                        = 82
 *              bowling  8 overs (48 balls), 22 runs, 2 wkt, 1 maiden
 *                       38 + 1                                         = 39
 *              fielding 1 outfield catch                               = 10
 *              economy  floor(0.25 × (48 − 22)) = floor(6.5)           =  6
 *                                                          innings 1   = 137
 *
 *   INNINGS 2  batting  16 off 12 (2 fours), NOT OUT
 *                       16 + 2 + 5 (not out)                           = 23
 *              bowling  5 overs (30 balls), 19 runs, 1 wkt             = 19
 *              fielding 1 run-out                                      = 15
 *              economy  floor(0.25 × (30 − 19)) = floor(2.75)          =  2
 *                                                          innings 2   =  59
 *
 *   ONE multiplication, ONE rounding:  59 × 0.5 = 29.5 → 30  (half UP)
 *   adjustment = 30 − 59 = −29
 *   base       = 137 + 59 − 29 = 167          (equivalently 137 + 30)
 *   captain ×2 = 334                          (D10, AFTER the multiplier)
 *
 * The economy bonus is PER INNINGS and therefore multiplied with the rest of that
 * innings (operator ruling, 10/08/2026) — 2 is earned in innings 2 and is scaled
 * exactly like the wicket and the run-out beside it. No component is exempt.
 */
const TWO_INNINGS_CARD: MatchScorecard = {
  matchId: "D28-WORKED",
  lineup: ["skip", "other"],
  wicketKeeper: "other",
  captain: "skip",
  viceCaptain: "other",
  clubBatting: [
    { player: "skip", innings: 1, runs: 62, ballsFaced: 40, fours: 7, sixes: 1, notOut: false },
    { player: "skip", innings: 2, runs: 16, ballsFaced: 12, fours: 2, sixes: 0, notOut: true },
  ],
  clubBowling: [
    { player: "skip", innings: 1, overs: 8, runsConceded: 22, wickets: 2, maidens: 1 },
    { player: "skip", innings: 2, overs: 5, runsConceded: 19, wickets: 1, maidens: 0 },
  ],
  oppositionDismissals: [
    { innings: 1, text: "c skip b other" },
    { innings: 2, text: "run out (skip)" },
  ],
};

describe("D28 SECOND-INNINGS MULTIPLIER — the hand-worked case", () => {
  const ps = () => scoreMatch(TWO_INNINGS_CARD, cfg).scores.get("skip")!;

  it("totals each innings at face value in the component columns", () => {
    const s = ps();
    expect(s.batting).toBe(82 + 23); // 105, unmultiplied
    expect(s.bowling).toBe(39 + 19); // 58
    expect(s.fielding).toBe(10 + 15); // 25
    expect(s.bonuses).toBe(6 + 2); // 8 — economy, per innings
  });

  it("multiplies ONCE and rounds ONCE, half up (59 × 0.5 = 29.5 → 30)", () => {
    expect(ps().secondInningsAdjustment).toBe(-29);
  });

  it("produces base 167 and a captain total of 334", () => {
    const s = ps();
    expect(s.base).toBe(167);
    expect(s.captainMultiplier).toBe(2);
    expect(s.total).toBe(334);
  });

  it("keeps base equal to its own components, exactly", () => {
    const s = ps();
    expect(s.batting + s.bowling + s.fielding + s.bonuses + s.secondInningsAdjustment).toBe(
      s.base,
    );
  });

  it("rounds the WHOLE second innings once, never per event", () => {
    // The distinction that matters, and the one D28(b) warns G1 would catch:
    // halving each of the four second-innings components and rounding each would
    // give 12 (23→11.5→12) + 10 (19→9.5→10) + 8 (15→7.5→8) + 1 (2→1→1) = 31,
    // not 30. One point, every two-innings match, forever.
    const perEvent =
      Math.round(23 * 0.5) + Math.round(19 * 0.5) + Math.round(15 * 0.5) + Math.round(2 * 0.5);
    expect(perEvent).toBe(31);
    expect(ps().base).toBe(137 + 30);
    expect(ps().base).not.toBe(137 + perEvent);
  });

  it("applies captaincy AFTER the multiplier, not before (D28a)", () => {
    // Doubling first would give (137 + 59)·2 = 392, then halving the second
    // innings would land somewhere else entirely. The ruling is explicit that the
    // ×2 lands on the post-multiplier match total.
    expect(ps().total).toBe(167 * 2);
    expect(ps().total).not.toBe((137 + 59) * 2);
  });
});

describe("D28 — a multiplier of 1.0 is arithmetically inert", () => {
  it("leaves the same card completely unmultiplied under the FIXTURE config", () => {
    // This is why G1 cannot move: the frozen fixture config holds 1.0, so the
    // adjustment term is 0 and base is the plain sum it always was.
    const s = scoreMatch(TWO_INNINGS_CARD, FIXTURE_CONFIG.scoring).scores.get("skip")!;
    expect(s.secondInningsAdjustment).toBe(0);
    expect(s.base).toBe(s.batting + s.bowling + s.fielding + s.bonuses);
  });

  it("treats a one-innings card identically under both economies", () => {
    // No innings 2 → nothing for the multiplier to act on, whatever it is set to.
    const oneInnings = battingCard({ runs: 30, ballsFaced: 25, fours: 3 });
    const halved = scoreMatch(oneInnings, cfg).scores.get("solo")!;
    const whole = scoreMatch(oneInnings, { ...cfg, secondInningsMultiplier: 1 }).scores.get(
      "solo",
    )!;
    expect(halved.secondInningsAdjustment).toBe(0);
    expect(halved.base).toBe(whole.base);
  });
});
