/**
 * CAP LEDGER (KICKOFF Engine 3; DECISION_LOG D8).
 *
 *   cap remaining = starting_cap − Σ(purchase prices) + Σ(sale proceeds)
 *
 * Both sums are running totals over ALL transactions ever, not net of current
 * holdings: selling a player leaves his original purchase in Σ purchases and
 * adds his sale price to Σ sales. A price rise while held does NOT touch the cap
 * — it only moves team value (display-only, Σ current prices). Trade-in charges
 * the price at time of purchase, never the starting price.
 *
 * The transaction log is the derived-from-truth record (supports recompute
 * idempotence, G3). Gate: G2 (CAP_LEDGER worked example, verbatim).
 */

export type LedgerTxnKind = "buy" | "sell";

export interface LedgerTxn {
  kind: LedgerTxnKind;
  player: string;
  /** Purchase price (buy) or sale proceeds at time of sale (sell). */
  price: number;
  round: number;
}

export interface Holding {
  player: string;
  purchasePrice: number;
  purchaseRound: number;
}

export class CapLedger {
  private readonly startingCap: number;
  private readonly txns: LedgerTxn[] = [];
  private readonly holdings = new Map<string, Holding>();

  constructor(startingCap: number) {
    this.startingCap = startingCap;
  }

  buy(player: string, price: number, round: number): void {
    if (this.holdings.has(player)) {
      throw new Error(`already holding ${player}`);
    }
    this.txns.push({ kind: "buy", player, price, round });
    this.holdings.set(player, {
      player,
      purchasePrice: price,
      purchaseRound: round,
    });
  }

  /** Sell at the price at time of sale (D8). */
  sell(player: string, saleProceeds: number, round: number): void {
    if (!this.holdings.has(player)) {
      throw new Error(`not holding ${player}`);
    }
    this.txns.push({ kind: "sell", player, price: saleProceeds, round });
    this.holdings.delete(player);
  }

  /** cap remaining = starting_cap − Σ purchases + Σ sales. */
  capRemaining(): number {
    let purchases = 0;
    let sales = 0;
    for (const t of this.txns) {
      if (t.kind === "buy") purchases += t.price;
      else sales += t.price;
    }
    return this.startingCap - purchases + sales;
  }

  /**
   * Invested value = Σ current prices of current holdings (D8's literal "Team
   * value = Σ current prices"). Excludes unspent cap. Display-only; price rises
   * never touch the cap.
   */
  investedValue(currentPrice: (player: string) => number): number {
    let total = 0;
    for (const h of this.holdings.values()) total += currentPrice(h.player);
    return total;
  }

  /**
   * Team value = cap remaining + Σ current holding prices (total portfolio).
   *
   * INTERPRETATION FLAG (for operator review): DECISION_LOG D8 phrases team
   * value as "Σ current prices", but the operator's frozen worked example
   * (Gate G2) requires team value = $1,050,000 with cap remaining $50,000 after
   * a single holding rises 100k -> 150k on $950,000 of purchases. Σ current
   * prices alone is $1,000,000 there; only cap-remaining + Σ current reproduces
   * $1,050,000. The frozen gate is authoritative, so this is what "team value"
   * means. `investedValue()` remains available for the D8-literal figure.
   */
  teamValue(currentPrice: (player: string) => number): number {
    return this.capRemaining() + this.investedValue(currentPrice);
  }

  currentHoldings(): Holding[] {
    return [...this.holdings.values()];
  }

  transactions(): readonly LedgerTxn[] {
    return this.txns;
  }
}
