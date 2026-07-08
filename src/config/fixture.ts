import type { LeagueConfig } from "./types.js";

/**
 * FIXTURE CONFIG — the test-only economy the frozen gates run against
 * (DEFINITION_OF_DONE §"FIXTURE CONFIG"). NOT the season defaults; the real
 * economy (O1–O5) is decided at season lock.
 *
 *   cap $1,000,000 · team size 6 (2 BAT / 1 WK / 2 BWL / 1 AR) · α 0.20 ·
 *   $/pt $1,000 · floor $9,000 · rounding nearest $100 · trades 2/round ·
 *   scoring: run 1, four +1, six +2, wicket 25, catch 8 (keeper 8),
 *   stumping 10, runout 10/5, SR bonus +10 if SR ≥ 150 over ≥ 10 balls,
 *   economy bonus +10 if econ ≤ 3.0 over ≥ 3 overs.
 */
export const FIXTURE_CONFIG: LeagueConfig = {
  scoring: {
    perRun: 1,
    perFour: 1,
    perSix: 2,
    perWicket: 25,
    perCatch: 8,
    perKeeperCatch: 8,
    perStumping: 10,
    perRunOutUnassisted: 10,
    perRunOutAssisted: 5,
    srBonusPoints: 10,
    srBonusMinStrikeRate: 150,
    srBonusMinBalls: 10,
    econBonusPoints: 10,
    econBonusMaxEconomy: 3.0,
    econBonusMinOvers: 3,
  },
  pricing: {
    alpha: 0.2,
    dollarsPerPoint: 1000,
    floor: 9000,
    roundingIncrement: 100,
    startingPriceGamesCap: 4,
  },
  squad: {
    teamSize: 6,
    composition: { BAT: 2, WK: 1, BWL: 2, AR: 1 },
    cap: 1_000_000,
    tradesPerRound: 2,
  },
};
