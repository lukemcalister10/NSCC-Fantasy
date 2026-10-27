import {describe,it,expect} from 'vitest';
import {makeTestDb,asAuthed} from './helpers/pgliteDb';
describe('day availability database guards',()=>{
 it('allows only manager day overrides after lock, never after freeze; keeps legacy locks',async()=>{
  const db=await makeTestDb();
  const s='00000000-0000-0000-0000-000000002201',p='00000000-0000-0000-0000-000000002202',r='00000000-0000-0000-0000-000000002203',manager='00000000-0000-0000-0000-000000002204',user='00000000-0000-0000-0000-000000002205',other='00000000-0000-0000-0000-000000002206';
  await db.query("INSERT INTO seasons(id,name,config) VALUES($1,'Availability','{}'),($2,'Other','{}')",[s,other]);
  await db.query("INSERT INTO players(id,season_id,registry_key,display_name,role,wk_eligible,starting_price) VALUES($1,$2,'P','P','BAT',false,10000)",[p,s]);
  await db.query("INSERT INTO profiles(id,display_name,is_league_manager) VALUES($1,'Manager',true),($2,'User',false)",[manager,user]);
  await db.query("INSERT INTO rounds(id,season_id,seq,name,lock_at) VALUES($1,$2,1,'Locked',now()-interval '1 day')",[r,s]);
  const write=(day:number,status='available')=>db.query("INSERT INTO player_availability_days(round_id,player_id,day_number,status) VALUES($1,$2,$3,$4) ON CONFLICT(round_id,player_id,day_number) DO UPDATE SET status=excluded.status",[r,p,day,status]);
  await expect(asAuthed(db,{role:'authenticated',sub:user},()=>write(1))).rejects.toThrow(/row.level|policy/i);
  await asAuthed(db,{role:'authenticated',sub:manager},()=>write(1));
  await asAuthed(db,{role:'authenticated',sub:manager},()=>write(2,'unavailable'));
  await asAuthed(db,{role:'authenticated',sub:manager},()=>write(1,'automatic'));
  expect((await db.query('SELECT day_number,status FROM player_availability_days ORDER BY day_number')).rows).toEqual([{day_number:1,status:'automatic'},{day_number:2,status:'unavailable'}]);
  await expect(write(3)).rejects.toThrow(/check constraint/);
  await expect(asAuthed(db,{role:'anon'},()=>db.query('SELECT * FROM player_availability_days'))).rejects.toThrow(/permission denied/);
  await expect(db.query("INSERT INTO player_availability(round_id,player_id,status) VALUES($1,$2,'available')",[r,p])).rejects.toThrow(/locked/);
  await db.query('UPDATE rounds SET season_id=$2 WHERE id=$1',[r,other]);
  await expect(write(1)).rejects.toThrow(/same season/);
  await db.query('UPDATE rounds SET season_id=$2 WHERE id=$1',[r,s]);
  // This synthetic round has no club matches, so no unpublished card blocks freeze.
  await db.query('UPDATE rounds SET scorecards_frozen_at=now() WHERE id=$1',[r]);
  await expect(write(1)).rejects.toThrow(/frozen/);
  await expect(db.query('DELETE FROM player_availability_days WHERE round_id=$1',[r])).rejects.toThrow(/frozen/);
 },30000);
});
