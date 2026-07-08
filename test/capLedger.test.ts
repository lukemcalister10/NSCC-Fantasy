import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { CapLedger } from "../src/engines/capLedger.js";

describe("G2 CAP_LEDGER — operator worked example, verbatim", () => {
  it("reproduces the buy / rise / sell walkthrough", () => {
    const cap = FIXTURE_CONFIG.squad.cap; // $1,000,000
    const ledger = new CapLedger(cap);

    // Buy the focus player at $100,000; other purchases total $850,000 so that
    // cap remaining lands at $50,000 (a full 6-player fixture team).
    ledger.buy("focus", 100_000, 1);
    ledger.buy("p2", 200_000, 1);
    ledger.buy("p3", 200_000, 1);
    ledger.buy("p4", 200_000, 1);
    ledger.buy("p5", 150_000, 1);
    ledger.buy("p6", 100_000, 1);
    expect(ledger.capRemaining()).toBe(50_000);

    // The focus player rises to $150,000 (current prices from derived pricing).
    const prices: Record<string, number> = {
      focus: 150_000,
      p2: 200_000,
      p3: 200_000,
      p4: 200_000,
      p5: 150_000,
      p6: 100_000,
    };
    const priceOf = (id: string): number => prices[id] ?? 0;

    // Invested (Σ current prices) is $1,000,000 after the rise; portfolio team
    // value (cap remaining + invested) is $1,050,000 per the gate.
    expect(ledger.investedValue(priceOf)).toBe(1_000_000);
    expect(ledger.teamValue(priceOf)).toBe(1_050_000);
    // Team value reflects the rise; cap remaining does NOT.
    expect(ledger.capRemaining()).toBe(50_000);

    // Sell the focus player: credited $150,000 (price at time of sale).
    ledger.sell("focus", 150_000, 2);
    expect(ledger.capRemaining()).toBe(200_000);
  });

  it("buying charges price-at-time, not starting price", () => {
    const ledger = new CapLedger(1_000_000);
    ledger.buy("x", 100_000, 1); // starting price
    ledger.sell("x", 150_000, 2); // sold after a rise
    // Re-buying x now costs his current (risen) price, not the original $100,000.
    ledger.buy("x", 150_000, 3);
    // remaining = 1,000,000 − (100,000 + 150,000) + 150,000 = 900,000.
    expect(ledger.capRemaining()).toBe(900_000);
  });
});
