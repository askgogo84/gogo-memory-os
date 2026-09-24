import assert from 'node:assert/strict'
import { executeApprovedGmailSend } from '../lib/agent/gmail-send'
import { buildApprovalBinding } from '../lib/agent/approval-binding'
import { supabaseAdmin } from '../lib/supabase-admin'
async function main(){
 const oldFrom=supabaseAdmin.from,oldFetch=globalThis.fetch
 const actor={legacyTelegramId:123} as any,runId='00000000-0000-4000-8000-000000000001'
 const draft={threadId:'expected-thread',to:'fixture@example.invalid',subject:'Fixture',body:'Fixture only'}
 let status='queued',approved=true,bindingChanged=false,providerMode='verified',sends=0
 const activity:any[]=[]
 const reset=()=>{status='queued';approved=true;bindingChanged=false;providerMode='verified';sends=0;activity.length=0}
 ;(supabaseAdmin as any).from=(table:string)=>{
  let update:any=null,insert:any=null;const filters:any[]=[]
  const result=()=>{
   if(table==='agent_runs'){
    if(update){
     assert.ok(filters.some(f=>f[0]==='eq'&&f[1]==='telegram_id'&&f[2]==='123'))
     const eligible=filters.find(f=>f[0]==='in'&&f[1]==='status')
     if(eligible&&!eligible[2].includes(status))return {data:null,error:null}
     status=update.status||status;return {data:{id:runId},error:null}
    }
    return {data:{id:runId,status,metadata_json:{draft:{...draft,body:bindingChanged?'tampered':draft.body}}},error:null}
   }
   if(table==='agent_approvals')return {data:{id:'approval',status:approved?'approved':'pending',...buildApprovalBinding({missionId:runId,stepId:'send',capability:'email',actionType:'send_email',target:'gmail_thread:'+draft.threadId,payload:draft})},error:null}
   if(table==='users')return {data:{gmail_connected:true,gmail_send_connected:true,gmail_access_token:'fixture-token'},error:null}
   if(insert)activity.push(insert)
   return {data:[],error:null}
  }
  const chain:any={then:(resolve:any,reject:any)=>Promise.resolve().then(result).then(resolve,reject),maybeSingle:async()=>result()}
  for(const method of ['eq','in','select','order','limit','like'])chain[method]=(...args:any[])=>{filters.push([method,...args]);return chain}
  chain.update=(row:any)=>{update=row;return chain};chain.insert=(row:any)=>{insert=row;return chain};chain.delete=()=>chain
  return chain
 }
 globalThis.fetch=(async(url:any,options:any)=>{
  assert.match(String(url),/^https:\/\/gmail.googleapis.com\//)
  if(options?.method==='POST'){
   sends++;assert.equal(JSON.parse(options.body).threadId,draft.threadId)
   if(providerMode==='timeout')throw new Error('fixture transport failure after submission')
   return new Response(JSON.stringify({id:'sent-message',threadId:'provider-returned-thread'}),{status:200})
  }
  assert.match(String(url),/messages\/sent-message\?/)
  return new Response(JSON.stringify({threadId:providerMode==='wrong-thread'?'wrong-thread':draft.threadId,labelIds:providerMode==='missing-sent'?[]:['SENT']}),{status:200})
 }) as typeof fetch
 try{
  approved=false;await assert.rejects(executeApprovedGmailSend({actor,runId}),/gmail_send_approval_missing/);assert.equal(sends,0)
  reset();bindingChanged=true;await assert.rejects(executeApprovedGmailSend({actor,runId}),/approval_action_changed/);assert.equal(sends,0)
  reset();status='outcome_unknown';await assert.rejects(executeApprovedGmailSend({actor,runId}),/agent_run_already_claimed/);assert.equal(sends,0)
  reset();const results=await Promise.allSettled([executeApprovedGmailSend({actor,runId}),executeApprovedGmailSend({actor,runId})])
  assert.equal(sends,1,'concurrent approved execution must produce one provider POST')
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(status,'completed')
  assert.equal(activity.find(r=>r.event_type==='gmail_send_submitted').metadata_json.thread_id,draft.threadId)
  assert.equal(activity.find(r=>r.event_type==='gmail_send_verified').metadata_json.thread_id,draft.threadId)
  for(const mode of ['wrong-thread','missing-sent','timeout']){
   reset();providerMode=mode;const result=await executeApprovedGmailSend({actor,runId})
   assert.equal(result.status,'paused');assert.equal(status,'outcome_unknown');assert.equal(sends,1)
   await assert.rejects(executeApprovedGmailSend({actor,runId}),/agent_run_already_claimed/);assert.equal(sends,1)
   assert.ok(!activity.some(r=>r.metadata_json?.outcome==='verified_success'))
  }
 }finally{supabaseAdmin.from=oldFrom;globalThis.fetch=oldFetch}
 console.log('Gmail execution: approval/hash gates, concurrent single-send claim, exact readback, unknown-state no-retry passed')
}
main().catch(error=>{console.error(error);process.exitCode=1})
