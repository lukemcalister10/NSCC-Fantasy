import { useClubPlayerAvailability } from "../lib/playerAvailability";
import { shortAvailabilityDate } from "../lib/availabilityTypes";
export function AvailabilityLegend({roundId}:{roundId:string|undefined}){
  const club=useClubPlayerAvailability(roundId);
  if(club.error)return <p className="availability-legend" role="status">Club availability could not be refreshed. Grey means unknown, not unavailable.</p>;
  if(club.data?.days!==2)return null;
  return <p className="availability-legend">Dots: Day 1{club.data.dates[0]?` (${shortAvailabilityDate(club.data.dates[0])})`:""} upper-left · Day 2{club.data.dates[1]?` (${shortAvailabilityDate(club.data.dates[1])})`:""} lower-right. Grey = unknown.</p>;
}
