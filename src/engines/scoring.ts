import type { ScoringConfig } from "../config/types.js";
import type {
  MatchScorecard,
  MatchScoreResult,
  PlayerScore,
} from "../types.js";
import { parseDismissal } from "./dismissal.js";

/**
 * SCORING ENGINE (KICKOFF Engine 1). Config-driven fantasy points per player
 * for one completed match, including captain ×2 with vice-captain inheritance
 * (D10). Every value read from `ScoringConfig` — no scoring constant in code.
 *
 * Gates: G1 (reference scorecards reproduce hand-scored points exactly,
 * including the SR-bonus edge and dismissal-string fielding) and G8 (captaincy).
 */

/** Convert cricket over notation (whole + balls/10) to a ball count. */
export function oversToBalls(overs: number): number {
  const whole = Math.trunc(overs + 1e-9);
  // Balls portion is the first decimal digit (0..5).
  const ballsPart = Math.round((overs - whole) * 10);
  return whole * 6 + ballsPart;
}

function battingPoints(
  runs: number,
  fours: number,
  sixes: number,
  cfg: ScoringConfig,
): number {
  return runs * cfg.perRun + fours * cfg.perFour + sixes * cfg.perSix;
}

function strikeRateBonus(
  runs: number,
  ballsFaced: number,
  cfg: ScoringConfig,
): number {
  if (ballsFaced < cfg.srBonusMinBalls) return 0;
  const sr = (runs / ballsFaced) * 100;
  return sr >= cfg.srBonusMinStrikeRate ? cfg.srBonusPoints : 0;
}

function economyBonus(
  runsConceded: number,
  balls: number,
  cfg: ScoringConfig,
): number {
  if (balls < cfg.econBonusMinOvers * 6) return 0;
  const economy = runsConceded / (balls / 6);
  return economy <= cfg.econBonusMaxEconomy ? cfg.econBonusPoints : 0;
}

export function scoreMatch(
  card: MatchScorecard,
  cfg: ScoringConfig,
): MatchScoreResult {
  const inLineup = new Set(card.lineup);

  // Seed every lineup player at zero so a named player who did nothing still
  // scores 0 and prices off it (D3 "played = price adjusts even on 0").
  const scores = new Map<string, PlayerScore>();
  for (const player of card.lineup) {
    scores.set(player, {
      player,
      played: true,
      batting: 0,
      bowling: 0,
      fielding: 0,
      bonuses: 0,
      base: 0,
      captainMultiplier: 1,
      total: 0,
    });
  }

  const ensure = (player: string): PlayerScore | undefined => {
    // Only credit players named in the lineup; anyone else is not in the pool
    // for this match (e.g. an opposition fielder token, or a sub).
    if (!inLineup.has(player)) return undefined;
    return scores.get(player);
  };

  // Batting.
  for (const line of card.clubBatting) {
    const ps = ensure(line.player);
    if (!ps) continue;
    ps.batting += battingPoints(line.runs, line.fours, line.sixes, cfg);
    ps.bonuses += strikeRateBonus(line.runs, line.ballsFaced, cfg);
  }

  // Bowling.
  for (const line of card.clubBowling) {
    const ps = ensure(line.player);
    if (!ps) continue;
    ps.bowling += line.wickets * cfg.perWicket;
    ps.bonuses += economyBonus(line.runsConceded, oversToBalls(line.overs), cfg);
  }

  // Fielding — parsed from opposition dismissal strings.
  for (const dismissal of card.oppositionDismissals) {
    for (const credit of parseDismissal(dismissal)) {
      const ps = ensure(credit.fielder);
      if (!ps) continue;
      if (credit.kind === "catch") {
        const isKeeper = card.wicketKeeper === credit.fielder;
        ps.fielding += isKeeper ? cfg.perKeeperCatch : cfg.perCatch;
      } else if (credit.kind === "stumping") {
        ps.fielding += cfg.perStumping;
      } else {
        ps.fielding += credit.assisted
          ? cfg.perRunOutAssisted
          : cfg.perRunOutUnassisted;
      }
    }
  }

  // Base totals.
  for (const ps of scores.values()) {
    ps.base = ps.batting + ps.bowling + ps.fielding + ps.bonuses;
    ps.total = ps.base;
  }

  // Captaincy ×2 with VC inheritance (D10). DNP = not named in lineup.
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
