import type { PlayerRole, SquadConfig } from "../../src/config/types";

/**
 * SQUAD / LEDGER ARITHMETIC — the client-side MIRROR of what the database
 * already enforces. Nothing here is authoritative: every rule below is also a
 * Postgres trigger (0003_selection_validation.sql / 0002_locks.sql), and the
 * database is the gatekeeper (D16). This module exists so the UI can say WHY an
 * action is unavailable BEFORE the round-trip — never so it can decide.
 *
 * Two disciplines this file must not break:
 *
 *   G11 / O1 / O2 — NO ECONOMY CONSTANTS. Every limit is read from the frozen
 *   season config (`SquadConfig`) passed in by the caller. There is no 6, 7, 9,
 *   11, no role minimum, no cap and no trade count written down anywhere in this
 *   slice. Change the config row and the UI changes with it, with no code change.
 *
 *   G15 FIDELITY — the composition logic below is a line-for-line mirror of
 *   `enforce_selection_composition()` (0003:44-132), including the STRICT
 *   no-double-count WK capacity. If the two ever disagree the DATABASE is right
 *   and this file is the bug.
 */

// ---------------------------------------------------------------------------
// Ledger → holdings
// ---------------------------------------------------------------------------

export type LedgerKind = "buy" | "sell";

/** A row of `trades`, as read from PostgREST. */
export interface TradeRow {
  id: string;
  fantasy_team_id: string;
  kind: LedgerKind;
  player_id: string;
  price: number;
  round_id: string;
  created_at: string;
}

export interface Holding {
  playerId: string;
  /** Price charged at time of purchase (D8) — never the starting price. */
  purchasePrice: number;
  purchaseRoundId: string;
}

/** Chronological ledger order — the same sort the recompute orchestrator uses
 *  (`orchestrator.ts:121`): created_at, then id as the stable tiebreak. */
export function sortLedger(trades: TradeRow[]): TradeRow[] {
  return [...trades].sort((a, b) =>
    a.created_at === b.created_at
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.created_at < b.created_at
        ? -1
        : 1,
  );
}

/**
 * Current holdings = replay of the whole ledger (buy adds, sell removes), in
 * chronological order. THE LEDGER IS AUTHORITATIVE (operator ruling): holdings
 * determine cap remaining, trade counts and — via materialisation — the round's
 * selection set. Selections never determine holdings.
 */
export function holdingsFromLedger(trades: TradeRow[]): Holding[] {
  const held = new Map<string, Holding>();
  for (const t of sortLedger(trades)) {
    if (t.kind === "buy") {
      held.set(t.player_id, {
        playerId: t.player_id,
        purchasePrice: t.price,
        purchaseRoundId: t.round_id,
      });
    } else {
      held.delete(t.player_id);
    }
  }
  return [...held.values()];
}

// ---------------------------------------------------------------------------
// Cap ledger (D8 + amendment A2; Gate G2 is authoritative)
// ---------------------------------------------------------------------------

/**
 * cap remaining = starting cap − Σ purchase prices + Σ sale proceeds.
 *
 * Both sums run over the WHOLE ledger, not net of current holdings: selling a
 * player leaves his purchase in Σ purchases and adds his sale price to Σ sales.
 * A price rise while held does NOT touch the cap. Identical to the guard in
 * 0003:214-224 and to `CapLedger.capRemaining()`.
 */
export function capRemaining(cap: number, trades: TradeRow[]): number {
  let purchases = 0;
  let sales = 0;
  for (const t of trades) {
    if (t.kind === "buy") purchases += t.price;
    else sales += t.price;
  }
  return cap - purchases + sales;
}

/** INVESTED VALUE = Σ CURRENT prices of current holdings, alone (D8). */
export function investedValue(
  holdings: Holding[],
  currentPriceOf: (playerId: string) => number,
): number {
  let total = 0;
  for (const h of holdings) total += currentPriceOf(h.playerId);
  return total;
}

/**
 * TEAM VALUE = cap remaining + Σ current prices (D8 as amended by A2).
 *
 * Gate G2 is the authority and is worked by hand in the slice report: cap
 * $1,000,000, $950,000 of purchases (cap remaining $50,000), one holding risen
 * $100,000 → $150,000 gives team value $1,050,000. Σ current prices ALONE is
 * $1,000,000 there — which is why the two figures must never share a label.
 */
