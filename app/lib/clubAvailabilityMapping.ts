import { nameMatchKey } from "../../src/registry/nameNormalisation";
import { previousSeasonFor } from "./previousSeason";
import type { PlayerAvailabilityStatus } from "./playerAvailability";

export interface ClubAvailabilityPlayer {
  playerId: string;
  name: string;
  status: "not-asked" | "silent" | "maybe" | "available" | "unavailable" | "selected";
  role: string | null;
}
export interface ClubAvailabilityMatch {
  team: string;
  opponent: string;
  round: string;
  players: ClubAvailabilityPlayer[];
}
export interface AvailabilityIdentity {
  id: string;
  registry_key: string;
  display_name: string;
}
export interface AvailabilityRound {
  name: string;
  matches: { grade: string; opponent: string }[];
}

// Confirmed club/fantasy name variants not covered by the previous-season ID map.
const clubAliases: Record<string, string> = {
  "benjamin o'sullivan": "ben o'sullivan",
  "charles antoniades": "charlie antoniades",
  "jaan tulsani": "jaan tulsiani",
  "jonathan villanueva": "jono villanueva",
  "joseph whyte": "joe whyte",
  "joshua marks": "josh marks",
  "joshua smythe": "josh smythe",
  "lakshman nirthanakumaran": "laksh nirthanakumaran",
  "matthew smith": "mat smith",
  "mohammed hasnain": "mohammad hasnain",
  "nicholas paton": "nick paton",
  "robert gower": "rob gower",
  "robert wong": "robbie wong",
  "sameer mutreja": "sameer muteja",
  "shivam patel": "shiv patel",
};

function uniqueNameMap(players: AvailabilityIdentity[]): Map<string, string | null> {
  const names = new Map<string, string | null>();
  for (const player of players) {
    for (const raw of [player.registry_key, player.display_name]) {
      const key = nameMatchKey(raw);
      if (!key) continue;
      if (!names.has(key)) names.set(key, player.id);
      else if (names.get(key) !== player.id) names.set(key, null);
    }
  }
  return names;
}

function dotStatus(player: ClubAvailabilityPlayer): PlayerAvailabilityStatus | null {
  if (player.status === "selected" || player.role !== null || player.status === "available") {
    return "available";
  }
  return player.status === "unavailable" ? "unavailable" : null;
}

export function mapClubAvailability(
  round: AvailabilityRound,
  players: AvailabilityIdentity[],
  feed: ClubAvailabilityMatch[],
): { statuses: Map<string, PlayerAvailabilityStatus>; unmatched: string[]; matchedMatches: number } {
  const byClubId = new Map<string, string>();
  for (const player of players) {
    const history = previousSeasonFor(player.registry_key);
    if (history?.clubPlayerId) byClubId.set(history.clubPlayerId, player.id);
  }
  const byName = uniqueNameMap(players);
  const statuses = new Map<string, PlayerAvailabilityStatus>();
  const unmatched = new Set<string>();
  let matchedMatches = 0;

  for (const fantasyMatch of round.matches) {
    const candidates = feed.filter((item) =>
      nameMatchKey(item.round) === nameMatchKey(round.name) &&
      nameMatchKey(item.team) === nameMatchKey(fantasyMatch.grade));
    const exact = candidates.filter((item) =>
      nameMatchKey(item.opponent) === nameMatchKey(fantasyMatch.opponent));
    const clubMatch = exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : null;
    if (!clubMatch) continue; // Never attach a status to an ambiguous match.
    matchedMatches += 1;

    for (const clubPlayer of clubMatch.players) {
      const key = nameMatchKey(clubPlayer.name);
      const alias = clubAliases[key];
      const direct = byName.get(key);
      const fantasyId = byClubId.get(clubPlayer.playerId) ??
        (direct === undefined && alias ? byName.get(alias) : direct);
      if (!fantasyId) {
        unmatched.add(clubPlayer.name);
        continue;
      }
      const next = dotStatus(clubPlayer);
      if (!next) continue;
      // A player available/named in one match is available for the round even
      // if another squad's availability list still says unavailable.
      if (next === "available" || !statuses.has(fantasyId)) statuses.set(fantasyId, next);
    }
  }
  return { statuses, unmatched: [...unmatched].sort(), matchedMatches };
}
