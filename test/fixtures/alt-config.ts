import type { LeagueConfig } from "../../src/config/types.js";

/**
 * ALTERNATE fixture economy for Gate G11 (CONFIG_ECONOMY). A second, fully
 * distinct `LeagueConfig` — different scoring point values, bonus amounts, cap,
 * team size and composition — used to re-run the G1 and G2 gate logic. Because
 * the engines carry no economy constants, swapping in this config (DATA only)
 * reproduces correct results with ZERO change to `src/engines/*` or
 * `src/config/types.ts`. Thresholds (SR ≥ 150, econ ≤ 3.0, min balls/overs) are
 * held identical to the fixture so the same bonus edges apply; the POINT VALUES
 * all change, which is what G11 proves is config-driven.
 *
 * THE O4 KEYS ADDED BY THE ENGINE SLICE. Those that are INERT on the two
 * reference scorecards carry values that DIFFER from the fixture (not-out,
 * maiden, 5WI and the second-innings multiplier — the cards contain no unbeaten
 * innings, no maidens, no five-for and no second innings), so they are covered by
 * the settings page's "the two economies really are different" sweep. Those that
 * WOULD bite on these cards (the milestone bonuses, the duck, the continuous
 * economy bonus) are held at zero here on purpose: this file's expectations in
 * test/g11.config-economy.test.ts are hand-scored, and leaving them arithmetically
 * untouched is what lets the G11 artifact stand unmoved beside the G1 one. The new
 * keys are exercised against their own hand-scored card in
 * test/o4.scoring-shape.test.ts, under the season-shaped config in ./o4-config.ts.
 */
export const ALT_CONFIG: LeagueConfig = {
  scoring: {
    perRun: 2,
    perFour: 2,
    perSix: 4,
    perFifty: 0,
    perCentury: 0,
    perDuck: 0,
    perNotOut: 7,
    perWicket: 20,
    perMaiden: 3,
    perFiveWicketHaul: 25,
    perCatch: 10,
    perKeeperCatch: 12,
    perStumping: 15,
    perRunOutUnassisted: 12,
    perRunOutAssisted: 6,
    srBonusPoints: 20,
    srBonusMinStrikeRate: 150,
    srBonusMinBalls: 10,
    econBonusPoints: 20,
    econBonusMaxEconomy: 3.0,
    econBonusMinOvers: 3,
    econBonusPerNetBall: 0,
    secondInningsMultiplier: 0.5,
  },
  pricing: {
    alpha: 0.25,
    dollarsPerPoint: 2000,
    floor: 20_000,
    roundingIncrement: 100,
    startingPriceGamesCap: 4,
  },
  squad: {
    // Reshaped semantics (A7/O2): role MINIMUMS + total size. Minimums sum to
    // teamSize 5 → flex 0; G11 reads only squad.cap, so the rename is inert to it.
    teamSize: 5,
    roleMinimums: { BAT: 2, WK: 1, BWL: 1, AR: 1 },
    cap: 2_000_000,
    tradesPerRound: 3,
  },
};
