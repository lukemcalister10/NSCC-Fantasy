import { describe, expect, it } from "vitest";
import { CapLedger } from "../src/engines/capLedger.js";
import {
  REF_MATCH_BATTING,
  REF_MATCH_BOWLING,
} from "../src/fixtures/reference-scorecards.js";
import { ALT_CONFIG } from "./fixtures/alt-config.js";
import { referenceTotals } from "./helpers/references.js";

/**
 * G11 CONFIG_ECONOMY — the executable form of "change team size, composition,
 * cap and scoring values → G1/G2 re-run green with NO code change".
 *
 * This file imports the SAME engines (`scoreMatch` via `referenceTotals`, and
 * `CapLedger`) as the fixture-config gates, but drives them with ALT_CONFIG. The
 * expected numbers below are an INDEPENDENT hand-scoring of the two reference
 * scorecards under the alternate point values (mirroring the fixture derivation
 * in test/scoring.test.ts), and an alternate cap-ledger worked example. Nothing
 * under src/engines or src/config/types changes — that is the gate.
 */
describe("G11 CONFIG_ECONOMY — G1 reference scorecards under an alternate config", () => {
  const s = ALT_CONFIG.scoring;

  // Batting-heavy, ALT config (perRun 2, four +2, six +4, wkt 20, catch 10,
  // keeper 12, stump 15, runout 12/6, SR +20, econ +20; captain alice ×2):
  //   alice (C,×2): bat 80·2+10·2+2·4 = 188; SR160 -> +20; outfield catch 10;
  //                 base 218 -> ×2                                        = 436
  //   bob:          bat 45·2+5·2 = 100; SR112.5 no bonus                  = 100
  //   cara (kpr):   bat 18·2+1·2+1·4 = 42; SR200 but 9 balls -> no bonus;
  //                 keeper catch 12 + stumping 15 = 27; base              = 69
  //   dan:          bat 5·2 = 10; 2 wkt·20 = 40; econ 5.0 no bonus        = 50
  //   evan:         bat 2·2 = 4; 2 wkt·20 = 40; econ 7.5 no bonus         = 44
  //   finn (VC,×1): bat 30·2+2·2+1·4 = 68; SR150 -> +20; 1 wkt·20 = 20;
  //                 econ 6.0 no bonus; run-out 12; base                   = 120
  it("reproduces the batting-heavy card under ALT_CONFIG", () => {
    expect(referenceTotals(REF_MATCH_BATTING, s)).toEqual({
      alice: 436,
      bob: 100,
      cara: 69,
      dan: 50,
      evan: 44,
      finn: 120,
    });
  });

  // Bowling/fielding-heavy, ALT config (captain greg DNP -> VC ivan ×2):
  //   hana:         bat 3·2 = 6; 3 wkt·20 = 60; econ 2.5 -> +20;
  //                 c&b catch 10; base                                    = 96
  //   ivan (VC→C):  bat 25·2+2·2+1·4 = 58; SR178.6 -> +20; 2 wkt·20 = 40;
  //                 econ 3.0 -> +20; catch 10; base 148 -> ×2             = 296
  //   jack (kpr):   bat 8·2+1·2 = 18; keeper catch 12 + stumping 15 = 27  = 45
  //   kim:          bat 12·2+1·2 = 26; assisted run-out 6                 = 32
  //   leo:          bat 6·2 = 12; assisted run-out 6                      = 18
  //   mike:         bat 0; 1 wkt·20 = 20; econ 3.0 -> +20; run-out 12     = 52
  it("reproduces the bowling/fielding-heavy card under ALT_CONFIG", () => {
    expect(referenceTotals(REF_MATCH_BOWLING, s)).toEqual({
      hana: 96,
      ivan: 296,
      jack: 45,
      kim: 32,
      leo: 18,
      mike: 52,
    });
  });
});

describe("G11 CONFIG_ECONOMY — G2 cap ledger under an alternate cap", () => {
  it("reproduces a worked example scaled to ALT_CONFIG's $2,000,000 cap", () => {
    const cap = ALT_CONFIG.squad.cap; // $2,000,000
    const ledger = new CapLedger(cap);

    // A full 5-player alt team: buys total $1,920,000 -> cap remaining $80,000.
    ledger.buy("focus", 300_000, 1);
    ledger.buy("p2", 500_000, 1);
    ledger.buy("p3", 500_000, 1);
    ledger.buy("p4", 400_000, 1);
    ledger.buy("p5", 220_000, 1);
    expect(ledger.capRemaining()).toBe(80_000);

    // Focus rises 300k -> 450k.
    const prices: Record<string, number> = {
      focus: 450_000,
      p2: 500_000,
      p3: 500_000,
      p4: 400_000,
      p5: 220_000,
    };
    const priceOf = (id: string): number => prices[id] ?? 0;

    // Invested (Σ current) = 2,070,000; team value = cap remaining + invested
    // = 80,000 + 2,070,000 = 2,150,000 (amended A2). Cap remaining unchanged.
    expect(ledger.investedValue(priceOf)).toBe(2_070_000);
    expect(ledger.teamValue(priceOf)).toBe(2_150_000);
    expect(ledger.capRemaining()).toBe(80_000);

    // Sell focus at the risen price 450k -> cap remaining 530,000.
    ledger.sell("focus", 450_000, 2);
    expect(ledger.capRemaining()).toBe(530_000);
  });
});
