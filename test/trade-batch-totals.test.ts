import { describe, expect, it } from "vitest";
import { tradeBatchTotals } from "../app/lib/tradeBatch";

describe("batch trade cash", () => {
  it("pools every sale before judging the combined replacements", () => {
    expect(tradeBatchTotals(10_000, [25_000, 30_000, 20_000], [40_000, 25_000, 15_000]))
      .toEqual({ saleProceeds: 75_000, buyCost: 80_000, cashAvailable: 85_000, capAfter: 5_000 });
  });

  it("does not mistake unspent cap or prior purchase prices for sale proceeds", () => {
    expect(tradeBatchTotals(7_000, [11_000], [19_000]).capAfter).toBe(-1_000);
    expect(tradeBatchTotals(7_000, [11_000], []).cashAvailable).toBe(18_000);
  });
});
