import { createClient } from "@supabase/supabase-js";
import { withPgClient } from "../src/db/pgClient.js";

interface Req { method?: string; headers: Record<string,string|string[]|undefined>; body?: unknown }
interface Res { status(code:number):Res; json(body:unknown):void; setHeader?(name:string,value:string):void }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class Refusal extends Error { constructor(public code:number,message:string){super(message)} }

/** The browser sends its own bearer token, not privileged credentials.
 * Auth identity and manager status are verified server-side on EVERY request.
 * Reserve an audited/rate-limited attempt before calling Auth; retries cannot
 * repeat the password write. Never return/log provider exceptions or bodies.
 */
export default async function handler(req:Req,res:Res):Promise<void> {
  res.setHeader?.("Cache-Control","no-store");
  if(req.method!=="POST")return void res.status(405).json({error:"POST only"});
  const raw=req.headers.authorization??req.headers.Authorization;
  const header=Array.isArray(raw)?raw[0]:raw;
  const token=header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if(!token)return void res.status(401).json({error:"Sign in required."});
  const url=process.env.SUPABASE_URL??process.env.VITE_SUPABASE_URL;
  const anon=process.env.SUPABASE_ANON_KEY??process.env.VITE_SUPABASE_ANON_KEY;
  const connection=process.env.POSTGRES_URL;
  if(!url||!anon||!connection)return void res.status(503).json({error:"Account administration is not configured."});
  let body:Record<string,unknown>;
  try { body=typeof req.body==="string"?JSON.parse(req.body):req.body; }
  catch { return void res.status(400).json({error:"Invalid request."}); }
  if(!body||typeof body!=="object"||Array.isArray(body)||
    typeof body.seasonId!=="string"||!uuid.test(body.seasonId)||!["list","reset"].includes(String(body.action)))
    return void res.status(400).json({error:"A valid season and action are required."});
  try {
    const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await auth.auth.getUser(token);
    const actor=data.user?.id;
    if(error||!actor)throw new Refusal(401,"Session expired. Sign in again.");
    const result=await withPgClient(connection,async db=>{
      const manager=await db.query<{is_league_manager:boolean}>("SELECT is_league_manager FROM public.profiles WHERE id=$1",[actor]);
      if(manager.rows[0]?.is_league_manager!==true)throw new Refusal(403,"League manager only.");
      const accounts=await db.query<{id:string;displayName:string;email:string;teamName:string}>(
        `SELECT p.id,p.display_name AS "displayName",u.email,ft.name AS "teamName"
         FROM public.profiles p JOIN auth.users u ON u.id=p.id
         JOIN public.fantasy_teams ft ON ft.owner_profile_id=p.id
         WHERE ft.season_id=$1 AND p.is_league_manager=false AND p.id<>$2 AND u.email IS NOT NULL
         ORDER BY p.display_name,p.id`,[body.seasonId,actor]);
      if(body.action==="list")return {accounts:accounts.rows,resetEnabled:!!process.env.SUPABASE_SERVICE_ROLE_KEY};
      const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
      if(!key)throw new Refusal(503,"Password resets are not configured on this deployment.");
      if(typeof body.targetId!=="string"||!uuid.test(body.targetId)||typeof body.requestId!=="string"||!uuid.test(body.requestId))
        throw new Refusal(400,"Select an account and submit a valid reset request.");
      const target=accounts.rows.find(account=>account.id===body.targetId);
      if(!target||body.confirmEmail!==target.email)throw new Refusal(400,"Account confirmation does not match. Select the account again.");
      if(typeof body.password!=="string"||body.password.length<12||Buffer.byteLength(body.password,"utf8")>72)
        throw new Refusal(400,"Use at least 12 characters and no more than 72 UTF-8 bytes.");
      // Serialise only the reservation, not the external Auth operation. This
      // works with transaction-pooled Postgres and across serverless instances.
      await db.query("BEGIN");
      let prior:{actor_id:string;target_id:string;status:string}|undefined;
      try {
        await db.query("SELECT pg_advisory_xact_lock(20261014,21)");
        prior=(await db.query<{actor_id:string;target_id:string;status:string}>(
          "SELECT actor_id,target_id,status FROM public.admin_password_reset_audit WHERE request_id=$1",[body.requestId])).rows[0];
        if(!prior){
          const limit=(await db.query<{actor_count:number;target_count:number}>(
            `SELECT count(*) FILTER (WHERE actor_id=$1 AND created_at>now()-interval '10 minutes')::int actor_count,
             count(*) FILTER (WHERE target_id=$2 AND created_at>now()-interval '1 minute')::int target_count
             FROM public.admin_password_reset_audit`,[actor,target.id])).rows[0]!;
          if(limit.actor_count>=5||limit.target_count>=1)throw new Refusal(429,"Too many reset attempts. Wait before trying again.");
          await db.query("INSERT INTO public.admin_password_reset_audit(request_id,actor_id,target_id,season_id,status) VALUES($1,$2,$3,$4,'pending')",[body.requestId,actor,target.id,body.seasonId]);
        }
        await db.query("COMMIT");
      } catch(e){await db.query("ROLLBACK");throw e}
      if(prior){
        if(prior.actor_id!==actor||prior.target_id!==target.id)throw new Refusal(409,"Reset request identity does not match.");
        if(prior.status==="succeeded")return {ok:true,alreadyCompleted:true};
        throw new Refusal(409,"This reset was already submitted. Check the outcome before submitting another.");
      }
      let status:"succeeded"|"failed"|"unknown"="unknown";
      try {
        const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10_000)})}});
        const updated=await admin.auth.admin.updateUserById(target.id,{password:body.password});
        status=updated.error?((updated.error.status??500)<500?"failed":"unknown"):
          updated.data.user?.id===target.id?"succeeded":"unknown";
      } catch { status="unknown"; }
      await db.query("UPDATE public.admin_password_reset_audit SET status=$2,completed_at=now() WHERE request_id=$1",[body.requestId,status]);
      if(status==="failed")throw new Refusal(400,"Password update was rejected. Check the password policy and server configuration.");
      if(status!=="succeeded")throw new Refusal(502,"The reset outcome could not be confirmed. Ask the user to try the new password before retrying.");
      return {ok:true};
    });
    res.status(200).json(result);
  } catch(e){
    if(e instanceof Refusal)return void res.status(e.code).json({error:e.message});
    // A connection/audit failure after an Auth call may leave an uncertain
    // result; never suggest that retrying the credential write is harmless.
    res.status(500).json({error:"Account administration could not confirm completion. If you submitted a reset, check whether the new password works before retrying."});
  }
}
