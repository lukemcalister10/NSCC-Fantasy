import { useState } from "react";
import { useSeason } from "../lib/queries";
import { useTeamState } from "../lib/useTeamState";
import {
  executeTradeBatch,
  translateRefusal,
  type Refusal,
} from "../lib/teamMutations";
import {
  roleCounts,
  validateComposition,
  type RoleCarrier,
} from "../lib/squad";
import { Loading, ErrorState, EmptyState } from "../components/states";
import {
  CompositionMeter,
  LockNotice,
  PriceBasisNote,
  RefusalNotice,
  TeamTabs,
  TradeBudgetNotice,
} from "../components/team/TeamChrome";
import {
  PickerRoleFilters,
  PoolPicker,
  type RoleFilter,
} from "../components/team/SquadPicker";
import { RoleBadge } from "../components/RoleBadge";
import { PlayerAvailabilityDot } from "../components/PlayerAvailabilityDot";
import { money } from "../lib/format";
import { tradeBatchTotals } from "../lib/tradeBatch";
import type { PoolPlayer } from "../lib/teamQueries";
import "../styles/team.css";

/**
 * TRADES (/team/trades). One trade is one player out and one player in. A draft
 * can contain several trades, all written in one atomic ledger insertion. The
 * final roster, not each intermediate pair, is checked against composition.
 *
 * Both directions of the mid-match lock are surfaced (D7/G6): a player whose
 * match has started but is not finalised can be neither bought NOR sold, and the
 * row says so rather than going quietly grey.
 *
 * The statement-level trigger materialises selections from the completed ledger
 * insert. There is no separate client-side selection write.
 */
