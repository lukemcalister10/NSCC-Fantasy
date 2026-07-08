import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { scoreMatch } from "../src/engines/scoring.js";
import {
  repriceAfterMatch,
  repriceOverMatches,
} from "../src/engines/pricing.js";
import { roundToIncrement } from "../src/engines/rounding.js";
import type { MatchScorecard } from "../src/types.js";

const pricing = FIXTURE_CONFIG.pricing;
const scoring = FIXTURE_CONFIG.scoring;

describe("G7 PRICE_FORMULA", () => {
  it("$60,000 player scores 100 -> $68,000 exactly", () => {
    // 0.8·60000 + 0.2·(100·1000) = 48000 + 20000 = 68000.
    expect(repriceAfterMatch(60_000, 100, pricing)).toBe(68_000);
  });

  it("rounds a raw result to the nearest $100 (half up)", () => {
    // Gate wording: a $61,730-equivalent raw result rounds to $61,700.
    expect(roundToIncrement(61_730, 100)).toBe(61_700);
    // A raw result ending in $x50 rounds UP.
    expect(roundToIncrement(61_750, 100)).toBe(61_800);
    // Rounding is exercised inside the formula too:
    // 0.8·61100 = 48880; +0.2·10·1000 = 2000 -> 50880 -> 50900.
    expect(repriceAfterMatch(61_100, 10, pricing)).toBe(50_900);
  });

  it("clamps at the $9,000 floor when the path would cross it", () => {
    // 0.8·10000 = 8000 < 9000 -> floor.
    expect(repriceAfterMatch(10_000, 0, pricing)).toBe(9_000);
    // Already at floor, another 0 stays at floor.
    expect(repriceAfterMatch(9_000, 0, pricing)).toBe(9_000);
  });

  it("two matches in one round = two sequential movements", () => {
    // Step 1: 60000 scores 100 -> 68000. Step 2: 68000 scores 0 -> 54400.
    expect(repriceOverMatches(60_000, [100, 0], pricing)).toBe(54_400);
    // Equivalent to applying each movement independently.
    const afterFirst = repriceAfterMatch(60_000, 100, pricing);
    expect(repriceAfterMatch(afterFirst, 0, pricing)).toBe(54_400);
  });
});

describe("G5 DNP_PRICE_FREEZE", () => {
  it("named player who scores 0 falls per formula ($60,000 -> $48,000)", () => {
    expect(repriceAfterMatch(60_000, 0, pricing)).toBe(48_000);
  });

  it("DNP player produces no score row, so pricing has nothing to apply (price frozen)", () => {
    const card: MatchScorecard = {
      matchId: "G5-DNP",
      lineup: ["bob"], // dan is NOT named -> DNP
      captain: "bob",
      viceCaptain: "bob",
      clubBatting: [{ player: "bob", runs: 0, ballsFaced: 5, fours: 0, sixes: 0 }],
      clubBowling: [],
      oppositionDismissals: [],
    };
    const result = scoreMatch(card, scoring);
    // dan absent from lineup -> excluded from this match entirely (D2).
    expect(result.scores.has("dan")).toBe(false);
    // bob played and scored 0 -> his price would move (D3); confirm at pricing layer.
    expect(result.scores.get("bob")!.played).toBe(true);
    expect(repriceAfterMatch(60_000, result.scores.get("bob")!.total, pricing)).toBe(48_000);
  });
});
