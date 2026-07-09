import type { LeagueConfig, PlayerRole } from "../config/types.js";
import type { LedgerTxnKind } from "../engines/capLedger.js";

/**
 * Recompute I/O contract. `RawSeason` mirrors the raw-truth + config tables
 * (the sole sources of truth, D15); `DerivedState` mirrors the derived-state
 * tables. `recomputeSeason(raw)` is a pure, deterministic function of RawSeason
 * — the whole basis of G3 (byte-identical recompute).
 */

export type MatchStatus = "scheduled" | "in_progress" | "finalised";
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

/**
 * Full derived chain. Core families are populated this slice; the rest are
 * present (empty) so the deferred engines (full-chain G3 + G9) slot in without
 * a shape change. Arrays are emitted in a deterministic order.
 */
export interface DerivedState {
  playerMatchScores: DerivedPlayerMatchScore[];
  priceHistory: DerivedPricePoint[];
  teamCapSnapshots: DerivedCapSnapshot[];
  // Deferred engines (full-chain G3 + G9):
  teamRoundScores: never[];
  h2hResults: never[];
  ladder: never[];
  overallLeaderboard: never[];
}
