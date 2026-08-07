import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { LeagueConfig, PlayerRole } from "../../src/config/types";

/**
 * MANAGER-BACKEND READS. Same anon client, same RLS (0004) — a manager is just an
 * `authenticated` user whose profile carries `is_league_manager`, so these reads
 * are authorised by the database, never by the fact that the caller rendered an
 * /admin route. The reads that a participant is not allowed (the registry audit
 * log) simply come back empty for them; the refusal is the database's.
 *
 * Deliberately separate from lib/queries.ts: that file is the read-only league
 * view (S-C and the public pages depend on it), this one is admin-only surface.
 */

const ADMIN_STALE = 10_000; // admin data changes under the operator's own hands

function unwrap<T>(res: { data: unknown; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
}

// ── Season (with the full config, which the league views never need) ─────────

export interface AdminSeason {
  id: string;
  name: string;
  config: LeagueConfig;
  locked_at: string | null;
  created_at: string;
}

export function useAdminSeason() {
  return useQuery({
    queryKey: ["admin", "season"],
    staleTime: ADMIN_STALE,
    queryFn: async (): Promise<AdminSeason | null> => {
      const rows = unwrap<AdminSeason[]>(
        await supabase
          .from("seasons")
          .select("id,name,config,locked_at,created_at")
          .order("created_at", { ascending: false })
          .limit(1),
      );
      return rows[0] ?? null;
    },
  });
}

// ── Registry (INCLUDING inactive players — the league view hides them) ───────

export interface AdminPlayer {
  id: string;
  registry_key: string;
  display_name: string;
  role: PlayerRole;
  wk_eligible: boolean;
  starting_price: number | null;
  active: boolean;
}

export function useAdminPlayers(seasonId: string | undefined) {
  return useQuery({
    queryKey: ["admin", "players", seasonId],
    enabled: !!seasonId,
    staleTime: ADMIN_STALE,
    queryFn: async (): Promise<AdminPlayer[]> =>
      unwrap<AdminPlayer[]>(
        await supabase
          .from("players")
          .select("id,registry_key,display_name,role,wk_eligible,starting_price,active")
          .eq("season_id", seasonId!)
          .order("display_name"),
      ),
  });
}

// ── Rounds + matches + the D24 freeze state ─────────────────────────────────

export interface AdminMatch {
  id: string;
  round_id: string;
  grade: string;
  opponent: string;
  status: "scheduled" | "in_progress" | "finalised" | "abandoned";
  final_day_date: string | null;
  finalised_at: string | null;
}

export interface AdminRound {
  id: string;
  seq: number;
  name: string;
  lock_at: string;
  scorecards_frozen_at: string | null;
  matches: AdminMatch[];
}

export function useAdminRounds(seasonId: string | undefined) {
  return useQuery({
    queryKey: ["admin", "rounds", seasonId],
    enabled: !!seasonId,
    staleTime: ADMIN_STALE,
    queryFn: async (): Promise<AdminRound[]> => {
      const rows = unwrap<AdminRound[]>(
        await supabase
          .from("rounds")
          .select(
            "id,seq,name,lock_at,scorecards_frozen_at,matches(id,round_id,grade,opponent,status,final_day_date,finalised_at)",
          )
          .eq("season_id", seasonId!)
          .order("seq", { ascending: true }),
      );
      return rows.map((r) => ({
        ...r,
        matches: [...(r.matches ?? [])].sort((a, b) => a.grade.localeCompare(b.grade)),
      }));
    },
  });
}

// ── One match's scorecard, in the shape the entry form edits ────────────────

export interface ScorecardBattingLine {
  innings: number;
  player_id: string;
  runs: number;
  balls_faced: number;
  fours: number;
  sixes: number;
  not_out: boolean;
}

export interface ScorecardBowlingLine {
  innings: number;
  player_id: string;
  overs: number;
  runs_conceded: number;
  wickets: number;
  maidens: number;
}

export interface ScorecardDismissal {
  innings: number;
  seq: number;
  resolved_text: string;
  source_text: string | null;
}

export interface ScorecardView {
  id: string;
  match_id: string;
  wicket_keeper_player_id: string | null;
  review_state: "draft" | "committed";
  lineup: string[];
  batting: ScorecardBattingLine[];
  bowling: ScorecardBowlingLine[];
  dismissals: ScorecardDismissal[];
}

export function useScorecard(matchId: string | undefined) {
  return useQuery({
    queryKey: ["admin", "scorecard", matchId],
    enabled: !!matchId,
    staleTime: 0, // always fresh: this is the thing being edited
    queryFn: async (): Promise<ScorecardView | null> => {
      const cards = unwrap<
        { id: string; match_id: string; wicket_keeper_player_id: string | null; review_state: "draft" | "committed" }[]
      >(
        await supabase
          .from("scorecards")
          .select("id,match_id,wicket_keeper_player_id,review_state")
          .eq("match_id", matchId!)
          .limit(1),
      );
      const card = cards[0];
      if (!card) return null;

      const [lineup, batting, bowling, dismissals] = await Promise.all([
        supabase.from("scorecard_lineup").select("player_id").eq("scorecard_id", card.id),
        supabase
          .from("batting_lines")
          .select("innings,player_id,runs,balls_faced,fours,sixes,not_out")
          .eq("scorecard_id", card.id)
          .order("innings")
          .order("player_id"),
        supabase
          .from("bowling_lines")
          .select("innings,player_id,overs,runs_conceded,wickets,maidens")
          .eq("scorecard_id", card.id)
          .order("innings")
          .order("player_id"),
        supabase
          .from("dismissals")
          .select("innings,seq,resolved_text,source_text")
          .eq("scorecard_id", card.id)
          .order("innings")
          .order("seq"),
      ]);

      return {
        ...card,
        lineup: unwrap<{ player_id: string }[]>(lineup).map((r) => r.player_id),
        batting: unwrap<ScorecardBattingLine[]>(batting),
        bowling: unwrap<ScorecardBowlingLine[]>(bowling),
        dismissals: unwrap<ScorecardDismissal[]>(dismissals),
      };
    },
  });
}

// ── Registry audit trail (manager-only by RLS; empty for anyone else) ───────

export interface RegistryEvent {
  id: string;
  player_id: string | null;
  event: "create" | "update";
  actor: string | null;
  at: string;
  detail: Record<string, unknown>;
}

export function useRegistryEvents(seasonId: string | undefined, limit = 25) {
  return useQuery({
    queryKey: ["admin", "registry-events", seasonId, limit],
    enabled: !!seasonId,
    staleTime: ADMIN_STALE,
    queryFn: async (): Promise<RegistryEvent[]> =>
      unwrap<RegistryEvent[]>(
        await supabase
          .from("player_registry_events")
          .select("id,player_id,event,actor,at,detail")
          .eq("season_id", seasonId!)
          .order("at", { ascending: false })
          .limit(limit),
      ),
  });
}
