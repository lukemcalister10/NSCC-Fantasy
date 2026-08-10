import type { ScoringConfig } from "../config/types.js";
import type {
  BattingLine,
  BowlingLine,
  MatchScorecard,
  MatchScoreResult,
  PlayerScore,
} from "../types.js";
import { dismissalEntry, inningsOf } from "../types.js";
import { parseDismissal } from "./dismissal.js";
import { roundToIncrement } from "./rounding.js";

/**
 * SCORING ENGINE (KICKOFF Engine 1). Config-driven fantasy points per player for
 * one completed match, including captain ×2 with vice-captain inheritance (D10).
 * Every value read from `ScoringConfig` — no scoring constant in code (D13/G11).
 *
 * Gates: G1 (reference scorecards reproduce hand-scored points exactly, including
 * the SR-bonus edge and dismissal-string fielding) and G8 (captaincy).
 *
 * ── EVERYTHING IS PER INNINGS ────────────────────────────────────────────────
 * Operator ruling, 10/08/2026, resolving O4's open per-innings-vs-per-match
 * sub-item: "each innings a separate instance, and then those two values added to
 * the match score like all are". So every quantity this engine computes —
 * milestone bonuses, ducks, not-outs, maidens, five-fors, the strike-rate bonus
 * and BOTH economy bonuses — is computed on the line that produced it, i.e. on
 * one innings' figures. Nothing is aggregated to match level first.
 *
 * That ruling is what makes the second-innings multiplier (D28) simple and
 * uniform: because a bonus is EARNED IN an innings, a second-innings bonus is
 * multiplied along with everything else in that innings. There is no per-match
 * exemption and no special case — a bowler's second-innings work is worth the
 * multiplier across the board, wickets, maidens and economy alike.
 *
 * ── THE MULTIPLIER, EXACTLY (D28/O4) ─────────────────────────────────────────
 *   base = firstInningsEarnings + round_half_up(secondInningsEarnings × m)
 * ONE multiplication and ONE rounding per player per match — NEVER per event, or
 * match scores would stop being whole numbers and G1 would move. Captain doubling
 * (D10) applies to `base`, hence AFTER the multiplier, as the ruling requires.
 *
 * `innings` is the CLUB's own sequence (D27): 1 is unmultiplied, 2-and-beyond are
 * multiplied. Lines carrying no innings are innings 1, which is why a one-innings
 * card (and G1's two reference scorecards) never touches this path at all.
 */

/** Convert cricket over notation (whole + balls/10) to a ball count. */
export function oversToBalls(overs: number): number {
  const whole = Math.trunc(overs + 1e-9);
  // Balls portion is the first decimal digit (0..5).
  const ballsPart = Math.round((overs - whole) * 10);
  return whole * 6 + ballsPart;
}

/**
 * Absorbs binary floating-point drift before a floor, so a continuous-economy
 * result that is mathematically 9 but stored as 8.999999999 floors to 9 rather
 * than 8. Same purpose and magnitude as the price rounder's epsilon.
 */
const FLOOR_EPSILON = 1e-9;

/** O4's "round HALF UP to a whole number" — D4's convention at increment 1. */
function roundHalfUp(value: number): number {
  return roundToIncrement(value, 1);
}

/**
 * Batting points for ONE innings: runs and boundaries, the milestone bonus, and
 * the duck / not-out terms.
 *
 * MILESTONES ARE EXCLUSIVE, NOT CUMULATIVE (operator ruling, 10/08/2026): a
 * century scores `perCentury` ALONE — it REPLACES the fifty bonus rather than
 * stacking on it, so 100 runs is 20 and not 10 + 20. O4 lists "50 bonus 10" and
 * "100 bonus 20" as separate lines, which reads as cumulative if nobody says
 * otherwise; this is the ruling that says otherwise.
 *
 * DUCK vs NOT OUT: a duck is being DISMISSED for 0. An unbeaten 0 is not a duck,
 * and an unbeaten score is not a duck at any total — which is why `not_out` is
 * captured in raw truth (migration 0006) rather than inferred from runs. The two
 * terms are therefore mutually exclusive by construction.
 */
