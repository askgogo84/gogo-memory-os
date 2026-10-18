import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import * as timezone from '../lib/timezone'
import * as dining from '../lib/agent/reservation-dining-context'
import {buildApprovalBinding,assertApprovalBinding} from '../lib/agent/approval-binding'

// Actual parser, queue and preparation. No provider, model or real DB operation.
const epoch=Date.parse('2026-10-18T10:00:00Z')
class Clock extends Date{constructor(value?:any){super(value===undefined?epoch:value)}static now(){return epoch}}
const actor={legacyTelegramId:123,userId:'fixture-owner',name:'Synthetic Owner'}
const input='Book Naru Noodle Bar for 2 on 2026-10-25 at 8:30 PM only.'
const proof={version:1,kind:'exact',start:'20:30',end:'20:30'}
let writes:Array<{table:string;value:any}>=[],dbReads=0,providerReads=0,busy:any[]=[],stored:any=null,pauseWriteFails=false,bindingInput:any
const db={from(table:string){dbReads++;let writing=false;const filters:Record<string,unknown>={};const q:any={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(String(value),'123');filters[key]=value;return q},in:()=>q,order:()=>q,limit:()=>q,
 maybeSingle:async()=>({data:writing?{id:stored?.id||'fixture-'+table}:table==='users'?{timezone:'Asia/Kolkata'}:table==='agent_runs'&&filters.id===stored?.id?stored:null,error:writing&&pauseWriteFails?{message:'inert pause write failed'}:null}),
 update:(value:any)=>{writing=true;writes.push({table,value});return q},upsert:(value:any)=>{assert.equal(String(value.telegram_id),'123');writes.push({table,value});return q},insert:(value:any)=>{assert.equal(String(value.telegram_id),'123');writes.push({table,value});return q},single:async()=>({data:{id:'fixture-'+table},error:null}),then:(resolve:any)=>resolve({data:[],error:writing&&pauseWriteFails?{message:'inert pause write failed'}:null})};return q}}
