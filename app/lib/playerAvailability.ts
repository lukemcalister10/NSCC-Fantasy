import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import {
  mapClubAvailability,
  type AvailabilityIdentity,
  type AvailabilityRound,
  type ClubAvailabilityMatch,
} from "./clubAvailabilityMapping";

export type PlayerAvailabilityStatus = "available" | "unavailable";

interface AvailabilityRow {
  player_id: string;
  status: PlayerAvailabilityStatus;
}

export function useManualPlayerAvailability(roundId: string | undefined) {
  return useQuery({
    queryKey: ["player-availability", "manual", roundId],
    enabled: !!roundId,
    staleTime: 30_000,
    queryFn: async (): Promise<Map<string, PlayerAvailabilityStatus>> => {
      const res = await supabase
        .from("player_availability")
        .select("player_id,status")
        .eq("round_id", roundId!);
      if (res.error) throw new Error(res.error.message);
      return new Map(
        ((res.data ?? []) as AvailabilityRow[]).map((row) => [row.player_id, row.status]),
      );
    },
  });
}

export function useClubPlayerAvailability(roundId: string | undefined) {
  return useQuery({
    queryKey: ["player-availability", "club", roundId],
    enabled: !!roundId,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in to view club availability");

      const roundResponse = await supabase.from("rounds")
        .select("season_id,name,matches(grade,opponent)").eq("id", roundId!).single();
      if (roundResponse.error) throw new Error(roundResponse.error.message);
      const [playersResponse, feedResponse] = await Promise.all([
        supabase.from("players").select("id,registry_key,display_name")
          .eq("season_id", roundResponse.data.season_id).eq("active", true),
        fetch("/api/club-availability", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (playersResponse.error) throw new Error(playersResponse.error.message);
      if (!feedResponse.ok) {
        throw new Error(feedResponse.status === 503
          ? "Club availability key is not configured on this deployment"
          : "Club availability could not be refreshed");
      }
      const feed = (await feedResponse.json()) as { matches?: ClubAvailabilityMatch[] };
      if (!Array.isArray(feed.matches)) throw new Error("Invalid club availability response");
      return mapClubAvailability(
        roundResponse.data as AvailabilityRound,
        (playersResponse.data ?? []) as AvailabilityIdentity[],
        feed.matches,
      );
    },
  });
}

/** Manual manager entries always win; club data refreshes automatically. */
export function usePlayerAvailability(roundId: string | undefined) {
  const manual = useManualPlayerAvailability(roundId);
  const club = useClubPlayerAvailability(roundId);
  const data = useMemo(() => new Map([
    ...(club.data?.statuses ?? new Map<string, PlayerAvailabilityStatus>()),
    ...(manual.data ?? new Map<string, PlayerAvailabilityStatus>()),
  ]), [club.data, manual.data]);
  return { data, error: manual.error, isLoading: manual.isLoading, clubError: club.error };
}

export async function setPlayerAvailability(
  roundId: string,
  playerId: string,
  status: PlayerAvailabilityStatus | null,
): Promise<void> {
  const query = supabase
    .from("player_availability")
    .delete()
    .eq("round_id", roundId)
    .eq("player_id", playerId);

  const res = status === null
    ? await query
    : await supabase.from("player_availability").upsert(
        { round_id: roundId, player_id: playerId, status },
        { onConflict: "round_id,player_id" },
      );
  if (res.error) throw new Error(res.error.message);
}
