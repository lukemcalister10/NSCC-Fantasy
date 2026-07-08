/**
 * Rounding convention for ALL price arithmetic (DECISION_LOG D4): round to the
 * nearest increment (fixture: $100), with halves rounding UP toward +infinity
 * (G14: "a raw result ending in $x50 rounds UP to the next $100").
 *
 * A small epsilon absorbs binary floating-point drift so a value that is
 * mathematically exactly on the .5 boundary (but stored as 617.4999999)
 * still rounds up. It is far smaller than any real price granularity.
 */
const HALF_UP_EPSILON = 1e-9;

export function roundToIncrement(value: number, increment: number): number {
  if (increment <= 0) {
    throw new Error(`rounding increment must be positive, got ${increment}`);
  }
  const quotient = value / increment;
  const rounded = Math.floor(quotient + 0.5 + HALF_UP_EPSILON);
  return rounded * increment;
}
