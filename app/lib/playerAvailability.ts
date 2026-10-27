import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { mapClubAvailability, type AvailabilityIdentity, type AvailabilityRound, type ClubAvailabilityMatch } from "./clubAvailabilityMapping";
import { mergeAvailability, type ManualAvailability, type DayStatus, type DayNumber } from "./availabilityTypes";
export type { PlayerAvailabilityStatus, DayStatus, DayNumber } from "./availabilityTypes";
export function useManualPlayerAvailability(roundId:string|undefined){
  return useQuery({queryKey:["player-availability","manual",roundId],enabled:!!roundId,staleTime:30_000,refetchInterval:30_000,
    queryFn:async():Promise<ManualAvailability>=>{
      const [legacy,days]=await Promise.all([
        supabase.from("player_availability").select("player_id,status").eq("round_id",roundId!),
        supabase.from("player_availability_days").select("player_id,day_number,status").eq("round_id",roundId!),
      ]);
      if(legacy.error||days.error)throw Error((legacy.error??days.error)!.message);
      const overrides:ManualAvailability["days"]=new Map();
      for(const row of days.data??[]){
        if(!overrides.has(row.player_id))overrides.set(row.player_id,new Map());
        overrides.get(row.player_id)!.set(row.day_number as DayNumber,row.status as DayStatus|"automatic");
      }
      return {legacy:new Map((legacy.data??[]).map(r=>[r.player_id,r.status as DayStatus])),days:overrides};
    }});
}
export function useClubPlayerAvailability(roundId:string|undefined){
  const metadata=useQuery({queryKey:["player-availability","round",roundId],enabled:!!roundId,staleTime:60_000,
    queryFn:async()=>{
      const row=await supabase.from("rounds").select("season_id,name,lock_at,matches(grade,opponent,final_day_date)").eq("id",roundId!).single();
      if(row.error)throw Error(row.error.message);
      return row.data;
    }});
  const query=useQuery({queryKey:["player-availability","club",roundId],enabled:!!metadata.data,staleTime:5*60_000,refetchInterval:5*60_000,retry:1,
    queryFn:async()=>{
      const {data:session}=await supabase.auth.getSession();
      const token=session.session?.access_token;
      if(!token)throw Error("Sign in to view club availability");
      const round=metadata.data!;
      const [players,feedResponse]=await Promise.all([
        supabase.from("players").select("id,registry_key,display_name").eq("season_id",round.season_id).eq("active",true),
        fetch("/api/club-availability",{headers:{Authorization:`Bearer ${token}`}}),
      ]);
      if(players.error)throw Error(players.error.message);
      if(!feedResponse.ok)throw Error(feedResponse.status===503?"Club availability key is not configured on this deployment":"Club availability could not be refreshed");
      const feed=await feedResponse.json() as {matches?:ClubAvailabilityMatch[]};
      if(!Array.isArray(feed.matches))throw Error("Invalid club availability response");
      return mapClubAvailability(round as AvailabilityRound,(players.data??[]) as AvailabilityIdentity[],feed.matches);
    }});
  const dayCount:1|2=query.data?.days??(metadata.data?.matches.some(m=>m.final_day_date&&m.final_day_date>metadata.data!.lock_at.slice(0,10))?2:1);
  return {...query,error:query.error??metadata.error,dayCount};
}
export function usePlayerAvailability(roundId:string|undefined){
  const manual=useManualPlayerAvailability(roundId),club=useClubPlayerAvailability(roundId);
  const data=useMemo(()=>mergeAvailability(club.data?.statuses??new Map(),manual.data??{legacy:new Map(),days:new Map()},club.dayCount,club.data?.dates??[null,null]),[club.data,club.dayCount,manual.data]);
  return {data,error:manual.error,isLoading:manual.isLoading,clubError:club.error};
}
export async function setPlayerAvailability(roundId:string,playerId:string,status:DayStatus|null,day:DayNumber=1):Promise<void>{
  // Automatic masks a legacy round-wide override for only this day.
  const res=await supabase.from("player_availability_days").upsert({round_id:roundId,player_id:playerId,day_number:day,status:status??"automatic"},{onConflict:"round_id,player_id,day_number"});
  if(res.error)throw Error(res.error.message);
}
