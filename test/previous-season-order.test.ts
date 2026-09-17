import { describe, expect, it } from "vitest";
import { previousSeasonFor } from "../app/lib/previousSeason";

describe("previous-season profile order", () => {
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
