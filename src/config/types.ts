/**
 * Config schema for the economy. Every engine reads its parameters from a
 * `LeagueConfig` instance — never from constants baked into code (KICKOFF,
 * "THE THREE ENGINES": "all parameters from config tables, never constants").
 *
 * Config is tunable pre-season and frozen by SEASON LOCK (D13). Gates run
 * against the FIXTURE CONFIG (DEFINITION_OF_DONE §"FIXTURE CONFIG"); the real
 * season economy (O1–O5) is decided at season lock. Changing these values must
 * NOT require a code change (Gate G11).
 */

export type PlayerRole = "BAT" | "WK" | "BWL" | "AR";

/** Scoring point values and bonus thresholds. Fixture defaults: DoD §FIXTURE
 *  CONFIG. Season defaults for veto: DECISION_LOG O4/O5. */
export interface ScoringConfig {
  /** Points per run scored (O4: run 1). */
  perRun: number;
  /** Bonus points per four, ON TOP of the 4 runs (O4: four +1). */
  perFour: number;
  /** Bonus points per six, ON TOP of the 6 runs (O4: six +2). */
  perSix: number;
  /** Points per wicket taken by the bowler (O4: wicket 25). */
  perWicket: number;
  /** Points per outfield catch (O4: catch 8). */
  perCatch: number;
  /** Points per wicket-keeper catch (O4: keeper catch 8). */
  perKeeperCatch: number;
  /** Points per stumping (O4: stumping 10). */
  perStumping: number;
  /** Points per unassisted run-out (O4: runout unassisted 10). */
  perRunOutUnassisted: number;
  /** Points per assisted run-out, credited to EACH participant (O4: assisted 5). */
  perRunOutAssisted: number;

  /** Strike-rate bonus (O5). Awarded once if SR >= srBonusMinStrikeRate over
   *  at least srBonusMinBalls balls faced. */
  srBonusPoints: number;
  srBonusMinStrikeRate: number;
  srBonusMinBalls: number;

  /** Economy bonus (O5). Awarded once if economy <= econBonusMaxEconomy over at
   *  least econBonusMinOvers overs bowled. */
  econBonusPoints: number;
  econBonusMaxEconomy: number;
  econBonusMinOvers: number;
}

/** Pricing engine parameters (D1, D4/A1, O6, O7). */
export interface PricingConfig {
  /** Exponential-moving-average weight on the latest match (D1/O7: α 0.20). */
  alpha: number;
  /** Dollars per fantasy point (D1: $/pt $1,000). */
  dollarsPerPoint: number;
  /** Price floor; no price ever sits below this (D1/O6: $9,000). */
  floor: number;
  /** Rounding increment for ALL price arithmetic (D4: nearest $100). */
  roundingIncrement: number;
  /**
   * Starting-price interpolation cap on games considered (D4/A1). Starting
   * price ramps floor -> full performance pricing linearly over games 1..cap.
   */
  startingPriceGamesCap: number;
}

/** Team-composition and cap parameters (O1, O2, O3). Schema only for the engine
 *  core; enforcement of composition lives with the (later) team-selection UI. */
export interface SquadConfig {
  /** Total players in a fantasy team (O2). */
  teamSize: number;
  /** Required count per role (O2). Keys sum to teamSize. */
  composition: Record<PlayerRole, number>;
  /** Starting salary cap (O3 / DoD fixture). */
  cap: number;
  /** Trades allowed per round (O1). */
  tradesPerRound: number;
}

export interface LeagueConfig {
  scoring: ScoringConfig;
  pricing: PricingConfig;
  squad: SquadConfig;
}
