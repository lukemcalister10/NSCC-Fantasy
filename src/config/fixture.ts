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
 *
 * THE O4 KEYS ADDED BY THE ENGINE SLICE ARE NEUTRAL HERE, DELIBERATELY. The DoD
 * fixture config is FROZEN (Law 3) and names no milestone, duck, not-out, maiden,
 * 5WI or continuous-economy value, so each of those is 0 and the second-innings
 * multiplier is 1.0. That is not a placeholder: it is what makes G1's two
 * hand-scored reference scorecards arithmetically INCAPABLE of moving across the
 * reshape — every frozen number is multiplied by 1 or added to 0. The season
 * values (O4) live in seasons.config and are chosen at lock, never here.
 */
export const FIXTURE_CONFIG: LeagueConfig = {
  scoring: {
    perRun: 1,
    perFour: 1,
    perSix: 2,
    perFifty: 0,
    perCentury: 0,
    perDuck: 0,
    perNotOut: 0,
    perWicket: 25,
    perMaiden: 0,
    perFiveWicketHaul: 0,
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
    econBonusPerNetBall: 0,
    secondInningsMultiplier: 1.0,
  },
  pricing: {
    alpha: 0.2,
    dollarsPerPoint: 1000,
    floor: 9000,
    roundingIncrement: 100,
    startingPriceGamesCap: 4,
  },
  squad: {
    // Reshaped semantics (A7/O2): role MINIMUMS + total size, flex = size − Σ min.
    // Fixture keeps the DoD "2 BAT / 1 WK / 2 BWL / 1 AR" as minimums summing to
    // teamSize 6 → flex 0 (faithful to DEFINITION_OF_DONE §FIXTURE CONFIG).
    teamSize: 6,
    roleMinimums: { BAT: 2, WK: 1, BWL: 2, AR: 1 },
    cap: 1_000_000,
    tradesPerRound: 2,
  },
};
