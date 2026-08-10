import { useMemo, useState } from "react";
import { useSeason } from "../lib/queries";
import { useTeamState } from "../lib/useTeamState";
import {
  executeTradePair,
  translateRefusal,
  type Refusal,
} from "../lib/teamMutations";
import { validateComposition, type Holding, type RoleCarrier } from "../lib/squad";
import { Loading, ErrorState, EmptyState } from "../components/states";
import {
  CapStrip,
  CompositionMeter,
  LockNotice,
  PriceBasisNote,
  RefusalNotice,
  TeamTabs,
  TradeBudgetNotice,
} from "../components/team/TeamChrome";
import { PoolPicker } from "../components/team/SquadPicker";
import { RoleBadge } from "../components/RoleBadge";
import { money } from "../lib/format";
import type { PoolPlayer } from "../lib/teamQueries";
import "../styles/team.css";

/**
 * TRADES (/team/trades). ONE TRADE = ONE SELL + ONE BUY PAIR (G15), bought at the
 * price entering the open round (Rider 2 — see squad.ts). The per-round limit is
 * read from config (O1); nothing here knows what the number is.
 *
 * Both directions of the mid-match lock are surfaced (D7/G6): a player whose
 * match has started but is not finalised can be neither bought NOR sold, and the
 * row says so rather than going quietly grey.
 *
 * Write order is LEDGER FIRST, then selections — the ledger is authoritative, so
 * if the second write is lost the squad view detects the divergence and offers a
 * repair that rewrites selections from the ledger.
 */
