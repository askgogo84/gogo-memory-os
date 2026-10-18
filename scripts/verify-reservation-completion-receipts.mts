import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {buildApprovalBinding,assertApprovalBinding} from '../lib/agent/approval-binding'
import * as dining from '../lib/agent/reservation-dining-context'

const epoch=Date.parse('2026-10-19T14:31:00Z')
class FixtureDate extends Date{constructor(value?:string|number){super(value===undefined?epoch:value)}static now(){return epoch}}
function load(file:string,deps:Record<string,unknown>){const exports:any={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>deps[name]||{},Date:FixtureDate,Intl,console:{log(){},error(){},warn(){}},URL,Set,Map});return exports}
const actor={legacyTelegramId:123,userId:'synthetic-owner',name:'Synthetic Owner'}
const inventory={ownerId:'123',coveredFrom:'2026-10-18T10:00:00Z',coveredUntil:'2026-12-01T10:00:00Z',incomplete:false,facts:[]}
const calendar={...inventory,connected:true,windows:[]}
const snapshot=dining.buildReservationDiningContext({actor,timezone:'Asia/Kolkata',requestedDate:'',releaseAt:'2026-10-19T14:30:00Z',now:new Date('2026-10-18T10:00:00Z'),pack:{reservationTravel:inventory,reservationCalendar:calendar}})
const payload={restaurant:'Synthetic Restaurant',reservationUrl:'https://provider.example/reserve',reservationLocation:'Home city',partySize:2,preferredStart:'19:00',preferredEnd:'21:00',requestedDate:'',releaseAt:'2026-10-19T14:30:00Z',contextWindows:[],diningContext:snapshot,approvalId:'approval'}
let rows:Record<string,any>,faultTable='',faultMode:'error'|'zero'|'throw'='error',receiptFault=false,providerCalls=0,calendarCalls=0,notifications:string[]=[],activityTypes:string[]=[],writes:Array<{table:string;patch:any}>=[]
const db={from(table:string){let patch:any,insert:any,single=false;const filters:Array<(row:any)=>boolean>=[]
 const execute=()=>{
  if(insert){assert.equal(String(insert.telegram_id),'123');if(table==='agent_activity')activityTypes.push(insert.event_type);else throw Error('Unexpected insert '+table);return{data:null,error:null}}
  const row=rows[table],matches=row&&filters.every(fn=>fn(row))
  if(!matches)return{data:single?null:[],error:null}
  if(patch){
   writes.push({table,patch:structuredClone(patch)})
   const completion=patch.status==='completed'||patch.status==='executed'||patch.lifecycle_state==='watching'
   const receipt=table==='life_event_actions'&&patch.status==='blocked'&&patch.payload_json?.providerConfirmationVerified===true
   if((table===faultTable&&completion)||(receiptFault&&receipt)){
    if(faultMode==='throw')throw Error('Synthetic completion transport failure')
    return{data:null,error:faultMode==='error'?{message:'Synthetic completion write failure'}:null}
   }
   Object.assign(row,structuredClone(patch))
  }
  return{data:single?structuredClone(row):[structuredClone(row)],error:null}
 }
 const q:any={select:()=>q,eq:(key:string,value:unknown)=>{filters.push(row=>String(row[key])===String(value));return q},is:(key:string,value:unknown)=>{filters.push(row=>(row[key]??null)===value);return q},in:(key:string,values:unknown[])=>{filters.push(row=>values.includes(row[key]));return q},not:()=>q,order:()=>q,limit:()=>q,lte:()=>q,or:()=>q,
 update:(value:unknown)=>{patch=value;return q},insert:(value:unknown)=>{insert=value;return q},maybeSingle:async()=>{single=true;return execute()},then:(resolve:any,reject:any)=>Promise.resolve().then(execute).then(resolve,reject)}
 return q
}}
const prep=load('lib/agent/restaurant-reservation.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'./approval-binding':{assertApprovalBinding},'./reservation-dining-context':dining})
const bound=buildApprovalBinding(prep.restaurantReservationApprovalInput({runId:'run',lifeEventId:'event',actionId:'action',...payload,providerUrl:payload.reservationUrl}))
const result={status:'completed',url:'https://provider.example/confirmation',title:'Reservation confirmed',pageText:'Reservation confirmed for Synthetic Restaurant on 24 Oct 2026 at 8:30 pm',actions:[{kind:'submit',status:'done'}]}
const worker=load('lib/agent/restaurant-reservation-worker.ts',{
 '@/lib/supabase-admin':{supabaseAdmin:db},'./restaurant-reservation':prep,'./approval-binding':{assertApprovalBinding},'./reservation-dining-context':dining,
 './context-brain':{buildContextPack:async(input:any)=>{assert.equal(input.actor.legacyTelegramId,123);return{reservationTravel:inventory,reservationCalendar:calendar}}},
 './policy':{evaluateAgentExecutionPolicy:()=>({allowed:true})},'./sentinel':{evaluateAgentSentinel:()=>({allowed:true})},
 './secondary-auth-handoff':{releaseRunAuthHandoff:async()=>{}},
 './secure-computer':{runSecureBrowser:async()=>{providerCalls++;return structuredClone(result)}},
 './booking-calendar-execution':{prepareBookingCalendarApproval:async()=>{calendarCalls++;return{runId:'calendar-draft'}}},
 '@/lib/channels/whatsapp':{sendWhatsAppMessage:async(_recipient:string,text:string)=>{notifications.push(text)}},
})
function reset(){faultTable='';faultMode='error';receiptFault=false;providerCalls=0;calendarCalls=0;notifications=[];activityTypes=[];writes=[];rows={
 agent_runs:{id:'run',telegram_id:'123',status:'queued',error:null,updated_at:'2026-10-18T10:00:00Z',metadata_json:{plan_type:'restaurant_reservation_release',life_event_id:'event',life_event_action_id:'action'}},
 life_event_actions:{id:'action',telegram_id:'123',life_event_id:'event',action_key:'restaurant-reservation-release',status:'ready',payload_json:structuredClone(payload),due_at:payload.releaseAt},
 life_events:{id:'event',telegram_id:'123',title:'Synthetic Restaurant',timezone:'Asia/Kolkata',location:'Home city',lifecycle_state:'planned',metadata_json:{}},
 agent_approvals:{id:'approval',telegram_id:'123',run_id:'run',status:'approved',action_type:'booking',...bound},
 users:{id:'synthetic-owner',telegram_id:123,whatsapp_id:'fixture-owner',name:'Synthetic Owner',timezone:'Asia/Kolkata'},agent_permissions:{telegram_id:'123',capability:'browser',level:'ask'},
}}
const failures:string[]=[]
async function check(label:string,fn:()=>Promise<void>){try{await fn();console.log('PASS '+label)}catch(error){failures.push(label+': '+(error instanceof Error?error.message:String(error)))}}
await check('verified confirmation with durable writes completes the same mission once',async()=>{
 reset();const response=await worker.processOne(structuredClone(rows.life_event_actions))
 assert.equal(response.status,'completed');assert.equal(providerCalls,1);assert.equal(rows.agent_runs.status,'completed');assert.equal(rows.agent_approvals.status,'executed')
 assert.equal(rows.life_event_actions.payload_json.providerConfirmationVerified,true);assert.equal(calendarCalls,1);assert.equal(notifications.filter(t=>t.startsWith('✅')).length,1)
})
for(const mode of ['error','zero','throw']as const)for(const table of ['agent_runs','life_event_actions','life_events','agent_approvals'])await check(table+' '+mode+' completion fault cannot report success or repeat provider submission',async()=>{
 reset();faultTable=table;faultMode=mode;const original=structuredClone(rows.life_event_actions)
 let response:any;try{response=await worker.processOne(original)}catch{}
 assert.notEqual(response?.status,'completed','completion fault must remain visible')
 assert.equal(providerCalls,1);assert.equal(calendarCalls,0);assert.ok(!notifications.some(t=>t.startsWith('✅')))
 assert.equal(activityTypes.includes('restaurant_reservation_verified'),false)
 assert.equal(rows.life_event_actions.payload_json.providerConfirmationVerified,true,'known provider result survives partial bookkeeping')
 assert.equal(rows.life_event_actions.status,'blocked','receipt quarantines the action')
 const before=providerCalls;try{await worker.processOne(original)}catch{}assert.equal(providerCalls,before,'stale original action cannot replay')
})
for(const mode of ['error','zero','throw']as const)await check('receipt '+mode+' fault never continues completion or retries provider',async()=>{
 reset();receiptFault=true;faultMode=mode;const original=structuredClone(rows.life_event_actions)
 let response:any;try{response=await worker.processOne(original)}catch{}
 assert.notEqual(response?.status,'completed');assert.equal(providerCalls,1);assert.equal(calendarCalls,0);assert.ok(!notifications.some(t=>t.startsWith('✅')))
 const before=providerCalls;try{await worker.processOne(original)}catch{}assert.equal(providerCalls,before)
})
await check('already confirmed receipt cannot be armed again with a surviving old approval',async()=>{
 reset();rows.life_event_actions.status='blocked';rows.life_event_actions.payload_json.providerConfirmationVerified=true
 await assert.rejects(()=>prep.armApprovedRestaurantReservation({actor,runId:'run'}),/already_confirmed/)
 assert.equal(rows.life_event_actions.status,'blocked');assert.equal(providerCalls,0);assert.equal(writes.length,0)
})
await check('a mismatched owner cannot claim or mutate another owners action',async()=>{
 reset();const original=structuredClone(rows.life_event_actions);const response=await worker.processOne({...original,telegram_id:'456'})
 assert.equal(response.status,'skipped');assert.equal(rows.life_event_actions.status,'ready');assert.equal(writes.length,0);assert.equal(providerCalls,0)
})
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}else console.log('Reservation completion receipts, explicit write/row/transport failures, same-mission no-replay and owner scope passed; inert fixtures only.')
