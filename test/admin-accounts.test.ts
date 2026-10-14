import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({manager:true,valid:true,accounts:[{id:"00000000-0000-0000-0000-000000000002",displayName:"Test Manager",email:"participant@example.invalid",teamName:"Test XI"}],audit:undefined as undefined|{actor_id:string;target_id:string;status:string},actorCount:0,targetCount:0,queries:[] as {sql:string;params:unknown[]}[],auditFails:false,update:vi.fn()}));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>({auth:{getUser:async()=>({data:{user:state.valid?{id:"00000000-0000-0000-0000-000000000001"}:null},error:state.valid?null:{}}),admin:{updateUserById:state.update}}})}));
vi.mock("../src/db/pgClient.js",()=>({withPgClient:async(_connection:string,fn:(db:unknown)=>unknown)=>fn({query:async(sql:string,params:unknown[]=[])=>{
  state.queries.push({sql,params});
  if(sql.includes("SELECT is_league_manager"))return {rows:[{is_league_manager:state.manager}]};
  if(sql.includes('AS "displayName"'))return {rows:state.accounts};
  if(sql.includes("SELECT actor_id,target_id,status"))return {rows:state.audit?[state.audit]:[]};
  if(sql.includes("actor_count"))return {rows:[{actor_count:state.actorCount,target_count:state.targetCount}]};
  if(sql.startsWith("INSERT INTO public.admin_password_reset_audit")){if(state.auditFails)throw Error("SECRET SQL error");state.audit={actor_id:String(params[1]),target_id:String(params[2]),status:"pending"}}
  if(sql.startsWith("UPDATE public.admin_password_reset_audit"))state.audit!.status=String(params[1]);
  return {rows:[]};
}})}));
import handler from "../api/admin-accounts";
const password="Invented-test-password-908!";
const body=()=>({action:"reset",seasonId:"00000000-0000-0000-0000-000000000010",targetId:state.accounts[0]!.id,confirmEmail:state.accounts[0]!.email,requestId:"00000000-0000-0000-0000-000000000020",password});
async function call(requestBody:unknown=body(),method="POST",token:string|undefined="valid"){
  let code=0,payload:unknown;
  const headers:Record<string,string>={};
  const res={status(n:number){code=n;return this},json(data:unknown){payload=data},setHeader(n:string,v:string){headers[n]=v}};
  await handler({method,headers:token?{authorization:`Bearer ${token}`}:{},body:requestBody},res);
  return {code,payload,headers};
}
beforeEach(()=>{
  vi.stubEnv("SUPABASE_URL","https://example.invalid");vi.stubEnv("SUPABASE_ANON_KEY","public-test");vi.stubEnv("POSTGRES_URL","test");vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","PRIVATE_TEST_KEY");
  Object.assign(state,{manager:true,valid:true,audit:undefined,actorCount:0,targetCount:0,queries:[],auditFails:false});
  state.update.mockReset().mockResolvedValue({data:{user:{id:state.accounts[0]!.id}},error:null});
});
describe("manager password reset server boundary",()=>{
  it("rejects wrong methods and unauthenticated or expired sessions before opening the database",async()=>{
    expect((await call(body(),"GET")).code).toBe(405);
    expect((await call(body(),"POST","")).code).toBe(401);
    state.valid=false;expect((await call()).code).toBe(401);
    expect(state.queries).toEqual([]);expect(state.update).not.toHaveBeenCalled();
  });
  it("refuses non-managers without listing private account details",async()=>{
    state.manager=false;expect((await call({action:"list",seasonId:body().seasonId})).code).toBe(403);
    expect(state.queries.length).toBe(1);expect(state.update).not.toHaveBeenCalled();
  });
  it("lists only season participant accounts with no privileged key in the response",async()=>{
    const r=await call({action:"list",seasonId:body().seasonId});expect(r.code).toBe(200);
    expect(r.payload).toEqual({accounts:state.accounts,resetEnabled:true});
    expect(state.queries[1]!.sql).toContain("p.is_league_manager=false");
    expect(state.queries[1]!.params).toEqual([body().seasonId,"00000000-0000-0000-0000-000000000001"]);
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });
  it.each([
    {targetId:"00000000-0000-0000-0000-000000000001"},
    {confirmEmail:"wrong@example.invalid"},
    {password:"short"},
    {password:"界".repeat(25)},
    {requestId:"bad"},
  ])("rejects an unsafe target or payload before audit or Auth update: %j",async patch=>{
    expect((await call({...body(),...patch})).code).toBe(400);expect(state.update).not.toHaveBeenCalled();expect(state.audit).toBeUndefined();
  });
  it("fails closed if the privileged key or durable audit insert is unavailable",async()=>{
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","");expect((await call()).code).toBe(503);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","PRIVATE_TEST_KEY");state.auditFails=true;
    const r=await call();expect(r.code).toBe(500);expect(JSON.stringify(r.payload)).not.toContain("SECRET");expect(state.update).not.toHaveBeenCalled();
  });
  it.each([[5,0],[0,1]])("rate limits across persisted attempts",async(actorCount,targetCount)=>{
    state.actorCount=actorCount;state.targetCount=targetCount;expect((await call()).code).toBe(429);expect(state.update).not.toHaveBeenCalled();
  });
  it("writes a durable audit BEFORE Auth, only updates the password, and never persists it in SQL",async()=>{
    state.update.mockImplementation(async()=>{expect(state.audit?.status).toBe("pending");expect(state.queries.some(q=>q.sql==="COMMIT")).toBe(true);return {data:{user:{id:body().targetId}},error:null}});
    const r=await call();expect(r.code).toBe(200);expect(state.audit?.status).toBe("succeeded");
    expect(state.update).toHaveBeenCalledWith(body().targetId,{password});
    expect(JSON.stringify(state.queries)).not.toContain(password);expect(JSON.stringify(r.payload)).not.toContain(password);
    expect(state.queries.filter(q=>/INSERT|UPDATE/.test(q.sql)).every(q=>q.sql.includes("admin_password_reset_audit"))).toBe(true);
  });
  it("does not execute a completed request twice",async()=>{
    expect((await call()).code).toBe(200);expect((await call()).payload).toEqual({ok:true,alreadyCompleted:true});expect(state.update).toHaveBeenCalledTimes(1);
  });
  it.each(["pending","unknown","failed"])("refuses ambiguous duplicate request %s",async status=>{
    state.audit={actor_id:"00000000-0000-0000-0000-000000000001",target_id:body().targetId,status};expect((await call()).code).toBe(409);expect(state.update).not.toHaveBeenCalled();
  });
  it("does not leak provider errors and distinguishes rejection from uncertain completion",async()=>{
    state.update.mockResolvedValue({data:{user:null},error:{status:422,message:password}});
    const rejected=await call();expect(rejected.code).toBe(400);expect(state.audit?.status).toBe("failed");expect(JSON.stringify(rejected.payload)).not.toContain(password);
    state.audit=undefined;state.update.mockRejectedValue(Error(password));
    const uncertain=await call();expect(uncertain.code).toBe(502);expect((state.audit as {status:string}|undefined)?.status).toBe("unknown");expect(JSON.stringify(uncertain.payload)).not.toContain(password);
  });
});
