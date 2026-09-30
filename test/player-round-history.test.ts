import { describe, expect, it } from "vitest";
import { playerRoundHistory } from "../app/lib/playerRoundHistory";
import type { PlayerProfile } from "../app/lib/queries";
import type { RoundBasic } from "../app/lib/teamQueries";

const rounds: RoundBasic[] = [1, 2, 3].map((seq) => ({
  id: `r${seq}`, seq, name: `Round ${seq}`, lock_at: "2026-09-01T00:00:00Z",
  matches: [{ id: `m${seq}`, status: seq === 3 ? "scheduled" : "finalised" }],
}));

function score(round: number, base: number): PlayerProfile["scores"][number] {
  return {
    match_id: `m${round}`, played: true, batting: base, bowling: 0, fielding: 0,
    bonuses: 0, second_innings_adjustment: 0, base,
    matches: { grade: "1st XI", opponent: "Visitors", status: "finalised",
      final_day_date: null, rounds: { name: `Round ${round}`, seq: round } },
  };
}

describe("player price history by round", () => {
  it("shows the score and price after each completed round, with no move for DNP", () => {
    const rows = playerRoundHistory({ starting_price: 20_000,
      priceHistory: [{ seq: 0, match_id: null, price: 20_000 },
        { seq: 1, match_id: "m1", price: 24_000 }],
      scores: [score(1, 60)],
    }, rounds);
    expect(rows).toEqual([
      { key: "start", label: "Starting price", score: null, price: 20_000, move: null },
      { key: "r1", label: "After Round 1", score: 60, price: 24_000, move: 4_000 },
      { key: "r2", label: "After Round 2", score: "DNP", price: 24_000, move: null },
    ]);
  });

  it("treats a played zero as zero, not DNP", () => {
    const rows = playerRoundHistory({ starting_price: 20_000,
      priceHistory: [{ seq: 0, match_id: null, price: 20_000 },
        { seq: 1, match_id: "m1", price: 19_000 }],
      scores: [score(1, 0)],
    }, rounds);
    expect(rows[1]).toMatchObject({ score: 0, price: 19_000, move: -1_000 });
  });

  it("does not claim a price when a played score has no published price entry", () => {
    const rows = playerRoundHistory({ starting_price: 20_000,
      priceHistory: [{ seq: 0, match_id: null, price: 20_000 }],
      scores: [score(1, 30)],
    }, rounds);
    expect(rows[1]).toMatchObject({ score: 30, price: null, move: null });
  });
});
