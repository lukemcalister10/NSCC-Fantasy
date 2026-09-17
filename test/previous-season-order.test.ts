import { describe, expect, it } from "vitest";
import { previousSeasonFor } from "../app/lib/previousSeason";

describe("previous-season profile order", () => {
  it("includes Jonathan Villanueva under his stable registry name", () => {
    const player = previousSeasonFor("Jonathan Villanueva");
    expect(player?.seasons).toHaveLength(1);
    expect(player?.seasons[0]).toMatchObject({
      season: "2025/26",
      grade: "5th Grade",
      matches: 9,
    });
  });

  it("shows 3rd Grade before 5th Grade", () => {
    const player = previousSeasonFor("Shivam Patel");
    expect(player?.seasons.map((line) => line.grade)).toEqual([
      "3rd Grade",
      "5th Grade",
    ]);
  });

  it("shows NCU 5th Grade before Manly 5th Grade", () => {
    const player = previousSeasonFor("Aaron Lay");
    expect(player?.seasons.map((line) => line.association)).toEqual([
      "Northern Cricket Union",
      "Manly Warringah Cricket Association",
    ]);
  });
});
