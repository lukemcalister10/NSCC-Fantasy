import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "../auth/AuthProvider";
import type { LeagueConfig, PlayerRole } from "../../src/config/types";
import {
  latestPrice,
  priceEnteringRound,
  priceMovement,
  type PricePoint,
  type TradeRow,
} from "./squad";

/**
 * READ LAYER for the team / trade slice. Every hook is a plain
 * `supabase.from(...).select(...)` under the anon-key client — RLS (0004) does
 * authorization, exactly as the read-only slice established. Participants read
 * their own `selections`/`trades` unconditionally (`app.owns_team`), and other
 * teams' only after that round's lock.
 *
 * NO ECONOMY CONSTANTS LIVE HERE (G11). `useLeagueConfig` reads the frozen
 * `seasons.config` jsonb — the same accessor the database triggers use
 * (`cfg #>> '{squad,...}'`) — so team size, role minimums, cap and trades per
 * round all come from the row, never from code.
 */

function unwrap<T>(res: { data: unknown; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
}

const STALE = 30_000;

// ── League config (the single source of every limit this slice enforces) ─────

export function useLeagueConfig(seasonId: string | undefined) {
  return useQuery({
    queryKey: ["league-config", seasonId],
    enabled: !!seasonId,
    staleTime: STALE,
    queryFn: async (): Promise<LeagueConfig | null> => {
      const row = unwrap<{ config: LeagueConfig } | null>(
        await supabase
          .from("seasons")
          .select("config")
          .eq("id", seasonId!)
          .maybeSingle(),
      );
      return row?.config ?? null;
    },
  });
}

// ── Rounds (+ their matches, which also drive the G6 padlock set) ───────────

export interface RoundMatch {
  id: string;
  status: string;
}

export interface RoundBasic {
  id: string;
  seq: number;
  name: string;
  lock_at: string;
  matches: RoundMatch[];
}

export function useSeasonRounds(seasonId: string | undefined) {
  return useQuery({
    queryKey: ["season-rounds", seasonId],
    enabled: !!seasonId,
    staleTime: STALE,
    queryFn: async (): Promise<RoundBasic[]> => {
      const rows = unwrap<RoundBasic[]>(
        await supabase
          .from("rounds")
          .select("id,seq,name,lock_at,matches(id,status)")
          .eq("season_id", seasonId!)
          .order("seq", { ascending: true }),
      );
      return rows.map((r) => ({ ...r, matches: r.matches ?? [] }));
    },
  });
}

/**
 * The round a participant is acting on: the earliest round whose per-round
 * `lock_at` is still in the future (D6 — read per round, never a global lock).
 * `null` when every round has locked; the UI then refuses changes WITH a reason
 * rather than silently disabling, and the database refuses them too (G4).
 */
export function activeRoundOf(
  rounds: RoundBasic[] | undefined,
  now: number = Date.now(),
): RoundBasic | null {
  if (!rounds) return null;
  const open = rounds
    .filter((r) => new Date(r.lock_at).getTime() > now)
    .sort((a, b) => a.seq - b.seq);
  return open[0] ?? null;
}

/** Every round still open — carry-forward materialises into all of them. */
export function openRoundsOf(
  rounds: RoundBasic[] | undefined,
  now: number = Date.now(),
): RoundBasic[] {
  if (!rounds) return [];
  return rounds
    .filter((r) => new Date(r.lock_at).getTime() > now)
    .sort((a, b) => a.seq - b.seq);
}

export function roundSeqMap(rounds: RoundBasic[] | undefined): Map<string, number> {
  return new Map((rounds ?? []).map((r) => [r.id, r.seq]));
}

/** match id → the seq of the round it belongs to (for price-entering-round). */
export function roundSeqByMatch(rounds: RoundBasic[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rounds ?? []) for (const match of r.matches) m.set(match.id, r.seq);
  return m;
}

// ── My fantasy team ─────────────────────────────────────────────────────────

export interface MyTeam {
  id: string;
  name: string;
  owner_profile_id: string;
}

export function useMyTeam(seasonId: string | undefined) {
  const { session } = useAuth();
  const userId = session?.user?.id;
  return useQuery({
    queryKey: ["my-team", seasonId, userId],
    enabled: !!seasonId && !!userId,
    staleTime: STALE,
    queryFn: async (): Promise<MyTeam | null> => {
      const row = unwrap<MyTeam | null>(
        await supabase
          .from("fantasy_teams")
          .select("id,name,owner_profile_id")
          .eq("season_id", seasonId!)
          .eq("owner_profile_id", userId!)
          .maybeSingle(),
      );
      return row ?? null;
    },
  });
}

// ── The ledger (authoritative) and the round selection sets ─────────────────

export function useTeamTrades(teamId: string | undefined) {
  return useQuery({
    queryKey: ["team-trades", teamId],
    enabled: !!teamId,
    staleTime: 0, // the ledger is what every figure on the page derives from
    queryFn: async (): Promise<TradeRow[]> =>
      unwrap<TradeRow[]>(
        await supabase
          .from("trades")
          .select("id,fantasy_team_id,kind,player_id,price,round_id,created_at")
          .eq("fantasy_team_id", teamId!)
          .order("created_at", { ascending: true }),
      ),
  });
}

export interface SelectionRow {
  id: string;
  fantasy_team_id: string;
  round_id: string;
  player_id: string;
  is_captain: boolean;
  is_vice_captain: boolean;
}

export function useTeamSelections(teamId: string | undefined) {
  return useQuery({
    queryKey: ["team-selections", teamId],
    enabled: !!teamId,
    staleTime: 0,
    queryFn: async (): Promise<SelectionRow[]> =>
      unwrap<SelectionRow[]>(
        await supabase
          .from("selections")
          .select("id,fantasy_team_id,round_id,player_id,is_captain,is_vice_captain")
          .eq("fantasy_team_id", teamId!),
      ),
  });
}

// ── The player pool, priced two ways ────────────────────────────────────────

export interface PoolPlayer {
  id: string;
  display_name: string;
  role: PlayerRole;
  wk_eligible: boolean;
  starting_price: number | null;
  /** Most recent price on record — what the player list shows. */
  latestPrice: number | null;
  /**
   * Price entering the active round (Rider 2). THIS is what a trade in that
   * round must be recorded at, and what the UI labels "current price".
   */
  priceEnteringRound: number | null;
  movement: number;
}

/**
 * The pool with both price readings. `targetRoundSeq` is the seq of the round
 * being traded in; when it is undefined the entering-round price falls back to
 * the latest (there is no round to enter).
 */
export function usePool(
  seasonId: string | undefined,
  rounds: RoundBasic[] | undefined,
  targetRoundSeq: number | undefined,
) {
  const byMatch = roundSeqByMatch(rounds);
  return useQuery({
    queryKey: ["team-pool", seasonId, targetRoundSeq, rounds?.length ?? 0],
    enabled: !!seasonId && !!rounds,
    staleTime: STALE,
    queryFn: async (): Promise<PoolPlayer[]> => {
      interface Row {
        id: string;
        display_name: string;
        role: PlayerRole;
        wk_eligible: boolean;
        starting_price: number | null;
        price_history: PricePoint[];
      }
      const rows = unwrap<Row[]>(
        await supabase
          .from("players")
          .select(
            "id,display_name,role,wk_eligible,starting_price,price_history(seq,price,match_id)",
          )
          .eq("season_id", seasonId!)
          .eq("active", true)
          .order("display_name"),
      );

      return rows.map((p) => {
        const history = p.price_history ?? [];
        const latest = latestPrice(history) ?? p.starting_price;
        const entering =
          targetRoundSeq === undefined
            ? latest
            : (priceEnteringRound(history, targetRoundSeq, byMatch) ??
              p.starting_price);
        return {
          id: p.id,
          display_name: p.display_name,
          role: p.role,
          wk_eligible: p.wk_eligible,
          starting_price: p.starting_price,
          latestPrice: latest,
          priceEnteringRound: entering,
          movement: priceMovement(history),
        };
      });
    },
  });
}

// ── Mid-match trade lock (D7 / G6) ──────────────────────────────────────────

/**
 * Players whose match has STARTED but is not finalised. The membership test is
 * the named XI via `scorecard_lineup` — the same link the database guard uses
 * (0002:95-115) — so the padlock the UI draws and the refusal the DB issues are
 * the same set. `finalised` and `abandoned` both release the lock (D19), which
 * falls out for free: only `in_progress` is collected here.
 */
export function useMidMatchLockedPlayers(rounds: RoundBasic[] | undefined) {
  const inProgress = (rounds ?? [])
    .flatMap((r) => r.matches)
    .filter((m) => m.status === "in_progress")
    .map((m) => m.id)
    .sort();

  return useQuery({
    queryKey: ["midmatch-locked", inProgress],
    enabled: !!rounds,
    staleTime: STALE,
    queryFn: async (): Promise<Set<string>> => {
      if (inProgress.length === 0) return new Set<string>();
      const cards = unwrap<{ id: string }[]>(
        await supabase.from("scorecards").select("id").in("match_id", inProgress),
      );
      if (cards.length === 0) return new Set<string>();
      const lineup = unwrap<{ player_id: string }[]>(
        await supabase
          .from("scorecard_lineup")
          .select("player_id")
          .in(
            "scorecard_id",
            cards.map((c) => c.id),
          ),
      );
      return new Set(lineup.map((l) => l.player_id));
    },
  });
}

// ── Round results (for the C2 bye overlay) ──────────────────────────────────

export interface H2hResultRow {
  round_id: string;
  home_team_id: string;
  away_team_id: string | null;
  home_points: number;
  away_points: number | null;
  bye_median: number | null;
  outcome: "home" | "away" | "tie" | "bye";
}

/**
 * Settled results per round. The SCHEDULE is never read from here — D21 binds
 * the UI to deriving fixtures with `generateRound`, and that is unchanged. This
 * supplies only the SCORES for rounds already played, so a bye can be shown as
 * what it actually is: a fixture against the round median (D18).
 */
export function useH2hResults(seasonId: string | undefined, roundIds: string[]) {
  const key = [...roundIds].sort();
  return useQuery({
    queryKey: ["h2h-results", seasonId, key],
    enabled: !!seasonId && roundIds.length > 0,
    staleTime: STALE,
    queryFn: async (): Promise<H2hResultRow[]> =>
      unwrap<H2hResultRow[]>(
        await supabase
          .from("h2h_results")
          .select(
            "round_id,home_team_id,away_team_id,home_points,away_points,bye_median,outcome",
          )
          .in("round_id", key),
      ),
  });
}
