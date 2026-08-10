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

/**
 * Scoring point values and bonus thresholds. Fixture values: DoD §FIXTURE CONFIG
 * (FROZEN). Season values: DECISION_LOG O4/O5, chosen at season lock.
 *
 * EVERYTHING IS PER INNINGS (operator ruling, 10/08/2026, resolving O4's open
 * per-innings-vs-per-match sub-item): "each innings a separate instance, and then
 * those two values added to the match score like all are". Every value below is
 * earned in the innings whose line produced it — including the economy bonus —
 * and a second-innings earning is therefore multiplied by
 * `secondInningsMultiplier` along with everything else in that innings. There is
 * no per-match exemption and no special case (D27/D28).
 */
export interface ScoringConfig {
  /** Points per run scored (O4: run 1). */
  perRun: number;
  /** Bonus points per four, ON TOP of the 4 runs (O4: four +1). */
  perFour: number;
  /** Bonus points per six, ON TOP of the 6 runs (O4: six +3). */
  perSix: number;
  /**
   * Milestone bonus for a fifty in an innings (O4: 50 bonus 10).
   * EXCLUSIVE of `perCentury` — operator ruling, 10/08/2026: the century bonus
   * REPLACES the fifty bonus, it does not stack. A hundred scores `perCentury`
   * alone, never `perFifty + perCentury`. O4 lists the two as separate lines,
   * which reads as cumulative if nobody says otherwise; this is that ruling.
   */
  perFifty: number;
  /** Milestone bonus for a century in an innings (O4: 100 bonus 20). Replaces
   *  `perFifty` rather than adding to it — see above. */
  perCentury: number;
  /**
   * Points for a duck (O4: duck −5, i.e. a NEGATIVE value in config, so the
   * settings page shows the operator's own number). A duck is DISMISSED for 0;
   * an unbeaten 0 is not a duck at any total, which is why `not_out` had to be
   * captured in raw truth (migration 0006) — it is not derivable from runs.
   */
  perDuck: number;
  /** Points for an unbeaten innings (O4: not-out 5). */
  perNotOut: number;
  /** Points per wicket taken by the bowler (O4: wicket 19). */
  perWicket: number;
  /** Points per maiden over bowled (O4: maiden 1). */
  perMaiden: number;
  /**
   * Bonus for a five-wicket haul (O4: 5WI 10). PER INNINGS by the term's own
   * meaning — "five wickets in an innings" — and one bowling line IS one innings
   * (0006 keys bowling_lines on (scorecard_id, innings, player_id)).
   */
  perFiveWicketHaul: number;
  /** Points per outfield catch (O4: catch 10). */
  perCatch: number;
  /** Points per wicket-keeper catch (O4: keeper catch 10). */
  perKeeperCatch: number;
  /** Points per stumping (O4: stumping 15). */
  perStumping: number;
  /** Points per unassisted run-out (O4: runout 15, both kinds). */
  perRunOutUnassisted: number;
  /** Points per assisted run-out, credited to EACH participant (O4: runout 15). */
  perRunOutAssisted: number;

  /** Strike-rate bonus (O5, SUPERSEDED by O4 and held at ZERO in the season
   *  config; retained in the schema for the fixture config and any future
   *  revival). Awarded once per innings if SR >= srBonusMinStrikeRate over at
   *  least srBonusMinBalls balls faced. */
  srBonusPoints: number;
  srBonusMinStrikeRate: number;
  srBonusMinBalls: number;

  /** THRESHOLD-STYLE economy bonus (O5, same status as the SR bonus above).
   *  Awarded once per innings if economy <= econBonusMaxEconomy over at least
   *  econBonusMinOvers overs bowled. */
  econBonusPoints: number;
  econBonusMaxEconomy: number;
  econBonusMinOvers: number;

  /**
   * CONTINUOUS economy bonus (O4, the one the season actually uses):
   *   floor(max(0, econBonusPerNetBall × (balls bowled − runs conceded)))
   * O4 sets the rate to 0.25, with NO minimum-overs threshold and NO penalty
   * above 6/over (the max(0,…) clamp is that "no penalty").
   *
   * The floor and the clamp are applied PER INNINGS (operator ruling,
   * 10/08/2026), so the fractional remainder is discarded once per innings and
   * the bonus is part of that innings' earnings for multiplier purposes. Zero in
   * the fixture config, which is what keeps the frozen gates untouched.
   */
  econBonusPerNetBall: number;

  /**
   * SECOND-INNINGS MULTIPLIER (D28 / O4, added A10). In a match where a team
   * bats and fields twice, everything a player earns in their team's SECOND
   * innings is totalled, multiplied by this, rounded HALF UP, and added to their
   * first-innings total: ONE multiplication and ONE rounding per player per
   * match, never per event, so match scores stay whole (O4).
   *
   * DEFAULT 1.0 — and 1.0 in the FROZEN fixture config, which is why G1's two
   * reference scorecards are byte-identical across this change. The 26/27 season
   * value is 0.5. Config, not a constant (D13).
   *
   * `innings` here is the CLUB's own sequence (D27), not ICC four-innings
   * numbering: innings 1 is unmultiplied, innings 2 and beyond are multiplied.
   */
  secondInningsMultiplier: number;
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
 *  core; enforcement of composition lives with the (later) selection-validation
 *  slice — this type carries NO validation logic, only the reshaped shape (A7). */
export interface SquadConfig {
  /** Total players in a fantasy team (O2). */
  teamSize: number;
  /**
   * MINIMUM required count per role (O2/A7, supersedes the old exact-count
   * `composition`). Semantics: Σ minimums ≤ teamSize; the remainder
   *   FLEX = teamSize − Σ minimums
   * is an unconstrained wildcard fillable by ANY role. Role counting is STRICT —
   * a player fills only its own role's minimum (an AR never counts toward BAT);
   * flex is the only wildcard slot. The WK minimum is satisfiable by a WK-role
   * OR a `wk_eligible` player (D9, the only dual eligibility). Enforcement of
   * these minimums lands with the later selection-validation slice (no gate yet).
   */
  roleMinimums: Record<PlayerRole, number>;
  /** Salary cap (O3). Computed BY the season-lock action as
   *  teamSize × mean(starting_price) over the pool, rounded to nearest $100
   *  (D4). Pre-lock this is a tunable placeholder, overwritten at lock. */
  cap: number;
  /** Trades allowed per round (O1). */
  tradesPerRound: number;
}

export interface LeagueConfig {
  scoring: ScoringConfig;
  pricing: PricingConfig;
  squad: SquadConfig;
}
