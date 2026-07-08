import type { PricingConfig } from "../config/types.js";
import { roundToIncrement } from "./rounding.js";

/**
 * PRICING ENGINE (KICKOFF Engine 2).
 *
 *   new_price = (1 − α)·old_price + α·(match_score × $/pt)
 *
 * rounded to the nearest increment (half up, D4) and floored (D1). One movement
 * per completed match. DNP (not named in lineup) freezes the price and the match
 * is excluded from pricing history (D2) — callers simply do not invoke this for
 * a DNP player. A played player reprices even on a score of 0 (D3).
 *
 * Gates: G5 (played-0 falls, DNP frozen), G7 (formula, rounding, floor clamp).
 */
export function repriceAfterMatch(
  oldPrice: number,
  matchScore: number,
  cfg: PricingConfig,
): number {
  const raw =
    (1 - cfg.alpha) * oldPrice + cfg.alpha * (matchScore * cfg.dollarsPerPoint);
  const rounded = roundToIncrement(raw, cfg.roundingIncrement);
  return Math.max(rounded, cfg.floor);
}

/**
 * Apply a sequence of match scores in order (D7: two matches in one two-week
 * round produce two sequential movements — G7). Returns the final price; each
 * step is independently rounded and floored, matching per-match repricing.
 */
export function repriceOverMatches(
  startPrice: number,
  matchScores: readonly number[],
  cfg: PricingConfig,
): number {
  return matchScores.reduce(
    (price, score) => repriceAfterMatch(price, score, cfg),
    startPrice,
  );
}
