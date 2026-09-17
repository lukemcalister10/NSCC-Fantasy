import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type PlayerAvailabilityStatus = "available" | "unavailable";

interface AvailabilityRow {
  player_id: string;
  status: PlayerAvailabilityStatus;
}

export function usePlayerAvailability(roundId: string | undefined) {
  return useQuery({
    queryKey: ["player-availability", roundId],
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
