import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { asDated, availabilityLabel, type PlayerAvailabilityStatus } from "../lib/availabilityTypes";
export function PlayerAvailabilityDot({status}:{status:PlayerAvailabilityStatus|undefined}){
  const [position,setPosition]=useState<{left:number;top:number}|null>(null);
  const show=(element:HTMLElement)=>{
    const rect=element.getBoundingClientRect();
    setPosition({left:Math.max(8,Math.min(rect.left-100,window.innerWidth-224)),top:Math.max(8,Math.min(rect.bottom+8,window.innerHeight-100))});
  };
  useEffect(()=>{
    if(!position)return;
    const close=()=>setPosition(null);
    window.addEventListener('scroll',close,true);
    window.addEventListener('resize',close);
    return()=>{window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close)};
  },[position]);
  if(!status)return null;
  const value=asDated(status),label=availabilityLabel(status);
  const color=(s:string|undefined)=>s==="available"?"var(--availability-green)":s==="unavailable"?"var(--availability-red)":"#9299a6";
  const style:CSSProperties={background:value.days===2?`linear-gradient(112.5deg, ${color(value.day1)} 50%, ${color(value.day2)} 50%)`:color(value.day1)};
  return <span className="availability-dot" style={style} role="img" aria-label={label} title={label} tabIndex={0}
    onMouseEnter={e=>show(e.currentTarget)} onMouseLeave={()=>setPosition(null)} onFocus={e=>show(e.currentTarget)}
    onClick={e=>{e.stopPropagation();show(e.currentTarget)}} onBlur={()=>setPosition(null)} onKeyDown={e=>{if(e.key==="Escape")setPosition(null);if(e.key==="Enter"||e.key===" "){e.preventDefault();e.stopPropagation();show(e.currentTarget)}}}>
    {position&&createPortal(<span className="availability-tooltip" style={position} aria-hidden="true">{label}</span>,document.body)}
  </span>;
}