const actual:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/restaurant-reservation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:actual,require:(name:string)=>name==='node:crypto'?{createHash}:name==='@/lib/supabase-admin'?{supabaseAdmin:db}:name==='@/lib/timezone'?timezone:name==='./reservation-dining-context'?dining:name==='./approval-binding'?{buildApprovalBinding:(value:any)=>{bindingInput=value;return buildApprovalBinding(value)},assertApprovalBinding}:name==='./secure-computer'?{runSecureBrowser:async(p:any)=>{assert.equal(p.mode,'read');providerReads++;return{status:'completed',pageText:'Sold out. Bookings open every Monday at 8 PM.'}}}:name==='./context-brain'?{buildContextPack:async(p:any)=>{assert.equal(p.actor.legacyTelegramId,123);const c={ownerId:'123',incomplete:false,coveredFrom:p.options.reservationCalendarCoverage?.from||new Date(epoch).toISOString(),coveredUntil:p.options.reservationCalendarCoverage?.until||'2026-12-17T10:00:00Z'};return{facts:[],reservationTravel:{...c,facts:[]},reservationCalendar:{...c,connected:true,windows:busy},reservationPreferences:{ownerId:'123',incomplete:false,rules:[]}}}}:{},Date:Clock,Intl,console,URL,Set,Map})
const request=(text=input)=>actual.tryRunRestaurantReservation({actor,surface:'dashboard',text})
const metadata=()=>({plan_type:'restaurant_reservation_research',request_schema_version:2,request_complete:true,request_hash:createHash('sha256').update([actor.legacyTelegramId,input.toLowerCase()].join('|')).digest('hex').slice(0,40),request_text:input,restaurant:'Naru Noodle Bar',party_size:2,preferred_start:'20:30',preferred_end:'20:30',requested_date:'2026-10-25',next_available:false,max_booking_fee_paise:0,timeConstraint:{...proof}})
const failures:string[]=[]
async function check(label:string,fn:()=>Promise<void>|void){try{await fn();console.log('PASS '+label)}catch(e){failures.push(label+': '+(e instanceof Error?e.message:String(e)))}finally{writes=[];dbReads=0;providerReads=0;busy=[];stored=null;pauseWriteFails=false;bindingInput=undefined}}
await check('canonical exact8:30PM-only survives the actual intent parser',()=>{
 const p=actual.parseRestaurantReservationIntent(input);assert.equal(p.preferredStart,'20:30');assert.equal(p.preferredEnd,'20:30');assert.equal(p.timeClarificationNeeded,false)
})
await check('explicit24h and only-prefix clocks remain exact without widening',()=>{
 for(const phrase of ['at 20:30 only','only at 8:30 PM','8:30pm only']){const p=actual.parseRestaurantReservationIntent('Book Naru Noodle Bar for 2 '+phrase);assert.equal(p.preferredStart,'20:30',phrase);assert.equal(p.preferredEnd,'20:30',phrase)}
})
await check('release clock is not substituted for an explicitly constrained dining clock',()=>{
 const p=actual.parseRestaurantReservationIntent('Book Naru Noodle Bar for 2 when bookings open at 8 PM; dining at 8:30 PM only.');assert.equal(p.preferredStart,'20:30');assert.equal(p.preferredEnd,'20:30')
})
await check('range and genuinely unrestricted controls retain their meaning',()=>{
 const p=actual.parseRestaurantReservationIntent('Book Naru Noodle Bar for 2 between 7 PM and 9 PM.');assert.equal(p.preferredStart,'19:00');assert.equal(p.preferredEnd,'21:00');assert.notEqual(p.timeClarificationNeeded,true)
 const u=actual.parseRestaurantReservationIntent('Book Naru Noodle Bar for 2 at the next available slot.');assert.equal(u.preferredStart,'');assert.equal(u.preferredEnd,'');assert.notEqual(u.timeClarificationNeeded,true)
})
await check('a plain explicit dining start also stays exact without needing the word only',()=>{
 const p=actual.parseRestaurantReservationIntent('Book Naru Noodle Bar for 2 at 8:30 PM.');assert.equal(p.preferredStart,'20:30');assert.equal(p.preferredEnd,'20:30');assert.equal(p.timeClarificationNeeded,false)
})
await check('ordinary ambiguous or competing clock language cannot become unrestricted authority',async()=>{
 for(const suffix of ['at 8:30','at 8:30 PM or 9 PM','at 8:30pmonly']){
  const text='Book Naru Noodle Bar for 2 '+suffix;assert.equal(actual.parseRestaurantReservationIntent(text).timeClarificationNeeded,true,suffix)
  writes=[];dbReads=0;providerReads=0;assert.equal((await request(text)).status,'paused');assert.equal(writes.length,0);assert.equal(dbReads,0);assert.equal(providerReads,0)
 }
})
await check('range-final only and party-only language never narrow a range to its final endpoint',()=>{
 const p=actual.parseRestaurantReservationIntent('Book Naru Noodle Bar for 2 between 7 PM and 9 PM only.');assert.equal(p.preferredStart,'19:00');assert.equal(p.preferredEnd,'21:00');assert.equal(p.timeClarificationNeeded,false)
 const u=actual.parseRestaurantReservationIntent('Book Naru Noodle Bar for 2 people only at the next available slot.');assert.equal(u.preferredStart,'');assert.equal(u.preferredEnd,'');assert.equal(u.timeClarificationNeeded,false)
})
await check('a release-only clock does not become a dining start restriction',()=>{
 const p=actual.parseRestaurantReservationIntent('Book Naru Noodle Bar for 2 at the next available slot when bookings open at 8 PM.');assert.equal(p.preferredStart,'');assert.equal(p.preferredEnd,'');assert.equal(p.timeClarificationNeeded,false)
})
await check('excluded or relational clocks pause before preparation or queued research',async()=>{
 for(const suffix of ['between 7 PM and 9 PM, but not at 8:30 PM','between 7 PM and 9 PM, but do not book at 8:30 PM',"between 7 PM and 9 PM, but don't book at 8:30 PM",'between 7 PM and 9 PM, never choose the 8:30 PM slot','at any time except 8:30 PM','at any time excluding 8:30 PM','not at 8:30 PM','after 8:30 PM','no earlier than 8:30 PM','at 8:30 PM only but not at 8:30 PM']){
  const text='Book Naru Noodle Bar for 2 on 2026-10-25 '+suffix
  writes=[];dbReads=0;providerReads=0;assert.equal(actual.parseRestaurantReservationIntent(text).timeClarificationNeeded,true,suffix)
  assert.equal((await request(text)).status,'paused');assert.equal((await actual.queueRestaurantReservationResearch({actor,text})).status,'paused')
  assert.equal(dbReads,0);assert.equal(providerReads,0);assert.equal(writes.length,0)
 }
})
await check('release-status and fee negation do not erase a supported dining range',async()=>{
 const text='Book Naru Noodle Bar for 2 at the next available slot between 7 PM and 9 PM. If bookings are not open yet, monitor the release time and complete the reservation when it opens. Do not exceed any booking fee or deposit without asking me first.'
 const p=actual.parseRestaurantReservationIntent(text);assert.equal(p.preferredStart,'19:00');assert.equal(p.preferredEnd,'21:00');assert.equal(p.timeClarificationNeeded,false)
 assert.equal((await actual.queueRestaurantReservationResearch({actor,text})).status,'queued');assert.ok(writes.some(w=>w.table==='agent_runs'&&w.value.metadata_json?.timeConstraint?.kind==='window'));assert.equal(providerReads,0)
})
await check('only-clock authority cannot hide competing or malformed remaining clocks',async()=>{
 for(const suffix of ['at 8:30 PM only or 9 PM','only at 8:30 PM and at 9 PM','at 8:30 PM only and only at 25:30','at 8:30 PM only or at 9:15','at 8:30 PM only or 25:30','at 8:30 PM only or 25:30 only','at 8:30 PM only or 9:99','at 8:30 PM only or 9:3']){
  const text='Book Naru Noodle Bar for 2 on 2026-10-25 '+suffix
  writes=[];dbReads=0;providerReads=0;assert.equal(actual.parseRestaurantReservationIntent(text).timeClarificationNeeded,true,suffix)
  assert.equal((await request(text)).status,'paused');assert.equal((await actual.queueRestaurantReservationResearch({actor,text})).status,'paused')
  assert.equal(dbReads,0);assert.equal(providerReads,0);assert.equal(writes.length,0)
 }
})
await check('explicit unsupported timezones cannot silently become owner-local authority',async()=>{
 for(const suffix of ['at 8 PM UTC only','at 20:00 GMT+01:00','only at 8:30 PM IST','at 8 PM America/New_York','between 7 PM and 9 PM Eastern time']){
  const text='Book Naru Noodle Bar for 2 on 2026-10-25 '+suffix
  writes=[];dbReads=0;providerReads=0;assert.equal(actual.parseRestaurantReservationIntent(text).timeClarificationNeeded,true,suffix)
  assert.equal((await request(text)).status,'paused');assert.equal((await actual.queueRestaurantReservationResearch({actor,text})).status,'paused')
  assert.equal(dbReads,0);assert.equal(providerReads,0);assert.equal(writes.length,0)
 }
})
await check('ambiguous multiple or contradictory clocks ask before provider or DB work',async()=>{
 for(const text of ['Book Naru Noodle Bar for 2 at 8:30 only.','Book Naru Noodle Bar for 2 at 8:30 PM only and 9 PM only.','Book Naru Noodle Bar for 2 between 7 PM and 9 PM at 10 PM only.']){
  writes=[];dbReads=0;providerReads=0;assert.equal(actual.parseRestaurantReservationIntent(text).timeClarificationNeeded,true)
  assert.equal((await request(text)).status,'paused');assert.equal(dbReads,0);assert.equal(providerReads,0);assert.equal(writes.length,0)
  assert.equal((await actual.queueRestaurantReservationResearch({actor,text})).status,'paused');assert.equal(dbReads,0)
 }
})
await check('exact preparation binds the same versioned contract and shows only the exact start',async()=>{
 const r=await request();assert.equal(r.status,'waiting_approval');const payload=writes.find(w=>w.table==='life_event_actions')!.value.payload_json
 assert.equal(payload.preferredStart,'20:30');assert.equal(payload.preferredEnd,'20:30');assert.deepEqual(JSON.parse(JSON.stringify(payload.timeConstraint)),proof)
 assert.deepEqual(JSON.parse(JSON.stringify(bindingInput.payload.timeConstraint)),proof)
 assert.match(JSON.stringify(writes.find(w=>w.table==='agent_approvals')!.value.payload_preview),/20:30 only/);assert.match(r.text,/20:30 only/)
 const binding=buildApprovalBinding(bindingInput);assert.throws(()=>assertApprovalBinding({...bindingInput,payload:{...bindingInput.payload,timeConstraint:{...proof,start:'19:00',end:'21:00',kind:'window'}}},binding),/approval_action_changed/)
})
await check('exact dining start does not inherit an unrelated morning Calendar conflict',async()=>{
 busy=[{startAt:'2026-10-25T03:30:00Z',endAt:'2026-10-25T04:30:00Z',sourceRefs:[{type:'calendar_event',id:'morning'}]}]
 const r=await request();assert.equal(r.status,'waiting_approval');const payload=writes.find(w=>w.table==='life_event_actions')!.value.payload_json
 assert.equal(payload.diningContext.calendar.windows.length,1,'Full date context retains the busy interval for later complete-meal validation')
})
await check('exact start overlapping Calendar pauses without creating authority or claiming meal duration',async()=>{
 busy=[{startAt:'2026-10-25T14:30:00Z',endAt:'2026-10-25T15:30:00Z',sourceRefs:[{type:'calendar_event',id:'evening'}]}]
 const r=await request();assert.equal(r.status,'paused');assert.equal(writes.length,0);assert.match(r.text,/20:30 only/);assert.doesNotMatch(r.text,/meal.*(?:free|clear)|90.minute/i)
})
await check('actual queue stores complete original request and the same exact contract',async()=>{
 const r=await actual.queueRestaurantReservationResearch({actor,text:input});assert.equal(r.status,'queued')
 const meta=writes.find(w=>w.table==='agent_runs')!.value.metadata_json
 assert.equal(meta.request_schema_version,2);assert.equal(meta.request_complete,true);assert.equal(meta.request_text,input);assert.deepEqual(JSON.parse(JSON.stringify(meta.timeConstraint)),proof)
})
await check('long request is rejected before a prefix hash or truncated queue record can lose a late restriction',async()=>{
 const text='Book Naru Noodle Bar for 2 '+('context '.repeat(260))+' at 8:30 PM only.'
 const r=await actual.queueRestaurantReservationResearch({actor,text});assert.equal(r.status,'paused');assert.equal(writes.length,0);assert.equal(dbReads,0);assert.equal(providerReads,0)
})
await check('stored complete current request reparses into exact preparation and authority',async()=>{
 stored={id:'stored-run',status:'running',metadata_json:metadata()};const r=await actual.runQueuedRestaurantReservationResearch({actor,runId:'stored-run'});assert.equal(r.status,'waiting_approval');assert.equal(providerReads,1)
 assert.deepEqual(JSON.parse(JSON.stringify(writes.find(w=>w.table==='life_event_actions')!.value.payload_json.timeConstraint)),proof)
})
await check('legacy incomplete or inconsistent stored request pauses before provider preparation',async()=>{
 for(const patch of [{request_schema_version:undefined},{request_complete:false},{request_hash:'wrong'},{restaurant:'Other Restaurant'},{party_size:3},{requested_date:'2026-10-26'},{next_available:true},{max_booking_fee_paise:1},{request_text:input.replace('8:30 PM','9 PM')},{preferred_start:'19:00'},{timeConstraint:{...proof,kind:'unrestricted',start:'',end:''}}]){
  writes=[];providerReads=0;stored={id:'stored-run',status:'running',metadata_json:{...metadata(),...patch}}
  const r=await actual.runQueuedRestaurantReservationResearch({actor,runId:'stored-run'});assert.equal(r.status,'paused');assert.equal(providerReads,0);assert.equal(writes.some(w=>['life_event_actions','agent_approvals'].includes(w.table)),false)
  assert.ok(writes.some(w=>w.table==='agent_runs'&&w.value.status==='paused'),'The exact old job retains a visible review state')
 }
})
await check('failure to persist an old-request pause is explicit and never reaches a provider',async()=>{
 stored={id:'stored-run',status:'running',metadata_json:{...metadata(),request_complete:false}};pauseWriteFails=true
 await assert.rejects(()=>actual.runQueuedRestaurantReservationResearch({actor,runId:'stored-run'}),/restaurant_research_request_review_failed/);assert.equal(providerReads,0)
})
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}else console.log('Exact dining intent, complete queued request and approval binding controls passed; inert fixtures, not deterministic provider-slot or full T12 verification.')
