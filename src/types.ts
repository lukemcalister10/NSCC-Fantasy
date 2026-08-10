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

/**
 * WHICH INNINGS A LINE BELONGS TO (D27, migration 0006). The club's OWN innings
 * sequence — 1, 2, … — not ICC-style absolute four-innings numbering: batting,
 * bowling and dismissals sharing an index are the same phase of the match. That
 * is exactly the grouping O4's second-innings multiplier needs.
 *
 * OPTIONAL, DEFAULTING TO 1, throughout the engine's input types. Two reasons,
 * both deliberate: a one-innings match is the common case and should not have to
 * say so, and it leaves src/fixtures/reference-scorecards.ts — Gate G1's
 * evidence — byte-for-byte unchanged across this slice. The RAW contract
 * (src/recompute/types.ts) makes it REQUIRED, because the database column is NOT
 * NULL and dropping it in transit was one of the three gaps this slice closes.
 */
const INNINGS_DEFAULT = 1;

/** Innings a line belongs to, defaulting to the first (see above). */
export function inningsOf(line: { innings?: number }): number {
  return line.innings ?? INNINGS_DEFAULT;
}

/** One club batter's line in ONE innings. A two-innings match yields two. */
export interface BattingLine {
  player: string; // registry id
  /** Club innings this line belongs to (D27). Defaults to 1. */
  innings?: number;
  runs: number;
  ballsFaced: number;
  fours: number;
  sixes: number;
  /**
   * Batter was unbeaten (migration 0006). Distinguishes O4's not-out bonus from a
   * duck: a batter DISMISSED for 0 is a duck, a batter unbeaten on 0 is not, and
   * neither is derivable from runs alone. Defaults to false (dismissed).
   */
  notOut?: boolean;
}

/** One club bowler's line in ONE innings, taken while the opposition batted. */
export interface BowlingLine {
  player: string; // registry id
  /** Club innings this line belongs to (D27). Defaults to 1. */
  innings?: number;
  /** Overs in cricket notation: whole overs + balls/10 (e.g. 3.4 = 3 overs 4 balls). */
  overs: number;
  runsConceded: number;
  wickets: number;
  /** Maiden overs bowled (O4 "maiden 1", migration 0006). Defaults to 0. */
  maidens?: number;
}

/** An opposition dismissal, optionally tagged with the innings it fell in. */
export interface DismissalEntry {
  /** Club innings this dismissal belongs to (D27). Defaults to 1. */
  innings?: number;
  text: string;
}

/**
 * A dismissal as the engine accepts it: the bare string when the match has one
 * innings (the reference scorecards' form), or a tagged entry when it matters
 * which innings the fielding credit was earned in.
 */
export type DismissalInput = string | DismissalEntry;

/** Normalise either form to `{ innings, text }`. */
export function dismissalEntry(d: DismissalInput): { innings: number; text: string } {
  return typeof d === "string"
    ? { innings: INNINGS_DEFAULT, text: d }
    : { innings: inningsOf(d), text: d.text };
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
   * Dismissals from the OPPOSITION innings. Parsed to credit club fielders
   * (c/st/run out). Bowler wickets are NOT taken from here — they come from
   * `clubBowling` figures — so a caught dismissal credits only the fielder.
   *
   * A bare string is innings 1; tag it to place the credit in a later innings.
   */
  oppositionDismissals: DismissalInput[];
}

export interface PlayerScore {
  player: string;
  /** Named in the lineup (D3). A lineup player who did nothing still scores 0. */
  played: boolean;
  /** Points earned batting, summed across innings AT FACE VALUE (unmultiplied). */
  batting: number;
  /** Points earned bowling, summed across innings AT FACE VALUE. */
  bowling: number;
  /** Points earned fielding, summed across innings AT FACE VALUE. */
  fielding: number;
  /** SR + economy bonuses, summed across innings AT FACE VALUE. */
  bonuses: number;
  /**
   * The second-innings multiplier's whole effect, as ONE auditable number (D28):
   *   round_half_up(secondInningsEarnings × m) − secondInningsEarnings
   * Zero whenever the multiplier is 1.0 (the frozen fixture config) or the match
   * had one innings. Negative for m < 1.
   *
   * WHY IT IS A STORED COMPONENT rather than folded silently into `base`
   * (operator ruling, 10/08/2026): the four component fields above are face-value
   * sums, so without this term `base` would not equal its own components and a
   * multiplier applied to a participant's score would be invisible in stored
   * state — unverifiable by hand, which is the one thing this project's audit
   * posture will not accept.
   */
  secondInningsAdjustment: number;
  /** batting + bowling + fielding + bonuses + secondInningsAdjustment, before
   *  captaincy. This identity holds exactly, by construction. */
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
