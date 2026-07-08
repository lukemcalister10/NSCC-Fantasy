import { describe, expect, it } from "vitest";
import { roundToIncrement } from "../src/engines/rounding.js";

describe("rounding — nearest $100, half up (D4)", () => {
  it("rounds down below the half", () => {
    expect(roundToIncrement(61_749, 100)).toBe(61_700);
    expect(roundToIncrement(61_730, 100)).toBe(61_700);
  });

  it("rounds a half UP", () => {
    expect(roundToIncrement(61_750, 100)).toBe(61_800);
    expect(roundToIncrement(50, 100)).toBe(100);
    expect(roundToIncrement(9_050, 100)).toBe(9_100);
  });

  it("rounds up above the half", () => {
    expect(roundToIncrement(61_751, 100)).toBe(61_800);
  });

  it("leaves exact multiples unchanged", () => {
    expect(roundToIncrement(61_700, 100)).toBe(61_700);
    expect(roundToIncrement(0, 100)).toBe(0);
  });

  it("is robust to binary floating-point drift at the half boundary", () => {
    // 0.1 + 0.2 style drift must not push a true half down.
    expect(roundToIncrement(9000 + 0.5 * 100, 100)).toBe(9_100);
  });

  it("rejects a non-positive increment", () => {
    expect(() => roundToIncrement(100, 0)).toThrow();
  });
});
