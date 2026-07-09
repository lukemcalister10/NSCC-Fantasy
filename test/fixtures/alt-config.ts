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
 */
export const ALT_CONFIG: LeagueConfig = {
  scoring: {
    perRun: 2,
    perFour: 2,
    perSix: 4,
    perWicket: 20,
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
  },
  pricing: {
    alpha: 0.25,
    dollarsPerPoint: 2000,
    floor: 20_000,
    roundingIncrement: 100,
    startingPriceGamesCap: 4,
  },
  squad: {
    teamSize: 5,
    composition: { BAT: 2, WK: 1, BWL: 1, AR: 1 },
    cap: 2_000_000,
    tradesPerRound: 3,
  },
};
