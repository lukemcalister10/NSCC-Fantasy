import { sortLedger, type TradeRow } from "./squad";

export interface CompletedTradeBatch {
  createdAt: string;
  buyTradeId: string;
  buys: TradeRow[];
  sells: TradeRow[];
  /** Only the newest ledger submission can be removed without unravelling later trades. */
  isLatest: boolean;
}

/** Every row in an atomic trade INSERT receives the same Postgres now() value. */
export function completedTradeBatches(trades: TradeRow[], roundId: string): CompletedTradeBatch[] {
  const sorted = sortLedger(trades);
  const latest = sorted.at(-1)?.created_at;
  const groups = new Map<string, TradeRow[]>();
  for (const trade of sorted) {
    if (trade.round_id !== roundId) continue;
    groups.set(trade.created_at, [...(groups.get(trade.created_at) ?? []), trade]);
  }
  return [...groups.entries()].reverse().flatMap(([createdAt, rows]) => {
    const buys = rows.filter((row) => row.kind === "buy");
    const sells = rows.filter((row) => row.kind === "sell");
    if (buys.length === 0 || buys.length !== sells.length) return [];
    return [{ createdAt, buyTradeId: buys[0]!.id, buys, sells, isLatest: createdAt === latest }];
  });
}
