export type DayStatus = "available" | "unavailable";
export type DayNumber = 1 | 2;
export interface DatedAvailability {
  days: 1 | 2;
  day1?: DayStatus | undefined;
  day2?: DayStatus | undefined;
  dates: [string | null, string | null];
}
/** Strings retain compatibility with legacy one-day consumers and fixtures. */
export type PlayerAvailabilityStatus = DayStatus | DatedAvailability;
export interface ManualAvailability {
  legacy: Map<string, DayStatus>;
  days: Map<string, Map<DayNumber, DayStatus | "automatic">>;
}
export function availableOnAnyDay(value: PlayerAvailabilityStatus | undefined): boolean {
  return value === "available" || (typeof value === "object" &&
    (value.day1 === "available" || value.day2 === "available"));
}
export function asDated(value: PlayerAvailabilityStatus | undefined, days: 1 | 2 = 1,
  dates: DatedAvailability["dates"] = [null, null]): DatedAvailability {
  return typeof value === "object" ? value : {days, dates, day1:value, day2:days===2?value:undefined};
}
export function mergeAvailability(club: Map<string, PlayerAvailabilityStatus>, manual: ManualAvailability,
  days: 1 | 2, dates: DatedAvailability["dates"]): Map<string, PlayerAvailabilityStatus> {
  const result = new Map(club);
  for (const id of new Set([...manual.legacy.keys(), ...manual.days.keys()])) {
    const value = {...asDated(club.get(id), days, dates)};
    for (const day of [1, 2] as const) {
      const override = manual.days.get(id)?.get(day);
      const status = override === "automatic" ? asDated(club.get(id),days,dates)[day===1?"day1":"day2"]
        : override ?? manual.legacy.get(id) ?? value[day===1?"day1":"day2"];
      value[day===1?"day1":"day2"] = status;
    }
    result.set(id,value);
  }
  return result;
}
/** Availability follows the current unfinished round, NOT the next editable squad. */
export function availabilityRoundOf<T extends {seq:number; scorecards_frozen_at?:string|null}>(rounds: T[] | undefined): T | null {
  return [...(rounds??[])].filter(r=>!r.scorecards_frozen_at).sort((a,b)=>a.seq-b.seq)[0]??null;
}
export function shortAvailabilityDate(date: string | null): string {
  return date ? new Intl.DateTimeFormat("en-AU",{day:"numeric",month:"short",timeZone:"Australia/Sydney"}).format(new Date(date+"T12:00:00Z")) : "";
}
export function availabilityLabel(status: PlayerAvailabilityStatus): string {
  if(typeof status === "string")return status === "available" ? "Available this round" : "Unavailable this round";
  return ([1,2] as const).slice(0,status.days).map(day=>{
    const date=shortAvailabilityDate(status.dates[day-1]!);
    const value=status[day===1?"day1":"day2"];
    return `Day ${day}${date?` (${date})`:""}: ${value??"unknown / awaiting confirmation"}`;
  }).join("; ");
}
