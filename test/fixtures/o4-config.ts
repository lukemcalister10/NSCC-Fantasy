import { FIXTURE_CONFIG } from "../../src/config/fixture.js";
import type { LeagueConfig } from "../../src/config/types.js";

/**
 * THE OPERATOR'S CHOSEN ECONOMY (O4), as a test fixture.
 *
 * This is not a third arbitrary economy invented to prove config-drivenness —
 * ALT_CONFIG already does that. It is O4's actual draft values, written out so
 * the engine's arithmetic can be checked against the numbers the operator will
 * type into /admin/settings before season lock:
 *
 *   run 1 · 50 bonus 10 · 100 bonus 20 · duck −5 · not-out 5 · four 1 · six 3 ·
 *   wicket 19 · maiden 1 · 5WI 10 · outfield catch 10 · runout 15 (both kinds) ·
 *   WK catch 10 · stumping 15 · NO strike-rate bonuses ·
 *   economy bonus = floor(max(0, 0.25 × (balls bowled − runs conceded)))
 *
 * SECOND-INNINGS MULTIPLIER 0.5 — the 26/27 season value (D28). The FIXTURE
 * config keeps 1.0; that split is the whole reason G1 does not move.
 *
 * O5's threshold-style SR and economy bonuses are ZERO here, which is O5's own
 * status: superseded by O4, retained in the schema for the fixture config and any
 * future revival. Their thresholds are left at the fixture's values because a
 * threshold multiplied by zero points is inert either way — what matters is that
 * they are present, so the reshape deleted nothing.
 *
 * PROVISIONAL, like O4 itself: open until season lock. Nothing here is a default;
 * pricing and squad are borrowed from the fixture so this file changes exactly one
 * thing — the scoring economy.
 */
export const O4_CONFIG: LeagueConfig = {
  ...FIXTURE_CONFIG,
  scoring: {
    perRun: 1,
    perFour: 1,
    perSix: 3,
    perFifty: 10,
    perCentury: 20,
    perDuck: -5,
    perNotOut: 5,
    perWicket: 19,
    perMaiden: 1,
    perFiveWicketHaul: 10,
    perCatch: 10,
    perKeeperCatch: 10,
    perStumping: 15,
    perRunOutUnassisted: 15,
    perRunOutAssisted: 15,
    srBonusPoints: 0,
    srBonusMinStrikeRate: FIXTURE_CONFIG.scoring.srBonusMinStrikeRate,
    srBonusMinBalls: FIXTURE_CONFIG.scoring.srBonusMinBalls,
    econBonusPoints: 0,
    econBonusMaxEconomy: FIXTURE_CONFIG.scoring.econBonusMaxEconomy,
    econBonusMinOvers: FIXTURE_CONFIG.scoring.econBonusMinOvers,
    econBonusPerNetBall: 0.25,
    secondInningsMultiplier: 0.5,
  },
};
