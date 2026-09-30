import { describe, expect, it } from "vitest";
import { lastCompletedRoundOf } from "../app/lib/roundStatus";
import type { RoundBasic } from "../app/lib/teamQueries";

const round = (seq: number, statuses: string[]): RoundBasic => ({
  id: `round-${seq}`, seq, name: `Round ${seq}`, lock_at: "2026-09-19T01:00:00Z",
  matches: statuses.map((status, i) => ({ id: `match-${seq}-${i}`, status })),
});

describe("last published round for the player list", () => {
  it("uses the latest fully settled round, not the locked round still being scored", () => {
    const rounds = [round(1, ["finalised"]), round(2, ["finalised", "abandoned"]), round(3, ["finalised", "scheduled"])];
    expect(lastCompletedRoundOf(rounds)?.seq).toBe(2);
  });

  it("does not treat an empty future round as completed", () => {
    expect(lastCompletedRoundOf([round(1, ["finalised"]), round(2, [])])?.seq).toBe(1);
    expect(lastCompletedRoundOf([round(1, ["scheduled"])])).toBeNull();
  });
});
