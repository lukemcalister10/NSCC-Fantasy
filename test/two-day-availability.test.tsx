import { describe,it,expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerAvailabilityDot } from '../app/components/PlayerAvailabilityDot';
import { mapClubAvailability,type ClubAvailabilityMatch } from '../app/lib/clubAvailabilityMapping';
import { availabilityRoundOf,mergeAvailability,availabilityLabel,type DatedAvailability } from '../app/lib/availabilityTypes';
import { filterTradeInPool } from '../app/lib/tradePoolFilter';
const players=[{id:'p',registry_key:'Player',display_name:'Player'}];
const round={name:'Round 6',lock_at:'2026-10-31T00:00:00Z',matches:[{grade:'1st XI',opponent:'Opponent',final_day_date:'2026-11-07'}]};
const session=(day:1|2,status: 'available'|'unavailable'|'maybe'|'selected'|'silent'|'not-asked'='available',role:string|null=null):ClubAvailabilityMatch=>({team:'1st XI',opponent:'Opponent',round:'Round 6',sessionId:`d${day}`,date:day===1?'2026-10-31T00:00:00Z':'2026-11-07T00:00:00Z',dayNumber:day,players:[{playerId:'club',name:'Player',status,role}]});
describe('two-day availability',()=>{
 it.each([['available','available'],['available','unavailable'],['unavailable','available'],['unavailable','unavailable']] as const)('preserves %s / %s independently',(a,b)=>{
  const result=mapClubAvailability(round,players,[session(1,a),session(2,b)]);
  expect(result.matchedMatches).toBe(1);expect(result.dates).toEqual(['2026-10-31','2026-11-07']);
  expect(result.statuses.get('p')).toEqual({days:2,dates:result.dates,day1:a,day2:b});
 });
 it.each(['maybe','silent','not-asked'] as const)('keeps %s unknown instead of red',s=>{
  const value=mapClubAvailability(round,players,[session(1,'available'),session(2,s)]).statuses.get('p') as DatedAvailability;
  expect(value.day1).toBe('available');expect(value.day2).toBeUndefined();expect(availabilityLabel(value)).toContain('unknown');
 });
 it('day 2 alone cannot be reassigned to day 1',()=>{
  const value=mapClubAvailability(round,players,[session(2)]).statuses.get('p') as DatedAvailability;
  expect(value.day1).toBeUndefined();expect(value.day2).toBe('available');
 });
 it('duplicate day 2 leaves day 1 intact but day 2 unknown',()=>{
  const result=mapClubAvailability(round,players,[session(1),session(2),session(2)]);
  expect(result.days).toBe(2);expect((result.statuses.get('p') as DatedAvailability).day2).toBeUndefined();
 });
 it('keeps a missing second session unknown when the fixture spans two weeks',()=>{
  const result=mapClubAvailability(round,players,[session(1)]);
  expect(result.days).toBe(2);expect((result.statuses.get('p') as DatedAvailability).day2).toBeUndefined();
 });
 it('infers days from dates if day numbers are missing',()=>{
  const a=session(1),b=session(2);delete a.dayNumber;delete b.dayNumber;
  expect((mapClubAvailability(round,players,[b,a]).statuses.get('p') as DatedAvailability).day2).toBe('available');
 });
 it('rejects sessions outside the actual round date window',()=>{
  const wrong={...session(2),date:'2026-11-14T00:00:00Z'};
  expect((mapClubAvailability(round,players,[session(1),wrong]).statuses.get('p') as DatedAvailability).day2).toBeUndefined();
 });
 it('explicit unavailability is not overwritten by stale selection role',()=>{
  expect((mapClubAvailability(round,players,[session(1,'unavailable','core'),session(2)]).statuses.get('p') as DatedAvailability).day1).toBe('unavailable');
 });
 it('day-one selection does not falsely mark day 2 green',()=>{
  expect((mapClubAvailability(round,players,[session(1,'selected','day-one'),session(2,'selected','day-one')]).statuses.get('p') as DatedAvailability).day2).toBeUndefined();
 });
 it('retains the unfinished round after lock, and advances only when frozen',()=>{
  const r=[{seq:1,scorecards_frozen_at:'done'},{seq:6,scorecards_frozen_at:null},{seq:7,scorecards_frozen_at:null}];
  expect(availabilityRoundOf(r)?.seq).toBe(6);r[1]!.scorecards_frozen_at='done';expect(availabilityRoundOf(r)?.seq).toBe(7);
 });
 it('preserves legacy override, supports independent reset, and does not mutate input',()=>{
  const dates:[string,string]=['2026-10-31','2026-11-07'];
  const club=new Map([['p',{days:2 as const,dates,day1:'available' as const,day2:'unavailable' as const}]]);
  const manual={legacy:new Map([['p','unavailable' as const]]),days:new Map([['p',new Map([[1 as const,'automatic' as const]])]])};
  expect(mergeAvailability(club,manual,2,dates).get('p')).toEqual({days:2,dates,day1:'available',day2:'unavailable'});
  expect(club.get('p')!.day1).toBe('available');
 });
 it('either-day trade filter includes partial availability but not unknown',()=>{
  const dates:[null,null]=[null,null];const pool=[{id:'a'},{id:'b'},{id:'u'},{id:'n'}];
  const values=new Map([['a',{days:2 as const,dates,day1:'available' as const}],['b',{days:2 as const,dates,day2:'available' as const}],['u',{days:2 as const,dates}],['n',{days:2 as const,dates,day1:'unavailable' as const,day2:'unavailable' as const}]]);
  expect(filterTradeInPool(pool,new Set(),values,true).map(x=>x.id)).toEqual(['a','b']);
 });
 it('renders the requested 6:45–12:45 split, dates, grey unknown and keyboard/tap labels',()=>{
  const html=renderToStaticMarkup(<PlayerAvailabilityDot status={{days:2,dates:['2026-10-31','2026-11-07'],day1:'available'}}/>);
  expect(html).toContain('112.5deg');expect(html).toContain('var(--availability-green) 50%, #9299a6 50%');expect(html).toContain('Day 1 (31 Oct)');expect(html).toContain('Day 2 (7 Nov)');expect(html).toContain('tabindex="0"');
 });
 it('single-day dot stays solid and absent values stay absent',()=>{
  expect(renderToStaticMarkup(<PlayerAvailabilityDot status="available"/>)).not.toContain('gradient');
  expect(renderToStaticMarkup(<PlayerAvailabilityDot status={undefined}/>)).toBe('');
 });
});
