import { beforeAll, describe, expect, it } from "vitest";
import { makeTestDb, asAuthed } from "./helpers/pgliteDb";
import { FIXTURE_CONFIG } from "../src/config/fixture";
import type { DbClient } from "../src/db/repository";
const manager="00000000-0000-0000-0000-000000000031",participant="00000000-0000-0000-0000-000000000032",season="00000000-0000-0000-0000-000000000033";
describe("password-reset audit permissions against real migrations",()=>{
  let db:DbClient;
  beforeAll(async()=>{
    db=await makeTestDb();
    await db.query("INSERT INTO seasons(id,name,config) VALUES($1,'Reset test',$2)",[season,JSON.stringify(FIXTURE_CONFIG)]);
    await db.query("INSERT INTO profiles(id,display_name,is_league_manager) VALUES($1,'Manager',true),($2,'Participant',false)",[manager,participant]);
    await db.query("INSERT INTO admin_password_reset_audit(request_id,actor_id,target_id,season_id,status) VALUES('00000000-0000-0000-0000-000000000034',$1,$2,$3,'pending')",[manager,participant,season]);
  },120000);
  it("allows only managers to read reset audit entries",async()=>{
    expect((await asAuthed(db,{role:"authenticated",sub:manager},()=>db.query("SELECT * FROM admin_password_reset_audit"))).rows).toHaveLength(1);
    expect((await asAuthed(db,{role:"authenticated",sub:participant},()=>db.query("SELECT * FROM admin_password_reset_audit"))).rows).toHaveLength(0);
    await expect(asAuthed(db,{role:"anon"},()=>db.query("SELECT * FROM admin_password_reset_audit"))).rejects.toThrow(/permission denied/);
  });
  it.each(["UPDATE admin_password_reset_audit SET status='succeeded'","DELETE FROM admin_password_reset_audit",`INSERT INTO admin_password_reset_audit(request_id,actor_id,target_id,season_id,status) VALUES('00000000-0000-0000-0000-000000000035','${manager}','${participant}','${season}','pending')`])("denies direct browser writes even to managers: %s",async sql=>{
    await expect(asAuthed(db,{role:"authenticated",sub:manager},()=>db.query(sql))).rejects.toThrow(/permission denied/);
  });
  it("has no credential or arbitrary-body storage columns",async()=>{
    const columns=await db.query<{column_name:string}>("SELECT column_name FROM information_schema.columns WHERE table_name='admin_password_reset_audit' ORDER BY ordinal_position");
    expect(columns.rows.map(x=>x.column_name)).toEqual(["request_id","actor_id","target_id","season_id","status","created_at","completed_at"]);
  });
});