export function teamValue(
  cap: number,
  trades: TradeRow[],
  holdings: Holding[],
  currentPriceOf: (playerId: string) => number,
): number {
  return capRemaining(cap, trades) + investedValue(holdings, currentPriceOf);
}

// ---------------------------------------------------------------------------
// Composition (G15(a) mirror)
// ---------------------------------------------------------------------------

export interface RoleCarrier {
  role: PlayerRole;
  wk_eligible: boolean;
}

export const ROLE_ORDER: PlayerRole[] = ["BAT", "WK", "BWL", "AR"];

export function roleCounts(players: RoleCarrier[]): Record<PlayerRole, number> {
  const c: Record<PlayerRole, number> = { BAT: 0, WK: 0, BWL: 0, AR: 0 };
  for (const p of players) c[p.role]++;
  return c;
}

/** FLEX = teamSize − Σ minimums: the unconstrained remainder, and the ONLY
 *  wildcard slot (O2/A7). At the fixture config it is zero. */
export function flexSlots(squad: SquadConfig): number {
  return squad.teamSize - totalMinimums(squad);
}

export function totalMinimums(squad: SquadConfig): number {
  return ROLE_ORDER.reduce((n, r) => n + (squad.roleMinimums[r] ?? 0), 0);
}

/**
 * WK capacity under STRICT no-double-count (0003:119-124). WK-role players are
 * free keepers; a `wk_eligible` non-WK can keep wicket only out of its OWN
 * role's surplus above that role's minimum. This is what rejects a squad that
 * leans on a wk_eligible player who is simultaneously needed to meet his own
 * role's minimum — a naive `count(WK OR wk_eligible)` would wrongly pass it.
 */
export function wkCapacity(
  players: RoleCarrier[],
  squad: SquadConfig,
): number {
  const counts = roleCounts(players);
  const mins = squad.roleMinimums;
  const wkEligibleIn = (role: PlayerRole): number =>
    players.filter((p) => p.role === role && p.wk_eligible).length;

  let capacity = counts.WK;
  for (const role of ["BAT", "BWL", "AR"] as const) {
    const surplus = Math.max(counts[role] - (mins[role] ?? 0), 0);
    capacity += Math.min(surplus, wkEligibleIn(role));
  }
  return capacity;
}

export interface CompositionProblem {
  /** The failing constraint, named — the UI must never refuse without one. */
  constraint: "size" | "role-minimum" | "wk-minimum";
  message: string;
}

/**
 * Mirror of `enforce_selection_composition()`, in the same order the trigger
 * evaluates: size, then strict own-role minimums for BAT/BWL/AR, then the WK
 * minimum by capacity. An EMPTY set is "not yet a squad", not a violation —
 * the trigger skips n = 0 the same way (the team simply didn't field).
 */
export function validateComposition(
  players: RoleCarrier[],
  squad: SquadConfig,
): CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  if (players.length === 0) return problems;

  if (players.length !== squad.teamSize) {
    problems.push({
      constraint: "size",
      message:
        players.length < squad.teamSize
          ? `Squad is ${squad.teamSize - players.length} short — team size must be exactly ${squad.teamSize}.`
          : `Squad is ${players.length - squad.teamSize} over — team size must be exactly ${squad.teamSize}.`,
    });
  }

  const counts = roleCounts(players);
  const mins = squad.roleMinimums;
  for (const role of ["BAT", "BWL", "AR"] as const) {
    const min = mins[role] ?? 0;
    if (counts[role] < min) {
      problems.push({
        constraint: "role-minimum",
        message: `${role} minimum not met — ${counts[role]} of ${min} required.`,
      });
    }
  }

  const minWk = mins.WK ?? 0;
  const capacity = wkCapacity(players, squad);
  if (capacity < minWk) {
    problems.push({
      constraint: "wk-minimum",
      message:
        `WK minimum ${minWk} not satisfiable — ${counts.WK} WK-role player(s) plus ` +
        `usable wk-eligible capacity ${capacity - counts.WK}. A wk-eligible player who is ` +
        `needed to meet his own role's minimum cannot also keep wicket.`,
    });
  }

  return problems;
}

