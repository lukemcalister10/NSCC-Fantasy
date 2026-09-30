import { describe, expect, it } from "vitest";
import { evaluateRoundFreeze } from "../app/lib/roundFreezeAudit";
import type { FreezeMatch } from "../app/lib/roundFreezeAudit";

const match: FreezeMatch = {
  id: "match-1", grade: "1st XI", opponent: "Visitors",
  status: "finalised", finalised_at: "2026-09-30T00:00:00Z",
};
const cards = [{ id: "card-1", match_id: match.id, review_state: "committed" as const }];
const lineup = [{ scorecard_id: "card-1", player_id: "p1" }];
const scores = [{ match_id: match.id, player_id: "p1", played: true }];
const prices = [{ match_id: match.id, player_id: "p1" }];

describe("round freeze coverage audit", () => {
  it("passes a finalised match whose published rows match the named players", () => {
    const audit = evaluateRoundFreeze([match], cards, lineup, scores, prices);
    expect(audit.blockers).toEqual([]);
    expect(audit.matches[0]?.lineup).toEqual(["p1"]);
  });

  it("blocks missing or draft scorecards", () => {
    expect(evaluateRoundFreeze([match], [], [], [], []).blockers.join(" ")).toContain("Scorecard is missing");
    expect(evaluateRoundFreeze([match], [{ ...cards[0]!, review_state: "draft" }], lineup, scores, prices)
      .blockers.join(" ")).toContain("still a draft");
  });

  it("blocks a score row that marks a named player as DNP and missing prices", () => {
    const audit = evaluateRoundFreeze([match], cards, lineup,
      [{ ...scores[0]!, played: false }], []);
    expect(audit.blockers.join(" ")).toContain("Published player scores do not match");
    expect(audit.blockers.join(" ")).toContain("Published price entries do not match");
  });

  it("allows an abandoned match only when no derived rows remain", () => {
    const abandoned = { ...match, status: "abandoned" as const, finalised_at: null };
    expect(evaluateRoundFreeze([abandoned], [], [], [], []).blockers).toEqual([]);
    expect(evaluateRoundFreeze([abandoned], [], [], scores, []).blockers.join(" "))
      .toContain("Abandoned match still has published scores");
  });

  it("blocks a scheduled match or an empty round", () => {
    expect(evaluateRoundFreeze([{ ...match, status: "scheduled" }], [], [], [], [])
      .blockers.join(" ")).toContain("Match is not finalised");
    expect(evaluateRoundFreeze([], [], [], [], []).blockers).toHaveLength(1);
  });
});