export function Trades() {
  const season = useSeason();
  const seasonId = season.data?.id;
  const seasonLocked = season.data?.locked_at !== null && season.data?.locked_at !== undefined;
  const state = useTeamState(seasonId, seasonLocked);

  const [sellId, setSellId] = useState<string | null>(null);
  const [buyId, setBuyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const squad = state.config?.squad;

  const sell = sellId ? state.holdings.find((h) => h.playerId === sellId) : undefined;
  const buy = buyId ? state.poolById.get(buyId) : undefined;

  /** Holdings as they would stand after this pair — what every check below judges. */
  const afterHoldings = useMemo<Holding[]>(() => {
    const base = state.holdings.map((h) => ({
      playerId: h.playerId,
      purchasePrice: h.purchasePrice,
      purchaseRoundId: h.purchaseRoundId,
    }));
    if (!sell || !buy || !state.activeRound) return base;
    return [
      ...base.filter((h) => h.playerId !== sell.playerId),
      {
        playerId: buy.id,
        purchasePrice: buy.priceEnteringRound ?? 0,
        purchaseRoundId: state.activeRound.id,
      },
    ];
  }, [state.holdings, sell, buy, state.activeRound]);

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

  const afterCarriers: RoleCarrier[] = afterHoldings
    .map((h) => state.poolById.get(h.playerId))
    .filter((p): p is PoolPlayer => !!p)
    .map((p) => ({ role: p.role, wk_eligible: p.wk_eligible }));

  const sellPrice = sell?.currentPrice ?? 0;
  const buyPrice = buy?.priceEnteringRound ?? 0;
  const capAfter = (state.capRemaining ?? 0) + sellPrice - buyPrice;
  const problems = validateComposition(afterCarriers, squad);
  const budget = state.budget;

  const noTradesLeft =
    budget !== null && !budget.initialBuild && (budget.remaining ?? 0) <= 0;

  const blockers: string[] = [];
  if (state.activeRound === null) blockers.push("Every round has locked (D6/G4).");
  if (noTradesLeft)
    blockers.push(
      `No trades remaining this round — the limit is ${budget?.limit} (O1, from config).`,
    );
  if (sell && sell.midMatchLocked)
    blockers.push(
      `${sell.player?.display_name ?? "That player"}'s match is in progress — he cannot be sold until it is finalised or abandoned (D7/G6).`,
    );
  if (buy && state.midMatchLocked.has(buy.id))
    blockers.push(
      `${buy.display_name}'s match is in progress — he cannot be bought until it is finalised or abandoned (D7/G6).`,
    );
  if (sell && buy && capAfter < 0)
    blockers.push(`That pair goes over the salary cap by ${money(-capAfter)}.`);
  if (sell && buy) for (const p of problems) blockers.push(p.message);

  const ready = !!sell && !!buy && blockers.length === 0 && !!state.activeRound;

  const submit = async () => {
    if (!sell || !buy || !state.activeRound || !state.team) return;
    setBusy(true);
    setRefusal(null);
    setDone(null);
    const roundId = state.activeRound.id;
    try {
      // 1. LEDGER (atomic pair: one request, one transaction — the sale funds the
      //    purchase regardless of row order, exactly as the cap guard expects).
      await executeTradePair({
        teamId: state.team.id,
        roundId,
        sell: { playerId: sell.playerId, price: sellPrice },
        buy: { playerId: buy.id, price: buyPrice },
      });

      // 2. SELECTIONS — NOTHING TO DO HERE ANY MORE (D26 / migration 0010).
      //    The trades insert above fires app.materialise_selections inside its OWN
      //    transaction, for every open round of this team, carrying captaincy
      //    forward exactly as resolveCaptaincy would (and promoting if the captain
      //    was the player just sold, so Rider 1 still holds). This screen used to
      //    do it in a second request; keeping that would mean two writers of the
      //    same rows, which D26 rules out — and it is what tripped C7's duplicate
      //    key. It also means the ledger write and the materialisation are now
      //    atomic together, which no client round-trip could guarantee (F2/F3).

      setSellId(null);
      setBuyId(null);
      setDone(
        `Traded ${sell.player?.display_name ?? "player"} out for ${buy.display_name} in ${state.activeRound.name}.`,
      );
      state.refetch();
    } catch (err) {
      setRefusal(translateRefusal(err));
      state.refetch();
    } finally {
      setBusy(false);
    }
  };

  const priceDivergence = state.pool.some(
    (p) =>
      p.priceEnteringRound !== null &&
      p.latestPrice !== null &&
      p.priceEnteringRound !== p.latestPrice,
  );

  return (
    <div className="page">
      <h1 className="page-title">Trades</h1>
      <TeamTabs />

      <LockNotice activeRound={state.activeRound} allRoundsLocked={state.allRoundsLocked} />
      {budget ? <TradeBudgetNotice budget={budget} /> : null}
      {refusal ? <RefusalNotice refusal={refusal} /> : null}
      {done ? (
        <div className="lock-notice lock-open" role="status">
          {done}
        </div>
      ) : null}

      {state.capRemaining !== null &&
      state.investedValue !== null &&
      state.teamValue !== null ? (
        <CapStrip
          cap={squad.cap}
          capRemaining={state.capRemaining}
          investedValue={state.investedValue}
          teamValue={state.teamValue}
        />
      ) : null}

      <PriceBasisNote
        roundName={state.activeRound?.name ?? "this round"}
        divergent={priceDivergence}
      />

      <div className="trade-grid">
        <section className="trade-side">
          <h2 className="section-title">Trade out</h2>
          <ul className="picker-list">
            {state.holdings.map((h) => {
              const selected = sellId === h.playerId;
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
                    disabled={locked}
                    aria-pressed={selected}
                    onClick={() => setSellId(selected ? null : h.playerId)}
                  >
                    <span className="picker-name">{h.player?.display_name ?? "—"}</span>
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
                      sold (D7/G6)
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="trade-side">
          <h2 className="section-title">Trade in</h2>
          <PoolPicker
            mode="single"
            pool={state.pool.filter(
              (p) => !state.holdings.some((h) => h.playerId === p.id),
            )}
            selectedIds={new Set(buyId ? [buyId] : [])}
            onToggle={(id) => setBuyId(buyId === id ? null : id)}
            emptyLabel="No available players."
            blockFor={(p) => {
              if (state.midMatchLocked.has(p.id)) {
                return {
                  blocked: true,
                  reason: "🔒 match in progress — cannot be bought (D7/G6)",
                };
              }
              if (sell && (state.capRemaining ?? 0) + sellPrice - (p.priceEnteringRound ?? 0) < 0) {
                return { blocked: true, reason: "Not enough cap, even after the sale." };
              }
              return { blocked: false, reason: null };
            }}
          />
        </section>
      </div>

      <div className="card trade-summary">
        <h2 className="section-title">This trade</h2>
        {sell && buy ? (
          <>
            <p className="trade-line">
              <strong>Out:</strong> {sell.player?.display_name} at{" "}
              <span className="num">{money(sellPrice)}</span> ·{" "}
              <strong>In:</strong> {buy.display_name} at{" "}
              <span className="num">{money(buyPrice)}</span>
            </p>
            <p className="trade-line">
              Cap remaining after this trade:{" "}
              <strong className={`num${capAfter < 0 ? " over" : ""}`}>
                {money(capAfter)}
              </strong>
            </p>
            <CompositionMeter players={afterCarriers} squad={squad} />
          </>
        ) : (
          <p className="page-sub">
            Pick one player to trade out and one to trade in. One trade is one sell and
            one buy — they are written together, so a half-trade is not possible.
          </p>
        )}

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
          {busy ? "Trading…" : "Confirm trade"}
        </button>
      </div>
    </div>
  );
}
