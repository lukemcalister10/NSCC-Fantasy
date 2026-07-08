import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG } from "../src/config/fixture.js";
import { startingPrice } from "../src/engines/startingPrice.js";

const pricing = FIXTURE_CONFIG.pricing;

describe("G14 STARTING_PRICE", () => {
  it("player averaging 61 prices by games in lineup (1/2/3/4)", () => {
    expect(startingPrice(61, 1, pricing)).toBe(22_000);
    expect(startingPrice(61, 2, pricing)).toBe(35_000);
    expect(startingPrice(61, 3, pricing)).toBe(48_000);
    expect(startingPrice(61, 4, pricing)).toBe(61_000);
  });

  it("g caps at 4: a 6-game player averaging 61 -> $61,000", () => {
    expect(startingPrice(61, 6, pricing)).toBe(61_000);
    expect(startingPrice(61, 20, pricing)).toBe(61_000);
  });

  it("zero-history player -> floor $9,000", () => {
    expect(startingPrice(61, 0, pricing)).toBe(9_000);
    expect(startingPrice(0, 0, pricing)).toBe(9_000);
  });

  it("player averaging 5 over 4 games clamps at the $9,000 floor", () => {
    // perf = 1000·5 = 5000 < floor -> clamp.
    expect(startingPrice(5, 4, pricing)).toBe(9_000);
  });

  it("a raw result ending in $x50 rounds UP to the next $100", () => {
    // avg 9.1, g=2: perf 9100; raw = 9000 + 0.5·100 = 9050 -> 9100.
    expect(startingPrice(9.1, 2, pricing)).toBe(9_100);
  });
});
