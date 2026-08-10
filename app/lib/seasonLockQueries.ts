import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

/**
 * THE REHEARSAL PREVIEW, READ FROM THE DATABASE.
 *
 * Every figure here comes from `public.season_lock_preview()` (0008), which calls
 * the SAME functions `enforce_season_lock()` calls. That is the whole design: the
 * cap shown below is not this client's calculation of what the lock would do, it
 * is the lock's own calculation, run without firing. There is deliberately no
 * TypeScript arithmetic anywhere in this file — a second implementation of the O3
 * mean and the D4 rounding is exactly the drift the preview exists to rule out.
 *
 * The RPC lives in `public` because PostgREST only exposes that schema, and is
 * SECURITY INVOKER, so a caller sees it only if RLS already lets them read
 * `players` and `seasons` (D17/G13).
 */

/** One row of `public.season_lock_preview`. Numerics arrive as strings. */
interface RawPreview {
  season_id: string;
  season_name: string;
  locked_at: string | null;
  team_size: string | number | null;
  rounding_increment: string | number | null;
  floor_price: string | number | null;
  current_cap: string | number | null;
  pool_size: number;
  priced_count: number;
  unpriced_count: number;
  active_count: number;
  inactive_count: number;
  mean_starting_price: string | number | null;
  computed_cap: string | number | null;
  at_floor_count: number;
  lockable: boolean;
  blocker: string | null;
}

export interface SeasonLockPreview {
  seasonId: string;
  seasonName: string;
  lockedAt: string | null;
  teamSize: number | null;
  roundingIncrement: number | null;
  floorPrice: number | null;
  /** The cap currently stored in config — a placeholder pre-lock. */
  currentCap: number | null;
  poolSize: number;
  pricedCount: number;
  unpricedCount: number;
  activeCount: number;
  inactiveCount: number;
  /** Mean starting price over ALL players in the pool (O3, literal). */
  meanStartingPrice: number | null;
  /** The cap the lock WILL write. Not an estimate of it. */
  computedCap: number | null;
  /** How many sit exactly at the D4 floor — the A9 pool-completeness signal. */
  atFloorCount: number;
  lockable: boolean;
  /** Why not, in the words the database itself will use. */
  blocker: string | null;
}

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
};

export function useSeasonLockPreview(seasonId: string | undefined) {
  return useQuery({
    queryKey: ["admin", "season-lock-preview", seasonId],
    enabled: !!seasonId,
    // No staleTime: the operator edits the registry in another tab and comes
    // back to fire a one-way door. A cached pool count is the wrong thing to be
    // looking at in that moment.
    staleTime: 0,
    queryFn: async (): Promise<SeasonLockPreview | null> => {
      const { data, error } = await supabase.rpc("season_lock_preview", {
        p_season_id: seasonId!,
      });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as RawPreview[];
      const row = Array.isArray(rows) ? rows[0] : (rows as RawPreview | undefined);
      if (!row) return null;
      return {
        seasonId: row.season_id,
        seasonName: row.season_name,
        lockedAt: row.locked_at,
        teamSize: num(row.team_size),
        roundingIncrement: num(row.rounding_increment),
        floorPrice: num(row.floor_price),
        currentCap: num(row.current_cap),
        poolSize: row.pool_size,
        pricedCount: row.priced_count,
        unpricedCount: row.unpriced_count,
        activeCount: row.active_count,
        inactiveCount: row.inactive_count,
        meanStartingPrice: num(row.mean_starting_price),
        computedCap: num(row.computed_cap),
        atFloorCount: row.at_floor_count,
        lockable: row.lockable,
        blocker: row.blocker,
      };
    },
  });
}
