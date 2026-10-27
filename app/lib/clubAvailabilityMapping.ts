import { nameMatchKey } from "../../src/registry/nameNormalisation";
import { previousSeasonFor } from "./previousSeason";
import type { PlayerAvailabilityStatus, DayStatus, DayNumber, DatedAvailability } from "./availabilityTypes";

export interface ClubAvailabilityPlayer {
  playerId: string;
  name: string;
  status: "not-asked" | "silent" | "maybe" | "available" | "unavailable" | "selected";
  role: string | null;
}
export interface ClubAvailabilityMatch {
  sessionId?: string | null;
  date?: string | null;
  dayNumber?: DayNumber | null;
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
  lock_at?: string;
  matches: { grade: string; opponent: string; final_day_date?: string | null }[];
}

// Confirmed club/fantasy name variants not covered by the previous-season ID map.
const clubAliases: Record<string, string> = {
  "andrew castellano": "andy castellano",
  "benjamin o'sullivan": "ben o'sullivan",
  "charles antoniades": "charlie antoniades",
  "douglas clark": "doug clark",
  "james st julian": "james st julien",
  "jaan tulsani": "jaan tulsiani",
  "jonathan villanueva": "jono villanueva",
  "joseph whyte": "joe whyte",
  "joshua marks": "josh marks",
  "joshua smythe": "josh smythe",
  "lakshman nirthanakumaran": "laksh nirthanakumaran",
  "matthew smith": "mat smith",
  "mohammed hasnain": "mohammad hasnain",
  "nicholas paton": "nick paton",
  "nishchal pangeni": "nish pangeni",
  "robert gower": "rob gower",
  "robert wong": "robbie wong",
  "sameer mutreja": "sameer muteja",
  "shivam patel": "shiv patel",
  "surasan wunnacharoensri": "sam wunnacharoensri",
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

function dotStatus(player: ClubAvailabilityPlayer, day: DayNumber): DayStatus | undefined {
  if (player.status === "unavailable") return "unavailable";
  const taggedDay=player.role === "day-one" ? 1 : player.role === "day-two" ? 2 : null;
  if (player.status === "available" || (player.status === "selected" && (!taggedDay || taggedDay===day)) ||
    (player.role !== null && player.role !== "sub" && (!taggedDay || taggedDay===day))) {
    return "available";
  }
  return undefined;
}

function localDate(value: string | null | undefined): string | null {
  if(!value||!Number.isFinite(Date.parse(value)))return null;
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Sydney",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
}

export function mapClubAvailability(
  round: AvailabilityRound,
  players: AvailabilityIdentity[],
  feed: ClubAvailabilityMatch[],
): { statuses: Map<string, PlayerAvailabilityStatus>; unmatched: string[]; matchedMatches: number; days:1|2; dates:[string|null,string|null] } {
  const byClubId = new Map<string, string>();
  for (const player of players) {
    const history = previousSeasonFor(player.registry_key);
    if (history?.clubPlayerId) byClubId.set(history.clubPlayerId, player.id);
  }
  const byName = uniqueNameMap(players);
  const statuses = new Map<string, PlayerAvailabilityStatus>();
  const unmatched = new Set<string>();
  let matchedMatches = 0;
  const sessions: {session:ClubAvailabilityMatch;day:DayNumber}[]=[];
  const dateSets=[new Set<string>(),new Set<string>()];
  let twoDay=round.matches.some(m=>round.lock_at&&m.final_day_date&&m.final_day_date>(localDate(round.lock_at)??m.final_day_date));

  for (const fantasyMatch of round.matches) {
    const candidates = feed.filter((item) =>
      nameMatchKey(item.round) === nameMatchKey(round.name) &&
      nameMatchKey(item.team) === nameMatchKey(fantasyMatch.grade));
    const exact = candidates.filter((item) =>
      nameMatchKey(item.opponent) === nameMatchKey(fantasyMatch.opponent));
    const matching=(exact.length?exact:candidates.length===1?candidates:[]).filter(item=>{
      const date=localDate(item.date),start=localDate(round.lock_at);
      return (!date||!start||date>=start)&&(!date||!fantasyMatch.final_day_date||date<=fantasyMatch.final_day_date);
    });
    const distinctDates=[...new Set(matching.map(x=>localDate(x.date)).filter((x):x is string=>!!x))].sort();
    if(distinctDates.length>2)continue;
    if(distinctDates.length===2||matching.some(m=>m.dayNumber===2))twoDay=true;
    const groups=new Map<DayNumber,ClubAvailabilityMatch[]>();
    for(const item of matching){
      const date=localDate(item.date);
      const chronologicalDay=date ? distinctDates.indexOf(date)+1 : 0;
      const day=item.dayNumber??(chronologicalDay||1) as DayNumber;
      // Explicit day 2 remains day 2 even when day 1 has not been published.
      if(item.dayNumber&&distinctDates.length===2&&item.dayNumber!==chronologicalDay)continue;
      groups.set(day,[...(groups.get(day)??[]),item]);
    }
    let matched=false;
    for(const [day,items] of groups){
      if(items.length!==1)continue; // Duplicate same-day sessions are still ambiguous.
      const session=items[0]!;
      sessions.push({session,day});
      const date=localDate(session.date);if(date)dateSets[day-1]!.add(date);
      matched=true;
    }
    if(matched)matchedMatches+=1;
  }
  const days:1|2=twoDay?2:1;
  const dates:[string|null,string|null]=dateSets.map(s=>s.size===1?[...s][0]!:null) as [string|null,string|null];
  if(days===2)for(const player of players)statuses.set(player.id,{days,dates});
  for(const {session:clubMatch,day} of sessions){
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
      const next = dotStatus(clubPlayer,day);
      if (!next) continue;
      // A player available/named in one match is available for the round even
      // if another squad's availability list still says unavailable.
      if(days===1&&!dates[0]){
        if(next==="available"||!statuses.has(fantasyId))statuses.set(fantasyId,next);
      }else{
        const current=statuses.get(fantasyId);
        const value:DatedAvailability=typeof current==="object"?{...current}:{days,dates};
        const key=day===1?"day1":"day2";
        if(next==="available"||!value[key])value[key]=next;
        statuses.set(fantasyId,value);
      }
    }
  }
  return { statuses, unmatched: [...unmatched].sort(), matchedMatches, days, dates };
}
