import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { generateRound } from "../../src/recompute/roundRobin";
import type { PlayerRole } from "../../src/config/types";

/**
 * Read layer. Every hook is a plain `supabase.from(...).select(...)` under the
 * anon client — RLS (0004) does authorization. No writes anywhere in this file.
 * Derived-but-DB-stored tables (ladder, leaderboard, scores, prices) are read as
 * rows; the H2H SCHEDULE is NOT read from `h2h_results` — it is regenerated with
 * the exported engine `generateRound` (D21).
 */

/**
 * Throw on a PostgREST error, else return the data cast to our hand-written row
 * shape. We cast from `unknown` because, without generated DB types, the client
 * widens to-one embeds (e.g. `fantasy_teams`) to arrays in its inferred types
 * even though at runtime a many-to-one embed is a single object.
 */
function unwrap<T>(res: { data: unknown; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
}

// ── Types (shapes we select) ────────────────────────────────────────────────

export interface Season {
  id: string;
  name: string;
  locked_at: string | null;
  created_at: string;
}

export interface LadderRow {
  fantasy_team_id: string;
  played: number;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  ladder_points: number;
  fantasy_teams: { name: string } | null;
}

export interface LeaderboardRow {
  fantasy_team_id: string;
  total_points: number;
  fantasy_teams: { name: string } | null;
}

interface PricePoint {
  seq: number;
  price: number;
  match_id: string | null;
}

export interface PlayerListItem {
  id: string;
  display_name: string;
  role: PlayerRole;
  wk_eligible: boolean;
  starting_price: number | null;
  currentPrice: number | null;
  movement: number; // current − previous (0 if only the seed exists)
}

export interface PlayerScoreRow {
  match_id: string;
  played: boolean;
  batting: number;
  bowling: number;
  fielding: number;
  bonuses: number;
  base: number;
  matches: {
    grade: string;
    opponent: string;
    status: string;
    final_day_date: string | null;
    rounds: { name: string; seq: number } | null;
  } | null;
}

export interface PlayerProfile {
  id: string;
  display_name: string;
  role: PlayerRole;
  wk_eligible: boolean;
  starting_price: number | null;
  currentPrice: number | null;
  priceHistory: PricePoint[];
  scores: PlayerScoreRow[];
}

export interface RoundView {
  id: string;
  seq: number;
  name: string;
  lock_at: string;
  matches: {
    id: string;
    grade: string;
    opponent: string;
    status: string;
    final_day_date: string | null;
  }[];
  fixtures: { home: string; away: string | null }[]; // team NAMES (bye = away null)
}

const STALE = 60_000; // 1 min; read-only league data changes on recompute cadence

// ── Season (auto-pick the most-recent) ──────────────────────────────────────

export function useSeason() {
  return useQuery({
    queryKey: ["season"],
    staleTime: STALE,
    queryFn: async (): Promise<Season | null> => {
      const rows = unwrap<Season[]>(
        await supabase
          .from("seasons")
          .select("id,name,locked_at,created_at")
          .order("created_at", { ascending: false })
          .limit(1),
      );
      return rows[0] ?? null;
    },
  });
}

// ── Ladder + overall leaderboard ────────────────────────────────────────────

export function useLadder(seasonId: string | undefined) {
  return useQuery({
    queryKey: ["ladder", seasonId],
    enabled: !!seasonId,
    staleTime: STALE,
    queryFn: async (): Promise<LadderRow[]> => {
      const rows = unwrap<LadderRow[]>(
        await supabase
          .from("ladder")
          .select(
            "fantasy_team_id,played,wins,losses,ties,points_for,ladder_points,fantasy_teams(name)",
          )
          .eq("season_id", seasonId!),
      );
      // D11/D20: premiership points (2·w + t) primary, points-for tiebreak.
      return [...rows].sort(
        (a, b) =>
          b.ladder_points - a.ladder_points || b.points_for - a.points_for,
      );
    },
  });
}

export function useLeaderboard(seasonId: string | undefined) {
  return useQuery({
    queryKey: ["leaderboard", seasonId],
    enabled: !!seasonId,
    staleTime: STALE,
    queryFn: async (): Promise<LeaderboardRow[]> => {
      const rows = unwrap<LeaderboardRow[]>(
        await supabase
          .from("overall_leaderboard")
          .select("fantasy_team_id,total_points,fantasy_teams(name)")
          .eq("season_id", seasonId!)
          .order("total_points", { ascending: false }),
      );
      return rows;
    },
  });
}

// ── Player price list ───────────────────────────────────────────────────────

interface PlayerWithPrices {
  id: string;
  display_name: string;
  role: PlayerRole;
  wk_eligible: boolean;
  starting_price: number | null;
  price_history: { seq: number; price: number }[];
}

function latestAndMovement(history: { seq: number; price: number }[]): {
  current: number | null;
  movement: number;
} {
  if (history.length === 0) return { current: null, movement: 0 };
  const sorted = [...history].sort((a, b) => a.seq - b.seq);
  const current = sorted[sorted.length - 1]!.price;
  const prev = sorted.length > 1 ? sorted[sorted.length - 2]!.price : current;
  return { current, movement: current - prev };
}

export function usePlayers(seasonId: string | undefined) {
  return useQuery({
    queryKey: ["players", seasonId],
    enabled: !!seasonId,
    staleTime: STALE,
    queryFn: async (): Promise<PlayerListItem[]> => {
      const rows = unwrap<PlayerWithPrices[]>(
        await supabase
          .from("players")
          .select(
            "id,display_name,role,wk_eligible,starting_price,price_history(seq,price)",
          )
          .eq("season_id", seasonId!)
          .eq("active", true)
          .order("display_name"),
      );
      return rows.map((p) => {
        const { current, movement } = latestAndMovement(p.price_history ?? []);
        return {
          id: p.id,
          display_name: p.display_name,
          role: p.role,
          wk_eligible: p.wk_eligible,
          starting_price: p.starting_price,
          currentPrice: current ?? p.starting_price,
          movement,
        };
      });
    },
  });
}

// ── Player profile ──────────────────────────────────────────────────────────

export function usePlayer(playerId: string | undefined) {
  return useQuery({
    queryKey: ["player", playerId],
    enabled: !!playerId,
    staleTime: STALE,
    queryFn: async (): Promise<PlayerProfile | null> => {
      const player = unwrap<{
        id: string;
        display_name: string;
        role: PlayerRole;
        wk_eligible: boolean;
        starting_price: number | null;
      }>(
        await supabase
          .from("players")
          .select("id,display_name,role,wk_eligible,starting_price")
          .eq("id", playerId!)
          .single(),
      );

      const priceHistory = unwrap<PricePoint[]>(
        await supabase
          .from("price_history")
          .select("seq,price,match_id")
          .eq("player_id", playerId!)
          .order("seq", { ascending: true }),
      );

      const scores = unwrap<PlayerScoreRow[]>(
        await supabase
          .from("player_match_scores")
          .select(
            "match_id,played,batting,bowling,fielding,bonuses,base,matches(grade,opponent,status,final_day_date,rounds(name,seq))",
          )
          .eq("player_id", playerId!),
      );

      scores.sort((a, b) => (a.matches?.rounds?.seq ?? 0) - (b.matches?.rounds?.seq ?? 0));

      const current =
        priceHistory.length > 0
          ? priceHistory[priceHistory.length - 1]!.price
          : player.starting_price;

      return {
        ...player,
        currentPrice: current,
        priceHistory,
        scores,
      };
    },
  });
}

// ── Rounds + derived fixtures (D21) ─────────────────────────────────────────

interface RoundRow {
  id: string;
  seq: number;
  name: string;
  lock_at: string;
  matches: {
    id: string;
    grade: string;
    opponent: string;
    status: string;
    final_day_date: string | null;
  }[];
}

export function useRounds(seasonId: string | undefined) {
  return useQuery({
    queryKey: ["rounds", seasonId],
    enabled: !!seasonId,
    staleTime: STALE,
    queryFn: async (): Promise<RoundView[]> => {
      const rounds = unwrap<RoundRow[]>(
        await supabase
          .from("rounds")
          .select(
            "id,seq,name,lock_at,matches(id,grade,opponent,status,final_day_date)",
          )
          .eq("season_id", seasonId!)
          .order("seq", { ascending: true }),
      );

      const teams = unwrap<{ id: string; name: string }[]>(
        await supabase
          .from("fantasy_teams")
          .select("id,name")
          .eq("season_id", seasonId!),
      );
      const nameById = new Map(teams.map((t) => [t.id, t.name]));
      const teamIds = teams.map((t) => t.id);

      return rounds.map((r) => {
        const fixtures = generateRound(teamIds, r.seq - 1).map((f) => ({
          home: nameById.get(f.home) ?? "—",
          away: f.away === null ? null : (nameById.get(f.away) ?? "—"),
        }));
        return {
          id: r.id,
          seq: r.seq,
          name: r.name,
          lock_at: r.lock_at,
          matches: (r.matches ?? []).sort((a, b) =>
            a.grade.localeCompare(b.grade),
          ),
          fixtures,
        };
      });
    },
  });
}
