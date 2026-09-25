import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { supabaseAdmin } from '../lib/supabase-admin'
import { tryTypedTimeRouting, parseTypedTimeRequest, movedTime } from '../lib/agent/typed-time-routing'
import { executeApprovedCalendarUpdate } from '../lib/agent/calendar-update'
import { rememberTypedObjects, typedMutationOwner } from '../lib/agent/typed-object-context'
import { isSameBrainIntrospection } from '../lib/agent/brain-introspection'

const actor={legacyTelegramId:123,userId:'test-user',whatsappId:'fixture',name:'Fixture'}
const baseEvent={id:'calendar-exact',summary:'A event called Same Brain Learning Test',etag:'"v1"',start:{dateTime:'2026-10-01T16:00:00+05:30'},end:{dateTime:'2026-10-01T16:30:00+05:30'}}
let db:Record<string,any[]>,event:any,patches=0,unknown=false,mismatch=false,wrongTime=false,rejectPatch=0,reminderWriteUnknown=false,reminderWrites=0,permission:string|null=null,seq=0
const oldFrom=supabaseAdmin.from,oldFetch=globalThis.fetch
const copy=(v:any)=>JSON.parse(JSON.stringify(v))
function reset(){db={agent_activity:[],agent_runs:[],agent_approvals:[],reminders:[],conversations:[],agent_permissions:[],users:[{telegram_id:123,timezone:'Asia/Kolkata',google_calendar_connected:true,google_refresh_token:'fixture'}]};event=copy(baseEvent);patches=0;unknown=false;mismatch=false;wrongTime=false;rejectPatch=0;reminderWriteUnknown=false;reminderWrites=0;permission=null;seq=0}
function value(row:any,key:string){return key.split(/->>?/).reduce((v,k)=>v?.[k],row)}
;(supabaseAdmin as any).from=(table:string)=>{
 const filters:any[]=[],order:any[]=[];let mode='read',payload:any,lim=Infinity,single=false,selected=false
 const q:any={select:()=>{selected=true;return q},eq:(k:any,v:any)=>{filters.push((r:any)=>String(value(r,k))===String(v));return q},in:(k:any,vs:any[])=>{filters.push((r:any)=>vs.map(String).includes(String(value(r,k))));return q},order:(k:any,o:any)=>{order.push([k,o]);return q},limit:(n:number)=>{lim=n;return q},maybeSingle:()=>{single=true;return q},single:()=>{single=true;return q},insert:(p:any)=>{mode='insert';payload=p;return q},update:(p:any)=>{mode='update';payload=p;return q},then:(resolve:any,reject:any)=>{
  try{
   if(table==='agent_permissions')return Promise.resolve({data:permission?{level:permission}:null,error:null}).then(resolve,reject)
   assert.ok(db[table],table)
   let rows=db[table].filter(r=>filters.every(f=>f(r)))
   if(mode==='insert'){rows=(Array.isArray(payload)?payload:[payload]).map(p=>({...copy(p),id:p.id||`00000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`,created_at:new Date(Date.now()+seq).toISOString(),requested_at:new Date(Date.now()+seq).toISOString()}));db[table].push(...rows)}
   else if(mode==='update')for(const r of rows)Object.assign(r,copy(payload))
   if(mode==='update'&&table==='reminders'){reminderWrites++;if(reminderWriteUnknown)throw new Error('reminder_write_response_lost')}
   for(const [k,o] of order)rows.sort((a,b)=>String(value(a,k)||'').localeCompare(String(value(b,k)||''))*(o?.ascending===false?-1:1))
   rows=rows.slice(0,lim)
   return Promise.resolve({data:mode==='update'&&!selected?null:copy(single?(rows[0]||null):rows),error:null}).then(resolve,reject)
  }catch(e){return Promise.reject(e).then(resolve,reject)}
 }}
 return q
}
globalThis.fetch=(async(url:any,opts:any={})=>{
 const u=String(url)
 if(u==='https://oauth2.googleapis.com/token')return new Response(JSON.stringify({access_token:'fixture-access'}))
 assert.match(u,/googleapis.com\/calendar\/v3\/calendars\/primary\/events/)
 if(opts.method==='PATCH'){
  patches++;assert.equal(u.split('/').at(-1),'calendar-exact');assert.equal(opts.headers['If-Match'],'"v1"')
  if(rejectPatch)return new Response(JSON.stringify({error:{message:'Rejected'}}),{status:rejectPatch})
  const body=JSON.parse(opts.body);event={...event,...body,etag:'"v2"'}
  if(unknown)throw new Error('fixture_timeout_after_mutation')
  return new Response(JSON.stringify(event))
 }
 assert.ok(!opts.method||opts.method==='GET')
 if(u.includes('?'))return new Response(JSON.stringify({items:[event]}))
 return new Response(JSON.stringify(mismatch&&patches?{...event,id:'wrong-event'}:wrongTime&&patches?{...event,start:{dateTime:baseEvent.start.dateTime}}:event))
}) as typeof fetch
const run=(text:string,surface='whatsapp')=>tryTypedTimeRouting({actor,text,surface,messageId:'fixture-turn'})
async function stage(text:string){const r=await run(text);assert.equal(r?.status,'waiting_approval',r?.text);assert.equal(patches,0);return r!}
async function main(){try{
 // A/C/J: exact named identity, syntax variants and identical web/WhatsApp behavior.
 for(const surface of ['web','whatsapp','agent'])for(const text of ['Move Same Brain Learning Test to 4:30 PM','Reschedule Same Brain Learning Test to 5 PM','Change Same Brain Learning Test to 3 PM']){
  reset();const r=await run(text,surface);assert.equal(r?.status,'waiting_approval',text);assert.equal(db.agent_runs[0].metadata_json.draft.eventId,event.id);assert.equal(patches,0)
 }
 // B: a selected event preserves its exact ID for pronouns and bare clocks.
 for(const text of ['Move that meeting to 4:30','Push that event to 5','Make that 4:30 instead']){
  reset();await rememberTypedObjects(123,'calendar',[{id:event.id,title:event.summary}]);await stage(text)
 }
 // G/H: approval is required, exact bound time is verified and only then success is learned.
 reset();const pending=await stage('Move Same Brain Learning Test to 4:30 PM')
 for(const text of ['yes','confirm','no','cancel']){assert.equal(await run(text),null);assert.equal(db.agent_approvals[0].status,'pending');assert.equal(patches,0)}
 await assert.rejects(()=>executeApprovedCalendarUpdate({actor,runId:pending.runId}),/approval_required/);assert.equal(patches,0)
 const approved=await run('APPROVE');assert.equal(approved?.status,'completed',approved?.text);assert.equal(patches,1)
 assert.equal(Date.parse(event.start.dateTime),Date.parse('2026-10-01T11:00:00Z'))
 assert.ok(db.agent_activity.some(r=>r.metadata_json?.outcome==='verified_success'&&r.metadata_json?.handler==='calendar-update'))
 await assert.rejects(()=>executeApprovedCalendarUpdate({actor,runId:pending.runId}));assert.equal(patches,1)
 // Definitive provider rejection is failure, not unknown, and needs a new approval.
 for(const status of [400,403,412]){reset();await stage('Move Same Brain Learning Test to 5 PM');rejectPatch=status;assert.equal((await run('APPROVE'))?.status,'failed');assert.equal(db.agent_runs[0].status,'failed');assert.equal(event.start.dateTime,baseEvent.start.dateTime);assert.equal(db.agent_activity.filter(r=>r.metadata_json?.outcome==='verified_success').length,0);assert.equal((await run('Move Same Brain Learning Test to 6 PM'))?.status,'waiting_approval');assert.equal(patches,1)}
 reset();await stage('Move my 4pm meeting to 5pm')
 reset();event={...event,start:{date:'2026-10-01'},end:{date:'2026-10-02'}};assert.match((await run('Move Same Brain Learning Test to 5 PM'))!.text,/All-day/);assert.equal(db.agent_runs.length,0);assert.equal(patches,0)
 // H/I: neither a PATCH receipt nor a mismatched/unknown readback is success or retriable.
 for(const failure of ['timeout','identity','time']){
  reset();const p=await stage('Move Same Brain Learning Test to 4:30 PM');unknown=failure==='timeout';mismatch=failure==='identity';wrongTime=failure==='time'
  const r=await run('APPROVE');assert.equal(r?.status,'outcome_unknown');assert.equal(patches,1)
  assert.equal(db.agent_activity.filter(a=>a.metadata_json?.outcome==='verified_success').length,0)
  await assert.rejects(()=>executeApprovedCalendarUpdate({actor,runId:p.runId}));assert.equal(patches,1)
  assert.equal((await run('Move Same Brain Learning Test to 5 PM'))?.status,'outcome_unknown');assert.equal(patches,1)
 }
 // Exact approval fingerprint, provider-version drift and concurrent execution.
 reset();const changed=await stage('Move Same Brain Learning Test to 5 PM');db.agent_approvals[0].status='approved';db.agent_runs[0].metadata_json.draft.startIso='2026-10-01T20:00:00Z'
 await assert.rejects(()=>executeApprovedCalendarUpdate({actor,runId:changed.runId}),/approval_action_changed/);assert.equal(patches,0)
 reset();const stale=await stage('Move Same Brain Learning Test to 5 PM');db.agent_approvals[0].status='approved';event.etag='"another-version"'
 assert.equal((await executeApprovedCalendarUpdate({actor,runId:stale.runId})).status,'paused');assert.equal(patches,0)
 reset();const concurrent=await stage('Move Same Brain Learning Test to 5 PM');db.agent_approvals[0].status='approved'
 await Promise.allSettled([executeApprovedCalendarUpdate({actor,runId:concurrent.runId}),executeApprovedCalendarUpdate({actor,runId:concurrent.runId})]);assert.equal(patches,1)
 // D/E: real reminder row IDs survive list ordinal selection and chained pronouns.
 reset();db.reminders=[{id:'reminder-1',telegram_id:123,message:'Call Praveen',remind_at:'2026-10-01T10:30:00Z',timezone:'Asia/Kolkata',sent:false},{id:'reminder-2',telegram_id:123,message:'Pay electricity',remind_at:'2026-10-01T11:30:00Z',timezone:'Asia/Kolkata',sent:false}]
 await rememberTypedObjects(123,'reminders',[{id:'reminder-1',title:'Call Praveen'}])
 assert.equal((await run('Move it to 6 PM'))?.status,'completed');assert.equal(db.reminders[0].remind_at,'2026-10-01T12:30:00.000Z')
 await rememberTypedObjects(123,'reminders',db.reminders.map(r=>({id:r.id,title:r.message})),null)
 assert.equal((await run('Move the second one to 9 PM'))?.status,'completed')
 assert.equal((await run('Move that one to 10 PM'))?.status,'completed')
 assert.equal(db.reminders[1].remind_at,'2026-10-01T16:30:00.000Z');assert.equal(db.reminders[0].remind_at,'2026-10-01T12:30:00.000Z');assert.equal(patches,0)
 // Ask-level reminders retain a concrete, exact-ID approval path.
 reset();permission='ask';db.reminders=[{id:'r',telegram_id:123,message:'Call Praveen',remind_at:'2026-10-01T10:30:00Z',timezone:'Asia/Kolkata',sent:false}]
 await rememberTypedObjects(123,'reminders',[{id:'r',title:'Call Praveen'}])
 assert.equal((await run('Move it to 6 PM'))?.status,'waiting_approval');assert.equal(db.reminders[0].remind_at,'2026-10-01T10:30:00Z');assert.equal(db.agent_approvals[0].action_type,'reminder_change')
 assert.equal(await run('yes'),null);assert.equal((await run('APPROVE'))?.status,'completed');assert.equal(db.reminders[0].remind_at,'2026-10-01T12:30:00.000Z');assert.equal(patches,0)
 // Approval does not survive a permission downgrade.
 reset();permission='ask';db.reminders=[{id:'r',telegram_id:123,message:'Call Praveen',remind_at:'2026-10-01T10:30:00Z',timezone:'Asia/Kolkata',sent:false}]
 await rememberTypedObjects(123,'reminders',[{id:'r',title:'Call Praveen'}]);await run('Move it to 6 PM');permission='read'
 assert.equal((await run('APPROVE'))?.status,'paused');assert.equal(db.reminders[0].remind_at,'2026-10-01T10:30:00Z')
 reset();permission='ask';db.reminders=[{id:'r',telegram_id:123,message:'Call Praveen',remind_at:'2026-10-01T10:30:00Z',timezone:'Asia/Kolkata',sent:false}]
 await rememberTypedObjects(123,'reminders',[{id:'r',title:'Call Praveen'}]);await run('Move it to 6 PM');reminderWriteUnknown=true
 assert.equal((await run('APPROVE'))?.status,'outcome_unknown');assert.equal(reminderWrites,1);assert.equal((await run('Move it to 7 PM'))?.status,'outcome_unknown');assert.equal(reminderWrites,1);assert.equal(db.agent_activity.filter(r=>r.metadata_json?.outcome==='verified_success').length,0)
 // F: collision with no active typed selection asks, never guesses.
 // Domain words inside a real title do not override its actual object type.
 reset();event.summary='Team Reminder';await stage('Move Team Reminder to 5 PM')
 reset();event.summary='Team Meeting';db.reminders=[{id:'r',telegram_id:123,message:'Team Meeting',sent:false,remind_at:'2026-10-01T10:00:00Z'}]
 assert.match((await run('Move Team Meeting to 5 PM'))!.text,/Both a Calendar event and a reminder/);assert.equal(db.agent_approvals.length,0)
 reset();db.reminders=[{id:'r',telegram_id:123,message:'Same Brain Learning Test',sent:false,remind_at:'2026-10-01T10:00:00Z'}]
 assert.match((await run('Move Same Brain Learning Test to 5 PM'))!.text,/Both a Calendar event and a reminder/);assert.equal(db.agent_approvals.length,0);assert.equal(patches,0)
 assert.equal(db.agent_activity.filter(r=>r.metadata_json?.outcome==='clarified').length,1)
 // A fresh active type resolves a real cross-domain title collision.
 await rememberTypedObjects(123,'calendar',[{id:event.id,title:event.summary}]);await stage('Move Same Brain Learning Test to 5 PM')
 // Expired context cannot supply a pronoun; explicit selection keeps the exact ID.
 reset();await rememberTypedObjects(123,'calendar',[{id:event.id,title:event.summary}]);db.agent_activity[0].metadata_json.at=new Date(Date.now()-31*60000).toISOString()
 assert.match((await run('Move it to 5 PM'))!.text,/Which Calendar event or reminder/);assert.equal(db.agent_runs.length,0)
 reset();await rememberTypedObjects(123,'calendar',[{id:'other',title:'Other'},{id:event.id,title:event.summary}],null)
 assert.equal((await run('Open the second one'))?.status,'completed');await stage('Move it to 5 PM');assert.equal(db.agent_runs[0].metadata_json.draft.eventId,event.id)
 // Foreign lists do not allow this resolver to steal the owner's ordinal opener.
 reset();await rememberTypedObjects(123,'email',[{id:'mail',title:'Email'}]);assert.equal(await run('Open the first one'),null)
 // Genuine correction feedback binds to a previous real decision; no historic backfill.
 reset();const previousText='Move Same Brain Learning Test to 4:30 PM'
 db.agent_activity.push({telegram_id:'123',event_type:'decision_learning',created_at:new Date(Date.now()-1000).toISOString(),metadata_json:{schema:'same-brain-v2',decision_id:'wrong-route',handler:'compound-plan',domain:'reminders',user_text:previousText,outcome:'unknown'}})
 db.conversations.push({telegram_id:123,role:'user',content:previousText,created_at:new Date(Date.now()-1000).toISOString()})
 await stage('No, I meant move Same Brain Learning Test to 4:30 PM')
 assert.equal(db.agent_activity.filter(r=>r.metadata_json?.outcome==='corrected').length,1)
 assert.equal(db.agent_activity.filter(r=>r.metadata_json?.outcome==='replacement').length,1)
 assert.equal(db.agent_activity.filter(r=>r.metadata_json?.outcome==='verified_success').length,0)
 // Foreign typed identity remains a hard boundary, never a reminder mutation.
 for(const domain of ['email','watchers','travel','browser'] as const){reset();await rememberTypedObjects(123,domain,[{id:'foreign',title:'Object'}]);assert.match((await run('Move it to 6 PM'))!.text,/won't reinterpret/);assert.equal(patches,0)}
 reset();permission='off';assert.equal((await run('Move Same Brain Learning Test to 5 PM'))?.status,'paused');assert.equal(db.agent_approvals.length,0)
 assert.equal(parseTypedTimeRequest('Remind me tomorrow at 4 PM to call Praveen'),null)
 assert.equal(isSameBrainIntrospection('What time is Same Brain Learning Test tomorrow?'),false)
 reset();assert.match((await run('What time is Same Brain Learning Test tomorrow?'))!.text,/16:00:00/)
 assert.equal(movedTime('25 PM',baseEvent.start.dateTime,baseEvent.end.dateTime,'Asia/Kolkata',null),null)
 for(const path of ['app/api/dashboard/chat/route.ts','app/api/webhooks/whatsapp/route.ts','app/api/agent/run/route.ts']){const source=readFileSync(path,'utf8');assert.ok(source.indexOf('await tryTypedTimeRouting(')<source.indexOf('await trySameBrainIntrospection('),path)}
 console.log('Typed identity A-J: named/selected Calendar, reschedule, reminder/ordinal continuation, ambiguity, approval, exact readback, unknown no-retry and web/WhatsApp parity passed; hash, version, concurrency and foreign-domain barriers passed')
 }finally{supabaseAdmin.from=oldFrom;globalThis.fetch=oldFetch}}
main().catch(e=>{console.error(e);process.exitCode=1})
