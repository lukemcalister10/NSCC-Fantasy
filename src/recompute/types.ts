import type { LeagueConfig, PlayerRole } from "../config/types.js";
import type { LedgerTxnKind } from "../engines/capLedger.js";

/**
 * Recompute I/O contract. `RawSeason` mirrors the raw-truth + config tables
 * (the sole sources of truth, D15); `DerivedState` mirrors the derived-state
 * tables. `recomputeSeason(raw)` is a pure, deterministic function of RawSeason
 * — the whole basis of G3 (byte-identical recompute).
 */

export type MatchStatus =
  | "scheduled"
  | "in_progress"
  | "finalised"
  | "abandoned";
export type ReviewState = "draft" | "committed";

// ---- Raw truth --------------------------------------------------------------

export interface RawPlayer {
  id: string;
  registryKey: string;
  displayName: string;
  role: PlayerRole;
  wkEligible: boolean;
  /** Seed price; authoritative post-lock (Rider 3). Null pre-lock -> floor seed. */
  startingPrice: number | null;
  active: boolean;
}

export interface RawRound {
  id: string;
  seq: number;
  name: string;
  /** ISO timestamp; per-round lock (D6). */
  lockAt: string;
}

export interface RawMatch {
  id: string;
  roundId: string;
  grade: string;
  opponent: string;
  status: MatchStatus;
  finalDayDate: string | null;
  /** ISO timestamp; ordering key for sequential pricing. Null until finalised. */
  finalisedAt: string | null;
}

export interface RawBattingLine {
  playerId: string;
  runs: number;
  ballsFaced: number;
  fours: number;
  sixes: number;
}

export interface RawBowlingLine {
  playerId: string;
  overs: number;
  runsConceded: number;
  wickets: number;
}

export interface RawScorecard {
  id: string;
  matchId: string;
  wicketKeeperPlayerId: string | null;
  reviewState: ReviewState;
  /** Player ids named in the lineup (DNP vs played). */
  lineup: string[];
  batting: RawBattingLine[];
  bowling: RawBowlingLine[];
  /** Opposition dismissal strings, in order -> club fielding credits. */
  dismissals: string[];
}

export interface RawFantasyTeam {
  id: string;
  ownerProfileId: string;
  name: string;
}

export interface RawSelection {
  id: string;
  fantasyTeamId: string;
  roundId: string;
  playerId: string;
  isCaptain: boolean;
  isViceCaptain: boolean;
}

export interface RawTrade {
  id: string;
  fantasyTeamId: string;
  kind: LedgerTxnKind;
  playerId: string;
  /** Price at time of trade (D8). Recompute asserts this equals the derived price. */
  price: number;
  roundId: string;
  /** ISO timestamp; orders trades within a team. */
  createdAt: string;
}

export interface RawSeason {
  seasonId: string;
  config: LeagueConfig;
  players: RawPlayer[];
  rounds: RawRound[];
  matches: RawMatch[];
  scorecards: RawScorecard[];
  fantasyTeams: RawFantasyTeam[];
  selections: RawSelection[];
  trades: RawTrade[];
}

// ---- Derived state ----------------------------------------------------------

export interface DerivedPlayerMatchScore {
  matchId: string;
  playerId: string;
  played: boolean;
  batting: number;
  bowling: number;
  fielding: number;
  bonuses: number;
  /** Pre-captaincy; drives pricing (D1/G7). */
  base: number;
}

export interface DerivedPricePoint {
  playerId: string;
  /** Null = starting seed (seq 0). */
  matchId: string | null;
  seq: number;
  price: number;
}

export interface DerivedCapSnapshot {
  fantasyTeamId: string;
  asOfRoundId: string;
  capRemaining: number;
  investedValue: number;
  /** cap_remaining + invested_value (amended A2 / G2). */
  teamValue: number;
}

/** H2H outcome label. `bye` marks the fixture type; the bye team still earns a
 *  W/L/T for the ladder by comparing its total to `byeMedian` (D11/D18). */
export type H2hOutcome = "home" | "away" | "tie" | "bye";

/**
 * Per-team round total (D10 captaincy applied HERE, not in scoreMatch): sum of
 * the selected players' round-base (Σ pre-captaincy `base` over the round's
 * matches), with the effective captain's round-base counted twice.
 */
export interface DerivedTeamRoundScore {
  fantasyTeamId: string;
  roundId: string;
  /** Σ selected round-bases + effective-captain round-base (the ×2). */
  total: number;
  /** The player who actually received the ×2, or null if C and VC both DNP. */
  captainPlayerId: string | null;
}

/**
 * One derived H2H fixture result for a round. Fixtures are DERIVED (no fixtures
 * table) via the deterministic round-robin. `awayTeamId === null` is a bye:
 * the home (bye) team is scored against `byeMedian` (D11/D18).
 *
 * The physical `h2h_results.id` (a random-uuid surrogate) is deliberately NOT
 * modelled here: it is never read back or compared, so recompute stays
 * byte-identical. `(roundId, homeTeamId)` is the natural key.
 */
export interface DerivedH2hResult {
  roundId: string;
  homeTeamId: string;
  awayTeamId: string | null;
  homePoints: number;
  awayPoints: number | null;
  /** Set iff this is a bye (round median, incl. all teams, D11/D18). */
  byeMedian: number | null;
  outcome: H2hOutcome;
}

/** Ladder standings row (D11): wins primary, points-for tiebreak. */
export interface DerivedLadderRow {
  fantasyTeamId: string;
  played: number;
  wins: number;
  losses: number;
  ties: number;
  /** Σ the team's own round totals over active rounds. */
  pointsFor: number;
  /** 2·wins + 1·ties (structural convention, operator-confirmed; not economy config). */
  ladderPoints: number;
}

/** Separate overall-points leaderboard (D11): Σ round totals over active rounds. */
export interface DerivedOverallRow {
  fantasyTeamId: string;
  totalPoints: number;
}

/**
 * Full derived chain. Every family is populated once the deferred engines land
 * (this slice). Arrays are emitted in a deterministic order keyed on the exact
 * string columns `readDerived` orders by, so the pglite round-trip is
 * byte-identical (G3).
 */
export interface DerivedState {
  playerMatchScores: DerivedPlayerMatchScore[];
  priceHistory: DerivedPricePoint[];
  teamCapSnapshots: DerivedCapSnapshot[];
  teamRoundScores: DerivedTeamRoundScore[];
  h2hResults: DerivedH2hResult[];
  ladder: DerivedLadderRow[];
  overallLeaderboard: DerivedOverallRow[];
}
