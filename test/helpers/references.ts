import type { ScoringConfig } from "../../src/config/types.js";
import { scoreMatch } from "../../src/engines/scoring.js";
import type { MatchScorecard } from "../../src/types.js";

/**
 * Shared G1 driver: post-captaincy `total` per player for one scorecard under a
 * given scoring config. Used by both the FIXTURE_CONFIG gate (test/scoring.test.ts)
 * and the alternate-config gate (test/g11.config-economy.test.ts, Gate G11), so
 * the SAME engine logic is exercised under two economies with NO engine change.
 */
export function referenceTotals(
  card: MatchScorecard,
  cfg: ScoringConfig,
): Record<string, number> {
  const result = scoreMatch(card, cfg);
  const out: Record<string, number> = {};
  for (const [player, ps] of result.scores) out[player] = ps.total;
  return out;
}
