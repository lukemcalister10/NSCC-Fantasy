import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAdminSeason } from "../../lib/adminQueries";
import { AdminPage, Field, Section } from "./adminChrome";
import { Loading, ErrorState } from "../../components/states";

interface Account { id:string; displayName:string; email:string; teamName:string }
async function accountRequest(body:Record<string,unknown>){
  const {data}=await supabase.auth.getSession();
  const token=data.session?.access_token;
  if(!token)throw new Error("Sign in again before managing accounts.");
  let response:Response;
  try { response=await fetch("/api/admin-accounts",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(body)}); }
  catch {throw new Error("Could not confirm completion. If you submitted a reset, check the new password before retrying.")}
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result)throw new Error(result?.error??"Could not confirm completion. Check the new password before retrying.");
  return result;
}

export function AdminAccounts(){
  const season=useAdminSeason();
  const accounts=useQuery<{accounts:Account[];resetEnabled:boolean}>({queryKey:["admin-accounts",season.data?.id],enabled:!!season.data?.id,queryFn:()=>accountRequest({action:"list",seasonId:season.data!.id}),staleTime:0});
  const [targetId,setTargetId]=useState("");
  const [password,setPassword]=useState("");
  const [confirmation,setConfirmation]=useState("");
  const [confirmed,setConfirmed]=useState(false);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const target=accounts.data?.accounts.find(a=>a.id===targetId);
  function clearForm(){setPassword("");setConfirmation("");setConfirmed(false);setError("");setSuccess("")}
  async function reset(event:FormEvent){
    event.preventDefault();
    if(pending||!target||!confirmed||!season.data)return;
    if(password.length<12||new TextEncoder().encode(password).length>72){setError("Use at least 12 characters and no more than 72 UTF-8 bytes.");return}
    if(password!==confirmation){setError("The passwords do not match.");return}
    const newPassword=password;
    const selected=target;
    setPending(true);setError("");setSuccess("");setPassword("");setConfirmation("");setConfirmed(false);
    try {
      // Do not put passwords in React Query mutation/cache state or URLs.
      await accountRequest({action:"reset",seasonId:season.data.id,targetId:selected.id,confirmEmail:selected.email,password:newPassword,requestId:crypto.randomUUID()});
      setSuccess(`Password reset for ${selected.displayName} (${selected.email}). Share the new password privately. Their team and scores are unchanged.`);
    }catch(e){setError(e instanceof Error?e.message:"Could not confirm the reset outcome.")}
    finally{setPending(false)}
  }
  return <AdminPage title="Account passwords" intro="Reset a participant's password without changing their account, team or scores.">
    <Link className="btn-ghost" to="/admin">Back to manager</Link>
    <Section title="Reset password">
      {season.isLoading||accounts.isLoading?<Loading/>:season.error||accounts.error?<ErrorState error={season.error??accounts.error}/>:
      <form className="card admin-password-form" onSubmit={reset}>
        <p className="admin-note">Verify the request came from the account owner. Manager accounts cannot be reset here. No reset email is sent.</p>
        {!accounts.data?.resetEnabled?<p role="alert" className="admin-status admin-status-error">Password resets are not configured on this deployment.</p>:null}
        <Field label="Account"><select value={targetId} disabled={pending} onChange={e=>{setTargetId(e.target.value);clearForm()}}>
          <option value="">Choose a participant…</option>
          {accounts.data?.accounts.map(a=><option key={a.id} value={a.id}>{a.displayName} — {a.teamName}</option>)}
        </select></Field>
        {target?<>
          <div className="admin-banner"><strong>{target.displayName} — {target.teamName}</strong><span>{target.email}</span></div>
          <Field label="New password" hint="12+ characters; keep it unique"><input type="password" autoComplete="new-password" value={password} required minLength={12} disabled={pending||!accounts.data?.resetEnabled} onChange={e=>setPassword(e.target.value)}/></Field>
          <Field label="Confirm new password"><input type="password" autoComplete="new-password" value={confirmation} required minLength={12} disabled={pending||!accounts.data?.resetEnabled} onChange={e=>setConfirmation(e.target.value)}/></Field>
          <label className="admin-password-confirm"><input type="checkbox" checked={confirmed} disabled={pending} onChange={e=>setConfirmed(e.target.checked)}/> I verified the owner and want to reset the password for {target.email}.</label>
          <div className="admin-actions"><button className="btn-primary" type="submit" disabled={pending||!confirmed||!password||!confirmation||!accounts.data?.resetEnabled}>{pending?"Resetting…":"Reset password"}</button><button className="btn-ghost" type="button" disabled={pending} onClick={clearForm}>Clear</button></div>
        </>:null}
        {error?<p role="alert" className="admin-status admin-status-error">{error}</p>:null}
        {success?<p role="status" className="admin-status admin-status-ok">{success}</p>:null}
      </form>}
    </Section>
  </AdminPage>;
}
