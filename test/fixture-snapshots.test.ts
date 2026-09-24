import { describe, expect, it } from "vitest";
import { latestLockedSquadRound } from "../app/lib/fixtureSnapshots";

const rounds = [
  { id: "first", seq: 1, lock_at: "2026-09-19T01:00:00Z" },
  { id: "second", seq: 2, lock_at: "2026-09-26T01:00:00Z" },
  { id: "third", seq: 3, lock_at: "2026-10-03T01:00:00Z" },
];

describe("matchup squad snapshot", () => {
  it("shows the last locked squad while a current round remains open", () => {
    expect(latestLockedSquadRound(rounds, 2, Date.parse("2026-09-24T00:00:00Z"))?.id).toBe("first");
  });
  it("switches to that round's frozen squad at lockout", () => {
    expect(latestLockedSquadRound(rounds, 2, Date.parse(rounds[1]!.lock_at))?.id).toBe("second");
  });
  it("never leaks a future round when viewing an old fixture", () => {
    expect(latestLockedSquadRound(rounds, 1, Date.parse("2026-10-10T00:00:00Z"))?.id).toBe("first");
  });
});