/** Progress readout for the composition meter: met/required per role, plus flex. */
export interface CompositionProgress {
  role: PlayerRole;
  count: number;
  minimum: number;
  met: boolean;
}

export function compositionProgress(
  players: RoleCarrier[],
  squad: SquadConfig,
): CompositionProgress[] {
  const counts = roleCounts(players);
  return ROLE_ORDER.map((role) => ({
    role,
    count: counts[role],
    minimum: squad.roleMinimums[role] ?? 0,
    met: counts[role] >= (squad.roleMinimums[role] ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Trade counting (G15(b) mirror)
// ---------------------------------------------------------------------------

export interface TradeBudget {
  /** True when this team holds nothing entering the round — founding build. */
  initialBuild: boolean;
  used: number;
  limit: number;
  /** null while `initialBuild` — founding buys consume ZERO trades (G15). */
  remaining: number | null;
}

/**
 * Trades consumed in (team, round). One trade = one sell + one buy PAIR, so the
 * count charged against the limit is the number of BUYS (0003:192-211).
 *
 * INITIAL BUILD is exempt from the COUNT — and it is HOLDINGS-based, not
 * round-1-based: a team is constructing when it has no trade in ANY earlier
 * round, so a late entrant building in round 3 is still constructing. It is
 * still bound by size, composition and cap.
 */
export function tradeBudget(
  trades: TradeRow[],
  roundId: string,
  roundSeqById: Map<string, number>,
  squad: SquadConfig,
): TradeBudget {
  const currentSeq = roundSeqById.get(roundId) ?? 0;
  const hasPrior = trades.some(
    (t) => (roundSeqById.get(t.round_id) ?? 0) < currentSeq,
  );
  const used = trades.filter(
    (t) => t.round_id === roundId && t.kind === "buy",
  ).length;
  const limit = squad.tradesPerRound;
  return {
    initialBuild: !hasPrior,
    used,
    limit,
    remaining: hasPrior ? Math.max(limit - used, 0) : null,
  };
}

// ---------------------------------------------------------------------------
// Price entering round (RIDER 2 — recompute price-integrity)
// ---------------------------------------------------------------------------

export interface PricePoint {
  seq: number;
  price: number;
  /** null = the seq-0 starting seed. */
  match_id: string | null;
}

/**
 * The price a player carries ENTERING a round — the last movement recorded in a
 * round STRICTLY EARLIER than the target (mirror of `priceEnteringRound`,
 * orchestrator.ts:269-282).
 *
 * THIS, NOT THE LATEST PRICE, IS WHAT A TRADE MUST BE RECORDED AT. Recompute
 * asserts `trades.price === priceEnteringRound(player, trade round)` and THROWS
 * on mismatch (orchestrator.ts:135) — a trade written at the latest price would
 * not fail at write time, it would poison every later recompute. The two figures
 * are equal in the ordinary case and diverge only once a round contains a
 * finalised match while that round is still open.
 */
export function priceEnteringRound(
  history: PricePoint[],
  targetRoundSeq: number,
  roundSeqByMatchId: Map<string, number>,
): number | null {
  const sorted = [...history].sort((a, b) => a.seq - b.seq);
  if (sorted.length === 0) return null;
  let price = sorted[0]!.price; // seq 0 = seed
  for (const point of sorted) {
    if (point.match_id === null) continue;
    const seq = roundSeqByMatchId.get(point.match_id);
    if (seq === undefined) continue;
    if (seq < targetRoundSeq) price = point.price;
    else break; // movements are already in chronological order
  }
  return price;
}

/** The most recent price on record (last movement, else the seed). */
export function latestPrice(history: PricePoint[]): number | null {
  if (history.length === 0) return null;
  const sorted = [...history].sort((a, b) => a.seq - b.seq);
  return sorted[sorted.length - 1]!.price;
}

/** Movement = latest − previous (0 when only the seed exists). */
export function priceMovement(history: PricePoint[]): number {
  if (history.length < 2) return 0;
  const sorted = [...history].sort((a, b) => a.seq - b.seq);
  return sorted[sorted.length - 1]!.price - sorted[sorted.length - 2]!.price;
}
