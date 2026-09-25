/** Cash is fungible across a batch: every sale can fund every incoming player. */
export function tradeBatchTotals(
  capRemaining: number,
  salePrices: readonly number[],
  buyPrices: readonly number[],
) {
  const saleProceeds = salePrices.reduce((sum, price) => sum + price, 0);
  const buyCost = buyPrices.reduce((sum, price) => sum + price, 0);
  const cashAvailable = capRemaining + saleProceeds;
  return { saleProceeds, buyCost, cashAvailable, capAfter: cashAvailable - buyCost };
}
