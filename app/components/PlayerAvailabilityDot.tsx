import { useState, type CSSProperties } from "react";
import { asDated, availabilityLabel, type PlayerAvailabilityStatus } from "../lib/availabilityTypes";
export function PlayerAvailabilityDot({status}:{status:PlayerAvailabilityStatus|undefined}){
  const [open,setOpen]=useState(false);
  if(!status)return null;
  const value=asDated(status),label=availabilityLabel(status);
  const color=(s:string|undefined)=>s==="available"?"var(--up)":s==="unavailable"?"var(--down)":"#9299a6";
  const style:CSSProperties={background:value.days===2?`linear-gradient(135deg, ${color(value.day1)} 50%, ${color(value.day2)} 50%)`:color(value.day1)};
  return <span className={`availability-dot${open?" availability-dot-open":""}`} style={style} role="img" aria-label={label} title={label} tabIndex={0}
    onClick={()=>setOpen(v=>!v)} onBlur={()=>setOpen(false)} onKeyDown={e=>{if(e.key==="Escape")setOpen(false);if(e.key==="Enter"||e.key===" "){e.preventDefault();setOpen(v=>!v)}}}>
    <span className="availability-tooltip" aria-hidden="true">{label}</span>
  </span>;
}
