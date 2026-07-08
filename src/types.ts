import type { PlayerRole } from "./config/types.js";

/**
 * Domain types. A `MatchScorecard` is written from the CLUB's perspective: only
 * club players (the fantasy pool) are scored. Opposition figures appear only as
 * the source of club fielding/bowling credits.
 *
 * Raw scorecards + frozen config are the ONLY sources of truth (THE PRIME
 * INVARIANT). Everything else — scores, prices, cap, ladder — is derived.
 */

export interface RegistryPlayer {
  /** Stable registry key (also used as the name token in dismissal strings). */
  id: string;
  displayName: string;
  role: PlayerRole;
  /** WK-ELIGIBLE flag — the only dual eligibility (D9). */
  wkEligible?: boolean;
}

/** One club batter's line in the club innings. */
export interface BattingLine {
  player: string; // registry id
  runs: number;
  ballsFaced: number;
  fours: number;
  sixes: number;
}

/** One club bowler's line, taken while the opposition batted. */
export interface BowlingLine {
  player: string; // registry id
  /** Overs in cricket notation: whole overs + balls/10 (e.g. 3.4 = 3 overs 4 balls). */
  overs: number;
  runsConceded: number;
  wickets: number;
}

export interface MatchScorecard {
  matchId: string;
  /** Club players named in the lineup. Drives DNP (D2) vs played (D3). */
  lineup: string[];
  /** Club player keeping wicket this match — their catches count as keeper catches. */
  wicketKeeper?: string;
  captain: string; // registry id
  viceCaptain: string; // registry id
  clubBatting: BattingLine[];
  clubBowling: BowlingLine[];
  /**
   * Dismissal strings from the OPPOSITION innings. Parsed to credit club
   * fielders (c/st/run out). Bowler wickets are NOT taken from here — they come
   * from `clubBowling` figures — so a caught dismissal credits only the fielder.
   */
  oppositionDismissals: string[];
}

export interface PlayerScore {
  player: string;
  /** Named in the lineup (D3). A lineup player who did nothing still scores 0. */
  played: boolean;
  batting: number;
  bowling: number;
  fielding: number;
  /** SR + economy bonuses. */
  bonuses: number;
  /** batting + bowling + fielding + bonuses, before captaincy. */
  base: number;
  /** 1, or 2 if this player is the effective captain (D10). */
  captainMultiplier: number;
  /** base × captainMultiplier — the fantasy points that drive pricing (D1). */
  total: number;
}

export interface MatchScoreResult {
  matchId: string;
  scores: Map<string, PlayerScore>;
  /** The player who actually received the ×2, or null if both C and VC DNP (D10). */
  effectiveCaptain: string | null;
}