export function Trades() {
  const season = useSeason();
  const seasonId = season.data?.id;
  const seasonLocked = season.data?.locked_at !== null && season.data?.locked_at !== undefined;
  const state = useTeamState(seasonId, seasonLocked);

  const [sellIds, setSellIds] = useState<Set<string>>(() => new Set());
  const [buyIds, setBuyIds] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("ALL");

  const squad = state.config?.squad;

  if (season.isLoading || state.isLoading) return <Loading />;
  if (season.error) return <ErrorState error={season.error} />;
  if (state.error) return <ErrorState error={state.error} />;

  if (!state.team || !squad) {
    return (
      <div className="page">
        <h1 className="page-title">Trades</h1>
        <TeamTabs />
        <EmptyState>
          Register a team and build a squad first — trading starts from holdings.
        </EmptyState>
      </div>
    );
  }

  if (state.holdings.length === 0) {
    return (
      <div className="page">
        <h1 className="page-title">Trades</h1>
        <TeamTabs />
        <LockNotice activeRound={state.activeRound} allRoundsLocked={state.allRoundsLocked} />
        <EmptyState>
          You hold nobody yet. Build your initial squad on the Squad tab — founding buys
          consume zero trades (G15).
        </EmptyState>
      </div>
    );
  }

  const budget = state.budget;
  const maxBatch = Math.min(3, budget?.initialBuild ? squad.tradesPerRound : (budget?.remaining ?? 0));
  const sells = state.holdings.filter((h) => sellIds.has(h.playerId));
  const buys = [...buyIds]
    .map((id) => state.poolById.get(id))
    .filter((p): p is PoolPlayer => !!p);
  const { saleProceeds, buyCost, cashAvailable, capAfter } = tradeBatchTotals(
    state.capRemaining ?? 0,
    sells.map((h) => h.currentPrice ?? 0),
    buys.map((p) => p.priceEnteringRound ?? 0),
  );

  const afterCarriers: RoleCarrier[] = [
    ...state.holdings.filter((h) => !sellIds.has(h.playerId)).map((h) => h.playerId),
    ...buyIds,
  ]
    .map((id) => state.poolById.get(id))
    .filter((p): p is PoolPlayer => !!p)
    .map((p) => ({ role: p.role, wk_eligible: p.wk_eligible }));

  const noTradesLeft =
    budget !== null && !budget.initialBuild && (budget.remaining ?? 0) <= 0;
  const resultsPending = !!state.activeRound && state.rounds.some(
    (round) => round.seq < state.activeRound!.seq &&
      new Date(round.lock_at).getTime() <= Date.now() &&
      round.matches.some((match) =>
        match.status !== "finalised" && match.status !== "abandoned"),
  );

  const blockers: string[] = [];
  if (state.activeRound === null) blockers.push("Every round has locked.");
  if (resultsPending)
    blockers.push("Trading reopens when the previous round's results and prices are processed.");
  if (noTradesLeft) blockers.push("No trades remaining this round.");
  if (sellIds.size !== sells.length || buyIds.size !== buys.length)
    blockers.push("Your squad or player pool has changed. Clear this draft and choose again.");
  if (buys.some((p) => state.holdings.some((h) => h.playerId === p.id)))
    blockers.push("A selected trade-in is already in your squad. Clear this draft and choose again.");
  if (sells.length > maxBatch) blockers.push(`Choose no more than ${maxBatch} trades.`);
  if (sells.some((h) => h.midMatchLocked) || buys.some((p) => state.midMatchLocked.has(p.id)))
    blockers.push("A selected player's match is in progress, so they cannot be traded.");
  if (sells.some((h) => h.currentPrice === null) || buys.some((p) => p.priceEnteringRound === null) || state.capRemaining === null)
    blockers.push("A current price is unavailable. Please refresh before trading.");
  if (sells.length > 0 && sells.length === buys.length) {
    if (capAfter < 0) blockers.push(`These trades exceed your salary cap by ${money(-capAfter)}.`);
    for (const problem of validateComposition(afterCarriers, squad)) blockers.push(problem.message);
  }

  const ready = sells.length > 0 && sells.length === buys.length && blockers.length === 0 && !!state.activeRound;

  const submit = async () => {
    if (!ready || !state.activeRound || !state.team || busy) return;
    setBusy(true);
    setRefusal(null);
    setDone(null);
    const roundId = state.activeRound.id;
    try {
      // One INSERT, one transaction. If any guard refuses, none of the rows land.
      await executeTradeBatch({
        teamId: state.team.id,
        roundId,
        sells: sells.map((h) => ({ playerId: h.playerId, price: h.currentPrice! })),
        buys: buys.map((p) => ({ playerId: p.id, price: p.priceEnteringRound! })),
      });
      setSellIds(new Set());
      setBuyIds(new Set());
      setDone(`${sells.length} ${sells.length === 1 ? "trade" : "trades"} completed for ${state.activeRound.name}.`);
    } catch (err) {
      setRefusal(translateRefusal(err));
    } finally {
      // A refresh failure must never be reported as a failed trade: the insert
      // may already have committed. Keep the submit button locked until refreshed.
      await state.refetch().catch(() => {});
      setBusy(false);
    }
  };

  const priceDivergence = state.pool.some(
    (p) =>
      p.priceEnteringRound !== null &&
      p.latestPrice !== null &&
      p.priceEnteringRound !== p.latestPrice,
  );

  const chooseTradeOut = (playerId: string) => {
    if (busy) return;
    setDone(null);
    setRefusal(null);
    const next = new Set(sellIds);
    if (next.has(playerId)) next.delete(playerId);
    else if (next.size < maxBatch) next.add(playerId);
    setSellIds(next);

    // Keep the existing one-for-one role shortcut; once several players are
    // moving together, show every role so valid cross-role batches stay visible.
    if (next.size === 1) {
      const onlyId = [...next][0]!;
      const player = state.poolById.get(onlyId);
      const counts = roleCounts(state.holdings
        .map((holding) => state.poolById.get(holding.playerId))
        .filter((candidate): candidate is PoolPlayer => !!candidate));
      const isFlexPlayer = player && counts[player.role] > (squad.roleMinimums[player.role] ?? 0);
      setRoleFilter(player && !isFlexPlayer ? player.role : "ALL");
    } else {
      setRoleFilter("ALL");
    }
  };

  const chooseTradeIn = (playerId: string) => {
    if (busy) return;
    setDone(null);
    setRefusal(null);
    setBuyIds((previous) => {
      const next = new Set(previous);
      if (next.has(playerId)) next.delete(playerId);
      else if (next.size < sellIds.size) next.add(playerId);
      return next;
    });
  };

  const clearDraft = () => {
    setSellIds(new Set());
    setBuyIds(new Set());
    setRefusal(null);
    setRoleFilter("ALL");
  };

  return (
    <div className="page">
      <h1 className="page-title">Trades</h1>
      <TeamTabs />

      <LockNotice activeRound={state.activeRound} allRoundsLocked={state.allRoundsLocked} />
      {resultsPending ? (
        <div className="lock-notice" role="status">
          Trading is paused while the previous round's results and prices are processed.
        </div>
      ) : null}
      {budget ? <TradeBudgetNotice budget={budget} /> : null}
      {refusal ? <RefusalNotice refusal={refusal} /> : null}
      {done ? (
        <div className="lock-notice lock-open" role="status">
          {done}
        </div>
      ) : null}

      <PriceBasisNote
        roundName={state.activeRound?.name ?? "this round"}
        divergent={priceDivergence}
      />

      <div className="trade-cash" aria-label="Trade budget">
        <span>Cash to spend <strong className="num">{money(cashAvailable)}</strong><small>{money(state.capRemaining)} spare + {money(saleProceeds)} from sales</small></span>
        <span>Trade-ins cost <strong className="num">{money(buyCost)}</strong></span>
        <span>Cash left <strong className={`num${capAfter < 0 ? " over" : ""}`}>{money(capAfter)}</strong></span>
      </div>

      <div className="trade-grid">
        <section className="trade-side trade-out-side">
          <h2 className="section-title">1. Trade out <span className="trade-step-count">{sells.length}/{maxBatch}</span></h2>
          <p className="trade-step-note">{maxBatch > 0 ? `Select up to ${maxBatch} ${maxBatch === 1 ? "player" : "players"}. Their sale prices are added to the cash you can spend.` : "No trades are available for this round."}</p>
          <ul className="picker-list">
            {state.holdings.map((h) => {
              const selected = sellIds.has(h.playerId);
              const locked = h.midMatchLocked;
              return (
                <li
                  key={h.playerId}
                  className={`picker-item${selected ? " picker-item-selected" : ""}${
                    locked ? " picker-item-blocked" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="picker-button"
                    disabled={busy || locked || (!selected && sellIds.size >= maxBatch)}
                    aria-pressed={selected}
                    onClick={() => chooseTradeOut(h.playerId)}
                  >
                    <span className="picker-name">
                      {h.player?.display_name ?? "—"}{" "}
                      <PlayerAvailabilityDot status={state.availability.get(h.playerId)} />
                    </span>
                    {h.player ? (
                      <RoleBadge role={h.player.role} wkEligible={h.player.wk_eligible} />
                    ) : null}
                    <span className="picker-price num">{money(h.currentPrice)}</span>
                    <span className="picker-mark" aria-hidden="true">
                      {selected ? "✓" : ""}
                    </span>
                  </button>
                  {locked ? (
                    <span className="blocked-reason">
                      <span aria-hidden="true">🔒</span> match in progress — cannot be
                      sold
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="trade-side trade-in-side">
          <div className="trade-in-heading">
            <h2 className="section-title">2. Trade in <span className="trade-step-count">{buys.length}/{sells.length}</span></h2>
            <div className="trade-role-controls">
              <span className="trade-filter-label">Filter trade-ins by role</span>
              <PickerRoleFilters value={roleFilter} onChange={setRoleFilter} />
            </div>
          </div>
          <p className="trade-step-note">{sells.length === 0 ? "Select a player to trade out first. Then choose the same number of replacements." : "Choose the same number of replacements. Any mix of roles is fine if the final squad meets its requirements."}</p>
          <PoolPicker
            pool={state.pool.filter(
              (p) => !state.holdings.some((h) => h.playerId === p.id),
            )}
            selectedIds={buyIds}
            onToggle={chooseTradeIn}
            emptyLabel="No available players."
            roleFilter={roleFilter}
            onRoleFilterChange={setRoleFilter}
            showRoleFilters={false}
            showSearch={false}
            disabled={busy}
            availability={state.availability}
            blockFor={(p) => {
              if (state.midMatchLocked.has(p.id)) {
                return {
                  blocked: true,
                  reason: "🔒 match in progress — cannot be bought",
                };
              }
              if (busy || sells.length === 0 || buys.length >= sells.length || p.priceEnteringRound === null) {
                return { blocked: true, reason: null };
              }
              if (cashAvailable - buyCost - p.priceEnteringRound < 0) {
                return { blocked: true, reason: null, priceUnavailable: true };
              }
              return { blocked: false, reason: null };
            }}
          />
        </section>
      </div>

      <div className="card trade-summary">
        <div className="trade-summary-heading">
          <h2 className="section-title">Review your trades</h2>
          {sellIds.size > 0 || buyIds.size > 0 ? (
            <button type="button" className="trade-clear" disabled={busy} onClick={clearDraft}>Clear choices</button>
          ) : null}
        </div>
        {sells.length > 0 || buys.length > 0 ? (
          <div className="trade-summary-columns">
            <div><h3>Out</h3><ul>{sells.map((h) => <li key={h.playerId}><span>{h.player?.display_name ?? "Player"}</span><span className="num">{money(h.currentPrice)}</span></li>)}</ul></div>
            <div><h3>In</h3><ul>{buys.map((p) => <li key={p.id}><span>{p.display_name}</span><span className="num">{money(p.priceEnteringRound)}</span></li>)}</ul></div>
          </div>
        ) : null}

        {sells.length === 0 ? (
          <p className="trade-step-note">Choose the players to trade out first.</p>
        ) : buys.length < sells.length ? (
          <p className="trade-step-note">Choose {sells.length - buys.length} more {sells.length - buys.length === 1 ? "player" : "players"} to trade in.</p>
        ) : buys.length > sells.length ? (
          <p className="trade-step-note">Remove {buys.length - sells.length} trade-in {buys.length - sells.length === 1 ? "selection" : "selections"}, or select more players to trade out.</p>
        ) : (
          <CompositionMeter players={afterCarriers} squad={squad} />
        )}

        {sells.length > 0 && state.selectionsForActiveRound.some((selection) =>
          sellIds.has(selection.player_id) && (selection.is_captain || selection.is_vice_captain),
        ) ? <p className="trade-step-note">Your captain or vice-captain is being traded out. Check your captaincy on the Squad page after confirming.</p> : null}

        {blockers.length > 0 ? (
          <ul className="problem-list">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : null}

        <button
          className="btn-primary"
          disabled={!ready || busy}
          onClick={() => void submit()}
        >
          {busy ? "Trading…" : `Confirm ${sells.length} ${sells.length === 1 ? "trade" : "trades"}`}
        </button>
      </div>
    </div>
  );
}