function battingPoints(line: BattingLine, cfg: ScoringConfig): number {
  const notOut = line.notOut === true;
  const milestone =
    line.runs >= 100 ? cfg.perCentury : line.runs >= 50 ? cfg.perFifty : 0;
  const duckOrNotOut = notOut
    ? cfg.perNotOut
    : line.runs === 0
      ? cfg.perDuck
      : 0;
  return (
    line.runs * cfg.perRun +
    line.fours * cfg.perFour +
    line.sixes * cfg.perSix +
    milestone +
    duckOrNotOut
  );
}

/** Bowling points for ONE innings: wickets, maidens, and the five-for. */
function bowlingPoints(line: BowlingLine, cfg: ScoringConfig): number {
  const fiveFor = line.wickets >= 5 ? cfg.perFiveWicketHaul : 0;
  return line.wickets * cfg.perWicket + (line.maidens ?? 0) * cfg.perMaiden + fiveFor;
}

/** Threshold-style strike-rate bonus (O5), evaluated on ONE innings' figures. */
function strikeRateBonus(
  runs: number,
  ballsFaced: number,
  cfg: ScoringConfig,
): number {
  if (ballsFaced < cfg.srBonusMinBalls) return 0;
  const sr = (runs / ballsFaced) * 100;
  return sr >= cfg.srBonusMinStrikeRate ? cfg.srBonusPoints : 0;
}

/**
 * Economy bonuses for ONE innings — both flavours, summed:
 *
 *   THRESHOLD (O5, retained in the schema, zero in the season config): a flat
 *   award if economy <= max over at least a minimum number of overs.
 *
 *   CONTINUOUS (O4, the one the season uses):
 *     floor(max(0, econBonusPerNetBall × (balls bowled − runs conceded)))
 *   No minimum-overs threshold and no penalty above 6/over — the max(0, …) clamp
 *   IS that "no penalty". The floor and the clamp both apply per innings, so the
 *   fractional remainder is discarded once per innings (operator ruling).
 */
function economyBonus(
  runsConceded: number,
  balls: number,
  cfg: ScoringConfig,
): number {
  let bonus = 0;

  if (balls >= cfg.econBonusMinOvers * 6 && balls > 0) {
    const economy = runsConceded / (balls / 6);
    if (economy <= cfg.econBonusMaxEconomy) bonus += cfg.econBonusPoints;
  }

  const net = cfg.econBonusPerNetBall * (balls - runsConceded);
  if (net > 0) bonus += Math.floor(net + FLOOR_EPSILON);

  return bonus;
}

