/** Engine-core public surface. Config-driven; no economy constants in code. */
export * from "./config/types.js";
export { FIXTURE_CONFIG } from "./config/fixture.js";
export * from "./types.js";
export { roundToIncrement } from "./engines/rounding.js";
export { scoreMatch, oversToBalls } from "./engines/scoring.js";
export { parseDismissal } from "./engines/dismissal.js";
export type { FieldingCredit, FieldingKind } from "./engines/dismissal.js";
export { repriceAfterMatch, repriceOverMatches } from "./engines/pricing.js";
export { startingPrice } from "./engines/startingPrice.js";
export { CapLedger } from "./engines/capLedger.js";
export type { LedgerTxn, LedgerTxnKind, Holding } from "./engines/capLedger.js";

// Recompute + persistence (partial G3: scores/prices/cap).
export { recomputeSeason } from "./recompute/orchestrator.js";
export * from "./recompute/types.js";
export {
  loadRawSeason,
  writeDerived,
  readDerived,
} from "./db/repository.js";
export type { DbClient } from "./db/repository.js";
