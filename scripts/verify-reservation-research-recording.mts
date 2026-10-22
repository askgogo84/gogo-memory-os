import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import * as timezone from '../lib/timezone'
import * as dining from '../lib/agent/reservation-dining-context'
import * as binding from '../lib/agent/approval-binding'
const epoch=Date.parse('2026-10-18T10:00:00Z')
class Clock extends Date{constructor(value?:any){super(value===undefined?epoch:value)}static now(){return epoch}}
const actor={legacyTelegramId:123,userId:'fixture-owner'},input='Book Naru Noodle Bar for 2 on 2026-10-25 at 8:30 PM only.'
type Fault=''|'error'|'zero'|'throw'
function harness(completionFault:Fault='',failureFault:Fault='',providerFails=false,status='running'){
 const writes:any[]=[],filtersWritten:any[]=[],providerCalls:any[]=[]
 const stored:any={id:'original-research',status,metadata_json:{plan_type:'restaurant_reservation_research',request_schema_version:2,request_complete:true,request_hash:createHash('sha256').update('123|'+input.toLowerCase()).digest('hex').slice(0,40),request_text:input,restaurant:'Naru Noodle Bar',party_size:2,preferred_start:'20:30',preferred_end:'20:30',requested_date:'2026-10-25',next_available:false,max_booking_fee_paise:0,timeConstraint:{version:1,kind:'exact',start:'20:30',end:'20:30'}}}
 const db={from(table:string){let write:any=null;const filters:any={};const result=()=>{
  if(write&&table==='agent_runs'&&filters.id===stored.id){
   filtersWritten.push({...filters});const fault=write.status==='completed'?completionFault:failureFault
   if(fault==='throw')throw Error('inert '+write.status+' rejected write')
   if(fault==='error')return{data:null,error:{message:'inert '+write.status+' returned error'}}
   if(fault==='zero')return{data:null,error:null}
   stored.status=write.status;return{data:{id:stored.id},error:null}
  }
  return{data:write?{id:'fixture-'+table}:table==='users'?{timezone:'Asia/Kolkata'}:table==='agent_runs'&&filters.id===stored.id?stored:[],error:null}
 };const q:any={select:()=>q,eq:(key:string,value:any)=>{if(key==='telegram_id')assert.equal(String(value),'123');filters[key]=value;return q},in:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>result(),single:async()=>result(),then:(resolve:any,reject:any)=>Promise.resolve().then(result).then(resolve,reject),update:(value:any)=>{write=value;writes.push({table,value});return q},insert:(value:any)=>{assert.equal(String(value.telegram_id),'123');write=value;writes.push({table,value});return q},upsert:(value:any)=>{write=value;writes.push({table,value});return q}};return q}}
 const actual:any={};runInNewContext(ts.transpileModule(readFileSync('lib/agent/restaurant-reservation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:actual,require:(name:string)=>name==='node:crypto'?{createHash}:name==='@/lib/supabase-admin'?{supabaseAdmin:db}:name==='@/lib/timezone'?timezone:name==='./reservation-dining-context'?dining:name==='./approval-binding'?binding:name==='./secure-computer'?{runSecureBrowser:async(p:any)=>{assert.equal(p.mode,'read');providerCalls.push(p);if(providerFails)throw Error('inert research provider unavailable');return{status:'completed',pageText:'Sold out. Bookings open every Monday at 8 PM.'}}}:name==='./context-brain'?{buildContextPack:async(p:any)=>{const c={ownerId:'123',incomplete:false,coveredFrom:p.options.reservationCalendarCoverage?.from||new Date(epoch).toISOString(),coveredUntil:p.options.reservationCalendarCoverage?.until||'2026-12-17T10:00:00Z'};return{facts:[],reservationTravel:{...c,facts:[]},reservationCalendar:{...c,connected:true,windows:[]},reservationPreferences:{ownerId:'123',incomplete:false,rules:[]}}}}:{},Date:Clock,Intl,console,URL,Set,Map})
 return{run:()=>actual.runQueuedRestaurantReservationResearch({actor,runId:stored.id}),writes,filtersWritten,providerCalls,stored}
}
const failures:string[]=[]
async function check(label:string,fn:()=>Promise<void>){try{await fn();console.log('PASS '+label)}catch(e){failures.push(label+': '+(e instanceof Error?e.message:String(e)))}}
await check('successful research records the original job then returns its child approval result',async()=>{
 const h=harness(),r=await h.run();assert.equal(r.status,'waiting_approval');assert.equal(h.providerCalls.length,1);assert.equal(h.stored.status,'completed');assert.ok(h.writes.some(w=>w.table==='agent_approvals'));await assert.rejects(()=>h.run(),/restaurant_research_run_not_running/);assert.equal(h.providerCalls.length,1)
})
await check('completed failed paused and unclaimed queued jobs cannot research again',async()=>{
 for(const status of ['completed','failed','paused','queued']){const h=harness('','',false,status);await assert.rejects(()=>h.run(),/restaurant_research_run_not_running/,status);assert.equal(h.providerCalls.length,0);assert.equal(h.writes.length,0)}
})
await check('returned zero-row and thrown completion failures cannot return research success',async()=>{
 for(const fault of ['error','zero','throw'] as Fault[]){const h=harness(fault);await assert.rejects(()=>h.run(),/restaurant_research_completion_recording_failed/);assert.equal(h.providerCalls.length,1);assert.ok(h.writes.some(w=>w.table==='agent_approvals'),'Child approval already exists; never deny it was created');assert.equal(h.stored.status,'failed');await assert.rejects(()=>h.run(),/restaurant_research_run_not_running/);assert.equal(h.providerCalls.length,1)}
})
await check('recording transitions bind exact owner type and running status',async()=>{
 const h=harness('error');await assert.rejects(()=>h.run(),/recording_failed/);assert.ok(h.filtersWritten.length>=2);for(const f of h.filtersWritten){assert.equal(f.telegram_id,'123');assert.equal(f.type,'restaurant_reservation_research');assert.equal(f.status,'running');assert.equal(f.id,'original-research')}
})
await check('failure recovery returned zero-row and thrown errors remain explicit',async()=>{
 for(const fault of ['error','zero','throw'] as Fault[]){const h=harness('error',fault);await assert.rejects(()=>h.run(),/restaurant_research_failure_recording_failed/);assert.equal(h.providerCalls.length,1)}
})
await check('provider read failure retains a paused child outcome without claiming an approval',async()=>{
 const h=harness('','',true),r=await h.run();assert.equal(r.status,'paused');assert.equal(h.stored.status,'completed');assert.equal(h.writes.some(w=>w.table==='agent_approvals'),false);assert.equal(h.providerCalls.length,1);assert.ok(h.writes.some(w=>w.table==='agent_runs'&&w.value.metadata_json?.outcome_status==='paused'))
})
async function cronHarness(workerFails=true,sendFails=false){
 const messages:string[]=[];const db={from(table:string){const f:any={};let update=false;const data=()=>table==='users'?{id:'fixture-owner',telegram_id:123,whatsapp_id:'inert-contact'}:update?{id:'original-research'}:f.type==='restaurant_reservation_research'&&f.status==='queued'?[{id:'original-research',telegram_id:'123'}]:[];const q:any={select:()=>q,eq:(k:string,v:any)=>{f[k]=v;return q},in:()=>q,lte:()=>q,lt:()=>q,gte:()=>q,order:()=>q,limit:()=>q,update:()=>{update=true;return q},maybeSingle:async()=>({data:data(),error:null}),then:(resolve:any)=>resolve({data:data(),error:null})};return q}}
 const route:any={};runInNewContext(ts.transpileModule(readFileSync('app/api/cron/autonomous-runs/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:route,require:(name:string)=>name==='@/lib/agent/run-outcome-delivery'?{processRunOutcomeNotices:async()=>({checked:0,accepted:0,deferred:0,unknown:0,failed:0})}:name==='next/server'?{NextResponse:{json:(data:any,init:any)=>new Response(JSON.stringify(data),init)}}:name==='@/lib/supabase-admin'?{supabaseAdmin:db}:name==='@/lib/agent/restaurant-reservation'?{runQueuedRestaurantReservationResearch:async()=>{if(workerFails)throw Error('restaurant_research_completion_recording_failed');return{status:'waiting_approval',text:'Review your saved reservation proposal in Activity.'}}}:name==='@/lib/agent/stale-runs'?{sweepStaleRunningRuns:async()=>0,sweepAbandonedSignIns:async()=>0}:name==='@/lib/whatsapp'?{sendWhatsApp:async(_to:string,text:string)=>{messages.push(text);if(sendFails)throw Error('inert notification uncertain')}}:{},Date:Clock,URL,console,process:{env:{CRON_SECRET:'inert-cron-key'}}})
 const response=await route.GET(new Request('https://fixture.invalid/cron?secret=inert-cron-key'));return{response,body:await response.json(),messages}
}
await check('actual scheduler error notice does not deny a possibly saved approval or invite blind retry',async()=>{
 const {response,body,messages}=await cronHarness();assert.equal(response.status,200);assert.equal(body.reservationResearchDone,0);assert.equal(body.reservationResearchFailed,1);assert.equal(messages.length,1);assert.doesNotMatch(messages[0],/did not.*(?:create|approval)|try again shortly/i);assert.match(messages[0],/Activity|saved proposal|verify/i)
})
await check('uncertain result notification is counted separately and never triggers a second send',async()=>{
 const {body,messages}=await cronHarness(false,true);assert.equal(body.reservationResearchDone,1);assert.equal(body.reservationResearchFailed,0);assert.equal(body.reservationResearchNotificationFailed,1);assert.equal(messages.length,1)
})
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}else console.log('Actual reservation research persistence and scheduler notice passed; inert transports only, no sends/bookings or full T12 acceptance.')