export function scoreMatch(
  card: MatchScorecard,
  cfg: ScoringConfig,
): MatchScoreResult {
  const inLineup = new Set(card.lineup);

  // Seed every lineup player at zero so a named player who did nothing still
  // scores 0 and prices off it (D3 "played = price adjusts even on 0").
  const scores = new Map<string, PlayerScore>();
  // Per player, per innings: face-value earnings, the input to the D28 multiplier.
  const earnings = new Map<string, Map<number, number>>();

  for (const player of card.lineup) {
    scores.set(player, {
      player,
      played: true,
      batting: 0,
      bowling: 0,
      fielding: 0,
      bonuses: 0,
      secondInningsAdjustment: 0,
      base: 0,
      captainMultiplier: 1,
      total: 0,
    });
    earnings.set(player, new Map<number, number>());
  }

  const ensure = (player: string): PlayerScore | undefined => {
    // Only credit players named in the lineup; anyone else is not in the pool
    // for this match (e.g. an opposition fielder token, or a sub).
    if (!inLineup.has(player)) return undefined;
    return scores.get(player);
  };

  /**
   * Credit points to a component AND to the innings that earned them. Every
   * award goes through here, so no path can add to a player's match figure
   * without declaring which innings it belongs to — the invariant the multiplier
   * depends on.
   */
  const credit = (
    ps: PlayerScore,
    innings: number,
    component: "batting" | "bowling" | "fielding" | "bonuses",
    points: number,
  ): void => {
    if (points === 0) return;
    ps[component] += points;
    const byInnings = earnings.get(ps.player)!;
    byInnings.set(innings, (byInnings.get(innings) ?? 0) + points);
  };

  // Batting. Milestones, ducks and not-outs live in `batting` — they are points
  // earned with the bat; `bonuses` keeps its documented meaning of the RATE
  // bonuses (strike rate, economy), so the component columns still read as
  // "what this player earned batting / bowling / fielding".
  for (const line of card.clubBatting) {
    const ps = ensure(line.player);
    if (!ps) continue;
    const innings = inningsOf(line);
    credit(ps, innings, "batting", battingPoints(line, cfg));
    credit(
      ps,
      innings,
      "bonuses",
      strikeRateBonus(line.runs, line.ballsFaced, cfg),
    );
  }

  // Bowling.
  for (const line of card.clubBowling) {
    const ps = ensure(line.player);
    if (!ps) continue;
    const innings = inningsOf(line);
    credit(ps, innings, "bowling", bowlingPoints(line, cfg));
    credit(
      ps,
      innings,
      "bonuses",
      economyBonus(line.runsConceded, oversToBalls(line.overs), cfg),
    );
  }

  // Fielding — parsed from opposition dismissal strings, credited to the innings
  // the wicket fell in (D27), so a second-innings catch is multiplied like the
  // rest of that innings.
  for (const dismissal of card.oppositionDismissals) {
    const { innings, text } = dismissalEntry(dismissal);
    for (const parsed of parseDismissal(text)) {
      const ps = ensure(parsed.fielder);
      if (!ps) continue;
      let points: number;
      if (parsed.kind === "catch") {
        const isKeeper = card.wicketKeeper === parsed.fielder;
        points = isKeeper ? cfg.perKeeperCatch : cfg.perCatch;
      } else if (parsed.kind === "stumping") {
        points = cfg.perStumping;
      } else {
        points = parsed.assisted
          ? cfg.perRunOutAssisted
          : cfg.perRunOutUnassisted;
      }
      credit(ps, innings, "fielding", points);
    }
  }

  // ---- The second-innings multiplier, then base totals (D28) ----------------
  for (const ps of scores.values()) {
    const byInnings = earnings.get(ps.player)!;
    let second = 0;
    for (const [innings, points] of byInnings) {
      if (innings >= 2) second += points;
    }
    // ONE multiplication and ONE rounding, over the whole second innings.
    // m = 1 leaves this exactly 0 without touching the rounder, so the frozen
    // fixture config cannot move a single G1 number through here.
    ps.secondInningsAdjustment =
      second === 0 ? 0 : roundHalfUp(second * cfg.secondInningsMultiplier) - second;

    ps.base =
      ps.batting +
      ps.bowling +
      ps.fielding +
      ps.bonuses +
      ps.secondInningsAdjustment;
    ps.total = ps.base;
  }

  // Captaincy ×2 with VC inheritance (D10), applied to `base` and therefore
  // AFTER the multiplier. DNP = not named in the lineup.
  let effectiveCaptain: string | null = null;
  if (inLineup.has(card.captain)) {
    effectiveCaptain = card.captain;
  } else if (inLineup.has(card.viceCaptain)) {
    effectiveCaptain = card.viceCaptain;
  }
  if (effectiveCaptain) {
    const ps = scores.get(effectiveCaptain)!;
    ps.captainMultiplier = 2;
    ps.total = ps.base * 2;
  }

  return { matchId: card.matchId, scores, effectiveCaptain };
}
