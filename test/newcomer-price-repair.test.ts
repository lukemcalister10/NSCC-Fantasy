import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { makeTestDb, seedSeason } from './helpers/pgliteDb.js';
import { FIXTURE_CONFIG } from '../src/config/fixture.js';
import { repriceAfterMatch } from '../src/engines/pricing.js';
import type { RawSeason } from '../src/recompute/types.js';

it('repairs only the audited newcomer seeds/history and preserves the freeze guard', async () => {
  const db = await makeTestDb();
  const seasonId='edd67f68-d2a1-45f5-98ff-e8c718d1562b';
  const roundId='00000000-0000-4000-8000-000000000002';
  const rows=[
    ['8726ac32-9848-4511-a9f9-52a181e50172','Lachlan Brown','BWL',28800,4,'e86ce9d5-941b-4fc1-a8e2-7aebc447a73e'],
    ['27c9c79d-dd12-48bd-ad5c-bd5c279a4c7c','Sharon Ben','WK',21900,5,'8784b3d0-c286-41dc-a178-69b08016b6ec'],
  ] as const;
  const raw: RawSeason={seasonId,config:FIXTURE_CONFIG,
    players:rows.map(([id,displayName,role])=>({id,displayName,registryKey:displayName,role,wkEligible:true,startingPrice:9000,active:true})),
    rounds:[{id:roundId,seq:2,name:'Round 2',lockAt:'2026-09-26T01:00:00Z'}],
    matches:rows.map((r,i)=>({id:r[5],roundId,grade:`${i+2}nd XI`,opponent:'Test',status:'finalised',finalDayDate:'2026-09-26',finalisedAt:'2026-09-29T07:53:00Z'})),
    scorecards:[],fantasyTeams:[],selections:[],trades:[]};
  await seedSeason(db,raw);
  await db.query('UPDATE seasons SET newcomer_role_prices=$2 WHERE id=$1',[seasonId,JSON.stringify({BAT:29100,BWL:28800,AR:38600,WK:21900})]);
  await db.query('UPDATE seasons SET locked_at=now() WHERE id=$1',[seasonId]);
  for(const [id,, , ,score,matchId] of rows){
    await db.query('INSERT INTO player_match_scores(match_id,player_id,played,batting,bowling,fielding,bonuses,base) VALUES($1,$2,true,$3,0,0,0,$3)',[matchId,id,score]);
    await db.query('INSERT INTO price_history(player_id,seq,price,match_id) VALUES($1,0,9000,NULL),($1,1,9000,$2)',[id,matchId]);
  }
  await db.exec(readFileSync(new URL('../scripts/repair-newcomer-prices.sql',import.meta.url),'utf8'));
  for(const [id,, ,seed,score] of rows){
    expect((await db.query<{price:number}>('SELECT price FROM price_history WHERE player_id=$1 ORDER BY seq',[id])).rows.map(r=>r.price)).toEqual([seed,repriceAfterMatch(seed,score,FIXTURE_CONFIG.pricing)]);
    expect((await db.query<{wk_eligible:boolean}>('SELECT wk_eligible FROM players WHERE id=$1',[id])).rows[0]!.wk_eligible).toBe(true);
    await expect(db.query('UPDATE players SET starting_price=9000 WHERE id=$1',[id])).rejects.toThrow(/frozen/);
  }
  await expect(db.exec(readFileSync(new URL('../scripts/repair-newcomer-prices.sql',import.meta.url),'utf8'))).rejects.toThrow(/Player state changed/);
  await db.query('ROLLBACK');
},120000);
