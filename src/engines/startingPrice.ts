import type { PricingConfig } from "../config/types.js";
import { roundToIncrement } from "./rounding.js";

/**
 * STARTING-PRICE ENGINE (DECISION_LOG D4 as amended by A1; KICKOFF Engine 2).
 * Floor-to-performance interpolation over games 1..cap, replacing the superseded
 * v1.0 phantom-game shrinkage.
 *
 *   perf  = $/pt × last-season per-match average
 *   price = floor + (min(g, cap)/cap) × (perf − floor)
 *
 * where g = matches in the lineup last season (the SAME denominator as the
 * average). g = 0 → floor. g ≥ cap → full performance pricing. If perf < floor
 * the result clamps at floor. Rounding: nearest increment, half up (D4).
 * Hand-adjustable pre-season-lock only.
 *
 * Gate: G14 (STARTING_PRICE).
 */
export function startingPrice(
  lastSeasonAveragePoints: number,
  gamesInLineupLastSeason: number,
  cfg: PricingConfig,
): number {
  const g = Math.max(0, Math.trunc(gamesInLineupLastSeason));
  if (g === 0) return cfg.floor;

  const perf = cfg.dollarsPerPoint * lastSeasonAveragePoints;
  if (perf <= cfg.floor) return cfg.floor;

  const ramp = Math.min(g, cfg.startingPriceGamesCap) / cfg.startingPriceGamesCap;
  const raw = cfg.floor + ramp * (perf - cfg.floor);
  const rounded = roundToIncrement(raw, cfg.roundingIncrement);
  return Math.max(rounded, cfg.floor);
}
