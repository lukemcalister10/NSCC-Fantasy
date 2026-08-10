import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PlayerRole } from "../../src/config/types";
import {
  activeRoundOf,
  openRoundsOf,
  roundSeqMap,
  useLeagueConfig,
  useMidMatchLockedPlayers,
  useMyTeam,
  usePool,
  useSeasonRounds,
  useTeamSelections,
  useTeamTrades,
  type PoolPlayer,
  type RoundBasic,
  type SelectionRow,
} from "./teamQueries";
import {
  capRemaining as calcCapRemaining,
  holdingsFromLedger,
  investedValue as calcInvestedValue,
  teamValue as calcTeamValue,
  tradeBudget,
  type Holding,
  type TradeBudget,
  type TradeRow,
} from "./squad";

/**
 * The assembled team state both /team and /team/trades read from. One place
 * where the ledger becomes holdings, holdings become figures, and config becomes
 * limits — so the two routes cannot drift apart.
 */

export interface HoldingView extends Holding {
  player: PoolPlayer | undefined;
  role: PlayerRole | undefined;
  /** Price entering the active round — see Rider 2 note in squad.ts. */
  currentPrice: number | null;
  movement: number;
  /** In a match that has started and is not finalised (D7/G6): untradeable. */
  midMatchLocked: boolean;
}

export interface TeamState {
  isLoading: boolean;
  error: Error | null;

  seasonId: string | undefined;
  seasonLocked: boolean;

  config: ReturnType<typeof useLeagueConfig>["data"];
  rounds: RoundBasic[];
  activeRound: RoundBasic | null;
  openRounds: RoundBasic[];
  roundSeqById: Map<string, number>;
  /** True when every round has locked — changes are refused, with a reason. */
  allRoundsLocked: boolean;

  team: { id: string; name: string } | null;
  trades: TradeRow[];
  selections: SelectionRow[];
  /**
   * TRUE ONLY once the selections query has actually answered (C7). An empty
   * `selections` array means two different things — "this team has none" and
   * "we have not been told yet" — and carry-forward must not act on the second.
   * A team with no id has nothing to load, and is reported as loaded so callers
   * do not wait forever on a query that never runs.
   */
  selectionsLoaded: boolean;
  selectionsForActiveRound: SelectionRow[];
  /** The latest earlier round that carries selections — captaincy carries forward from it. */
  priorSelections: SelectionRow[];

  pool: PoolPlayer[];
  poolById: Map<string, PoolPlayer>;
  midMatchLocked: Set<string>;

  holdings: HoldingView[];
  capRemaining: number | null;
  investedValue: number | null;
  teamValue: number | null;
  budget: TradeBudget | null;

  /** Price entering the active round; the figure every trade must be struck at. */
  priceOf: (playerId: string) => number;
  refetch: () => void;
}

export function useTeamState(seasonId: string | undefined, seasonLocked: boolean): TeamState {
  const qc = useQueryClient();
  const config = useLeagueConfig(seasonId);
  const roundsQ = useSeasonRounds(seasonId);
  const rounds = useMemo(() => roundsQ.data ?? [], [roundsQ.data]);

  const activeRound = useMemo(() => activeRoundOf(rounds), [rounds]);
  const openRounds = useMemo(() => openRoundsOf(rounds), [rounds]);
  const roundSeqById = useMemo(() => roundSeqMap(rounds), [rounds]);

  const teamQ = useMyTeam(seasonId);
  const teamId = teamQ.data?.id;

  const tradesQ = useTeamTrades(teamId);
  const selectionsQ = useTeamSelections(teamId);
  const poolQ = usePool(seasonId, roundsQ.data, activeRound?.seq);
  const lockedQ = useMidMatchLockedPlayers(roundsQ.data);

  const pool = useMemo(() => poolQ.data ?? [], [poolQ.data]);
  const poolById = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const midMatchLocked = useMemo(() => lockedQ.data ?? new Set<string>(), [lockedQ.data]);
  const trades = useMemo(() => tradesQ.data ?? [], [tradesQ.data]);
  const selections = useMemo(() => selectionsQ.data ?? [], [selectionsQ.data]);

  const priceOf = useMemo(() => {
    return (playerId: string): number => {
      const p = poolById.get(playerId);
      return p?.priceEnteringRound ?? p?.latestPrice ?? p?.starting_price ?? 0;
    };
  }, [poolById]);

  const holdings = useMemo(() => holdingsFromLedger(trades), [trades]);

  const holdingViews = useMemo<HoldingView[]>(
    () =>
      holdings
        .map((h) => {
          const player = poolById.get(h.playerId);
          return {
            ...h,
            player,
            role: player?.role,
            currentPrice: player?.priceEnteringRound ?? player?.latestPrice ?? null,
            movement: player?.movement ?? 0,
            midMatchLocked: midMatchLocked.has(h.playerId),
          };
        })
        .sort((a, b) => (a.player?.display_name ?? "").localeCompare(b.player?.display_name ?? "")),
    [holdings, poolById, midMatchLocked],
  );

  const selectionsForActiveRound = useMemo(
    () => (activeRound ? selections.filter((s) => s.round_id === activeRound.id) : []),
    [selections, activeRound],
  );

  const priorSelections = useMemo(() => {
    if (!activeRound) return [];
    let best: { seq: number; rows: SelectionRow[] } | null = null;
    for (const s of selections) {
      const seq = roundSeqById.get(s.round_id);
      if (seq === undefined || seq >= activeRound.seq) continue;
      if (!best || seq > best.seq) best = { seq, rows: [] };
    }
    if (!best) return [];
    return selections.filter((s) => roundSeqById.get(s.round_id) === best!.seq);
  }, [selections, activeRound, roundSeqById]);

  const squad = config.data?.squad;
  const capRemaining = squad ? calcCapRemaining(squad.cap, trades) : null;
  const investedValue = squad ? calcInvestedValue(holdings, priceOf) : null;
  const teamValue = squad ? calcTeamValue(squad.cap, trades, holdings, priceOf) : null;
  const budget =
    squad && activeRound ? tradeBudget(trades, activeRound.id, roundSeqById, squad) : null;

  const error =
    (config.error as Error | null) ??
    (roundsQ.error as Error | null) ??
    (teamQ.error as Error | null) ??
    (tradesQ.error as Error | null) ??
    (selectionsQ.error as Error | null) ??
    (poolQ.error as Error | null) ??
    (lockedQ.error as Error | null) ??
    null;

  return {
    isLoading:
      config.isLoading ||
      roundsQ.isLoading ||
      teamQ.isLoading ||
      poolQ.isLoading ||
      (!!teamId && (tradesQ.isLoading || selectionsQ.isLoading)),
    error,
    seasonId,
    seasonLocked,
    config: config.data,
    rounds,
    activeRound,
    openRounds,
    roundSeqById,
    allRoundsLocked: rounds.length > 0 && openRounds.length === 0,
    team: teamQ.data ? { id: teamQ.data.id, name: teamQ.data.name } : null,
    trades,
    selections,
    selectionsLoaded: !teamId || selectionsQ.isSuccess,
    selectionsForActiveRound,
    priorSelections,
    pool,
    poolById,
    midMatchLocked,
    holdings: holdingViews,
    capRemaining,
    investedValue,
    teamValue,
    budget,
    priceOf,
    refetch: () => {
      void qc.invalidateQueries({ queryKey: ["team-trades"] });
      void qc.invalidateQueries({ queryKey: ["team-selections"] });
      void qc.invalidateQueries({ queryKey: ["my-team"] });
      void qc.invalidateQueries({ queryKey: ["team-pool"] });
    },
  };
}
