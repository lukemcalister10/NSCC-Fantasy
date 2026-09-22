import { describe, expect, it } from "vitest";
import { mapClubAvailability, type ClubAvailabilityMatch } from "../app/lib/clubAvailabilityMapping";

const round = {
  name: "Round 2",
  matches: [
    { grade: "1st XI", opponent: "Beacon Hill Hawks" },
    { grade: "2nd XI", opponent: "Peninsula 3rd Grade" },
  ],
};
const players = [
  { id: "fantasy-jono", registry_key: "Jonathan Villanueva", display_name: "Jono Villanueva" },
  { id: "fantasy-joe", registry_key: "Joe Whyte", display_name: "Joe Whyte" },
  { id: "fantasy-jack", registry_key: "Jack Pearse", display_name: "Jack Pearse" },
  { id: "fantasy-jaan", registry_key: "Jaan Tulsiani", display_name: "Jaan Tulsiani" },
];

describe("club availability matching", () => {
  it("matches a shortened player by stable club ID and a new player by confirmed alias", () => {
    const feed: ClubAvailabilityMatch[] = [
      { team: "1st XI", opponent: "Beacon Hill Hawks", round: "Round 2", players: [
        { playerId: "fe54f44a-bbab-476c-ac00-95f7ffb7af87", name: "Jonathan Villanueva", status: "available", role: null },
        { playerId: "club-jack", name: "Jack Pearse", status: "unavailable", role: null },
      ] },
      { team: "2nd XI", opponent: "Peninsula 3rd Grade", round: "Round 2", players: [
        { playerId: "club-joe", name: "Joseph Whyte", status: "selected", role: "core" },
      ] },
    ];
    const result = mapClubAvailability(round, players, feed);
    expect(result.matchedMatches).toBe(2);
    expect([...result.statuses]).toEqual([
      ["fantasy-jono", "available"],
      ["fantasy-jack", "unavailable"],
      ["fantasy-joe", "available"],
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it("leaves maybe and unanswered players without a dot, and ignores other rounds", () => {
    const feed: ClubAvailabilityMatch[] = [
      { team: "1st XI", opponent: "Beacon Hill Hawks", round: "Round 2", players: [
        { playerId: "club-jack", name: "Jack Pearse", status: "maybe", role: null },
      ] },
      { team: "1st XI", opponent: "Beacon Hill Hawks", round: "Round 3", players: [
        { playerId: "club-jack", name: "Jack Pearse", status: "available", role: null },
      ] },
    ];
    expect(mapClubAvailability(round, players, feed).statuses.size).toBe(0);
  });

  it("matches a corrected fantasy spelling to the club name", () => {
    const feed: ClubAvailabilityMatch[] = [{
      team: "1st XI", opponent: "Beacon Hill Hawks", round: "Round 2", players: [
        { playerId: "club-jaan", name: "Jaan Tulsani", status: "available", role: null },
      ],
    }];
    expect(mapClubAvailability(round, players, feed).statuses.get("fantasy-jaan")).toBe("available");
  });

  it("refuses ambiguous match and player identities", () => {
    const feed: ClubAvailabilityMatch[] = [
      { team: "1st XI", opponent: "Other A", round: "Round 2", players: [
        { playerId: "unknown", name: "Jack Pearse", status: "available", role: null },
      ] },
      { team: "1st XI", opponent: "Other B", round: "Round 2", players: [] },
    ];
    expect(mapClubAvailability(round, players, feed).matchedMatches).toBe(0);
    const duplicateNames = [...players, { id: "second-jack", registry_key: "Jack Pearse", display_name: "Jack Pearse" }];
    const exact = [{ ...feed[0]!, opponent: "Beacon Hill Hawks" }];
    const result = mapClubAvailability(round, duplicateNames, exact);
    expect(result.statuses.size).toBe(0);
    expect(result.unmatched).toEqual(["Jack Pearse"]);
  });
});
