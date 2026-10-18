import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {buildApprovalBinding,assertApprovalBinding} from '../lib/agent/approval-binding'
import * as dining from '../lib/agent/reservation-dining-context'

const fixed=Date.parse('2026-10-18T10:00:00Z')
let executionNow=Date.parse('2026-10-19T14:31:00Z')
class FixtureDate extends Date {constructor(value?:any){super(value===undefined?executionNow:value)}static now(){return executionNow}}
function load(file:string,deps:Record<string,unknown>){const exports:any={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>deps[name]||{},Date:FixtureDate,Intl,console,URL,Set,Map});return exports}
const preparation=load('lib/agent/restaurant-reservation.ts',{})
const actor={legacyTelegramId:123,userId:'fixture-user',name:'Synthetic Owner'}
const travel={source:'travel_presence',participants:['Synthetic Owner'],confidence:1,startAt:'2026-10-21T00:00:00Z',endAt:'2026-10-24T23:00:00Z',location:'Away city',inferred:false,sourceRefs:[]}
const inventory={ownerId:'123',coveredFrom:new Date(fixed).toISOString(),coveredUntil:'2026-12-17T10:00:00.000Z',incomplete:false,facts:[travel]}
const calendar={ownerId:'123',connected:true,incomplete:false,coveredFrom:new Date(fixed).toISOString(),coveredUntil:inventory.coveredUntil,windows:[{startAt:'2026-10-22T14:00:00.000Z',endAt:'2026-10-22T17:00:00.000Z',sourceRefs:[{type:'calendar_event',id:'opaque-calendar'}]}]}
const preferences={ownerId:'123',incomplete:false,rules:[{id:'fixture-rule',text:'Only vegetarian restaurants'}]}
const snapshot=dining.buildReservationDiningContext({actor,timezone:'Asia/Kolkata',requestedDate:'',releaseAt:'2026-10-19T14:30:00Z',now:new Date(fixed),pack:{reservationTravel:inventory,reservationCalendar:calendar,reservationPreferences:preferences}})
const payload:any={restaurant:'Synthetic Restaurant',reservationUrl:'https://example.test/reserve',reservationLocation:'Home city',partySize:2,preferredStart:'19:00',preferredEnd:'21:00',requestedDate:'',releaseAt:'2026-10-19T14:30:00Z',contextWindows:snapshot.windows,diningContext:snapshot,approvalId:'fixture-approval'}
const boundInput=()=>preparation.restaurantReservationApprovalInput({runId:'fixture-run',lifeEventId:'fixture-event',actionId:'fixture-action',...payload,providerUrl:payload.reservationUrl})
// The real fingerprint, not a fixture implementation, binds all material fields.
const binding=buildApprovalBinding(boundInput())
for(const altered of [{...payload,reservationLocation:'Changed city'},{...payload,diningContext:{...snapshot,until:'2026-12-18T10:00:00Z'}},{...payload,contextWindows:[]},{...payload,diningContext:{...snapshot,calendar:{...snapshot.calendar,windows:[]}}}]){
 assert.throws(()=>assertApprovalBinding(preparation.restaurantReservationApprovalInput({runId:'fixture-run',lifeEventId:'fixture-event',actionId:'fixture-action',...altered,providerUrl:altered.reservationUrl}),binding),/approval_action_changed/)
}
let freshInventory:any=inventory,freshCalendar:any=calendar,freshPreferences:any=preferences,calendarRequested=false,lastCalendarCoverage:any,browserCalls=0,objective='',legacyMode=false,legacyV1=false,legacyV2=false,failTable='',browserFailure=''
const legacyPayload=()=>({...payload,diningContext:legacyV1?{...snapshot,version:1,calendar:undefined}:legacyV2?{...snapshot,version:2,ownerId:undefined,preferences:undefined}:undefined})
const legacyBinding=()=>buildApprovalBinding(preparation.restaurantReservationApprovalInput({runId:'fixture-run',lifeEventId:'fixture-event',actionId:'fixture-action',...legacyPayload(),providerUrl:payload.reservationUrl}))
const updates:Array<{table:string;value:any}>=[]
const db={from(table:string){let writing=false;const q:any={select:()=>q,eq:(key:string,value:any)=>{if(key==='telegram_id')assert.equal(String(value),'123');return q},is:()=>q,in:()=>q,order:()=>q,limit:()=>q,
 update:(value:any)=>{writing=true;updates.push({table,value});return q},maybeSingle:async()=>({error:null,data:table==='life_event_actions'?{id:'fixture-action',status:'waiting_approval',payload_json:legacyMode?legacyPayload():payload}:table==='agent_runs'?{id:'fixture-run',status:'waiting_approval',metadata_json:{plan_type:'restaurant_reservation_release',life_event_id:'fixture-event',life_event_action_id:'fixture-action'}}:table==='life_events'?{id:'fixture-event',title:'Synthetic Restaurant',timezone:'Asia/Kolkata',location:'Home city',metadata_json:{}}:table==='users'?{id:'fixture-user',telegram_id:123,whatsapp_id:'',name:'Synthetic Owner',timezone:'Asia/Kolkata'}:table==='agent_approvals'?{id:'fixture-approval',run_id:'fixture-run',status:'approved',...(legacyMode?legacyBinding():binding)}:table==='agent_permissions'?{level:'ask'}:null}),
 insert:(value:any)=>{updates.push({table,value});return q},then:(resolve:any)=>resolve({error:writing&&table===failTable?{message:'synthetic persistence failure'}:null})};return q}}
const actual=load('lib/agent/restaurant-reservation-worker.ts',{
 '@/lib/supabase-admin':{supabaseAdmin:db},'./restaurant-reservation':preparation,'./approval-binding':{assertApprovalBinding},'./reservation-dining-context':dining,
 './context-brain':{buildContextPack:async(input:any)=>{assert.equal(input.actor.legacyTelegramId,123);calendarRequested=input.options.includeReservationCalendar===true;lastCalendarCoverage=input.options.reservationCalendarCoverage;if(freshInventory instanceof Error)throw freshInventory;return{reservationTravel:freshInventory,reservationCalendar:freshCalendar,reservationPreferences:freshPreferences}}},
 './policy':{evaluateAgentExecutionPolicy:()=>({allowed:true})},'./sentinel':{evaluateAgentSentinel:()=>({allowed:true})},
 './secondary-auth-handoff':{releaseRunAuthHandoff:async()=>{}},
 './secure-computer':{runSecureBrowser:async(input:any)=>{if(browserFailure)throw new Error(browserFailure);browserCalls++;objective=input.objective;return{status:'completed',pageText:'No available slots',actions:[]}}}
})
const action={id:'fixture-action',telegram_id:'123',life_event_id:'fixture-event',payload_json:payload}
const failures:string[]=[]
for(const [label,fresh]of [['unchanged',inventory],['new travel',{...inventory,facts:[{...travel,location:'Changed city'}]}],['partial',{...inventory,incomplete:true}],['failed',new Error('fixture source failure')]] as const){
 freshInventory=fresh;browserCalls=0;objective='';updates.length=0
 try{
  await actual.processOne(action)
  if(label==='unchanged'){if(browserCalls!==1||!/covered|coverage/i.test(objective)||!objective.includes(snapshot.until)||!calendarRequested||!objective.includes(calendar.windows[0].startAt)||!objective.includes(calendar.windows[0].endAt)||!objective.includes(preferences.rules[0].text))failures.push('unchanged snapshot must refresh Calendar and retain its busy intervals and explicit preferences in the actual worker constraints')}
  else if(browserCalls!==0||!updates.some(row=>row.table==='agent_runs'&&row.value.status==='paused'))failures.push(label+' must pause before provider execution')
 }catch(error){failures.push(label+': '+(error instanceof Error?error.message:String(error)))}
}
assert.deepEqual(failures,[],'Fresh context may not silently change or remove approved restrictions')
assert.equal(lastCalendarCoverage?.from,snapshot.from,'Fresh reads must use the approved coverage, rather than expand to unrelated dates')
assert.equal(lastCalendarCoverage?.until,snapshot.until)
freshInventory=inventory
for(const fresh of [{...calendar,incomplete:true},{...calendar,windows:[]},{...calendar,connected:false,windows:[]},undefined]){
 freshCalendar=fresh;browserCalls=0;updates.length=0
 assert.equal((await actual.processOne(action)).status,'paused','Changed or unavailable Calendar coverage requires a new approval')
 assert.equal(browserCalls,0)
 assert.ok(updates.some(row=>row.table==='agent_approvals'&&row.value.status==='expired'))
}
freshCalendar=calendar
for(const fresh of [{...preferences,rules:[]},{...preferences,rules:[{id:'fixture-rule',text:'Quiet indoor seating only'}]},{...preferences,incomplete:true},{...preferences,ownerId:'foreign'},undefined]){
 freshPreferences=fresh;browserCalls=0;updates.length=0
 assert.equal((await actual.processOne(action)).status,'paused','Changed or unavailable explicit rules require a fresh approval')
 assert.equal(browserCalls,0);assert.ok(updates.some(row=>row.table==='agent_approvals'&&row.value.status==='expired'))
}
freshPreferences=preferences
freshInventory=inventory;browserFailure='browser_objective_too_long';browserCalls=0;updates.length=0
assert.equal((await actual.processOne(action)).status,'paused','A rejected oversized authority is a known pre-execution stop, not an unknown provider outcome')
assert.equal(browserCalls,0)
assert.ok(updates.some(row=>row.table==='agent_approvals'&&row.value.status==='expired'))
browserFailure=''
executionNow=fixed;freshInventory=inventory;browserCalls=0
assert.equal((await actual.processOne(action)).status,'queued','A queued action cannot execute before its bound release time')
assert.equal(browserCalls,0)
executionNow=Date.parse('2026-10-19T14:31:00Z')
freshInventory={...inventory,incomplete:true}
for(const table of ['agent_runs','life_event_actions','life_events','agent_approvals']){
 failTable=table;browserCalls=0
 await assert.rejects(()=>actual.processOne(action),/restaurant_reservation_transition_failed/,'Returned persistence errors must not be reported as a successful pause')
 assert.equal(browserCalls,0)
}
failTable=''
const legacyPreparation=load('lib/agent/restaurant-reservation.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'./approval-binding':{assertApprovalBinding},'./reservation-dining-context':dining})
for(const version of ['missing','travel-only-v1','travel-calendar-v2']){
 legacyMode=true;legacyV1=version==='travel-only-v1';legacyV2=version==='travel-calendar-v2';updates.length=0;browserCalls=0
 const legacy=await legacyPreparation.armApprovedRestaurantReservation({actor,runId:'fixture-run'})
 assert.equal(legacy.status,'paused',version+' approval must enter refreshable review')
 assert.ok(updates.some(row=>row.table==='agent_approvals'&&row.value.status==='expired'))
 assert.ok(updates.some(row=>row.table==='agent_runs'&&row.value.status==='paused'))
 assert.equal(updates.some(row=>row.table==='life_event_actions'&&row.value.status==='ready'),false)
 assert.equal((await actual.processOne({...action,payload_json:legacyPayload()})).status,'paused','Already queued legacy authority must also pause before execution')
 assert.equal(browserCalls,0)
}
legacyMode=false
// Actual arm racing with a completed context refresh: same status/error can recur,
// so only the captured row version can prevent restoring the old action payload.
let liveRun:any={id:'fixture-run',status:'waiting_approval',error:null,updated_at:'2026-10-18T09:00:00Z',metadata_json:{plan_type:'restaurant_reservation_release',life_event_id:'fixture-event',life_event_action_id:'fixture-action'}}
let liveAction:any={id:'fixture-action',status:'waiting_approval',updated_at:'2026-10-18T09:00:00Z',payload_json:payload,due_at:payload.releaseAt}
const refreshedPayload={...payload,reservationLocation:'Refreshed city'}
let raceLegacy=false,raceAtRead=true,dropActionWrite=false
const raceDb={from(table:string){let patch:any;const filters:Array<[string,unknown]>=[];const execute=()=>{
 if(patch){const row=table==='agent_runs'?liveRun:table==='life_event_actions'?liveAction:null
  if(dropActionWrite&&table==='life_event_actions')return{data:null,error:null}
  if(row&&filters.every(([key,value])=>row[key]===value||key==='telegram_id')){Object.assign(row,patch);return{data:{id:row.id},error:null}}
  return{data:null,error:null}}
 if(table==='agent_runs')return{data:{...liveRun},error:null}
 if(table==='life_event_actions')return{data:{...liveAction},error:null}
 if(table==='agent_approvals'){
  if(raceAtRead){liveRun={...liveRun,updated_at:'2026-10-18T10:00:01Z'}
  liveAction={...liveAction,payload_json:refreshedPayload,updated_at:'2026-10-18T10:00:01Z'}}
  return{data:{id:'old-approved',status:'approved',...(raceLegacy?buildApprovalBinding({...boundInput(),payload:{...boundInput().payload,diningContext:undefined,reservationLocation:undefined}}):binding)},error:null}}
 return{data:null,error:null}}
 const q:any={select:()=>q,eq:(key:string,value:unknown)=>{filters.push([key,value]);return q},is:(key:string,value:unknown)=>{filters.push([key,value]);return q},order:()=>q,limit:()=>q,update:(value:any)=>{patch=value;return q},maybeSingle:async()=>execute(),then:(resolve:any)=>resolve(execute())};return q}}
const racingArm=load('lib/agent/restaurant-reservation.ts',{'@/lib/supabase-admin':{supabaseAdmin:raceDb},'./approval-binding':{assertApprovalBinding},'./reservation-dining-context':dining})
await assert.rejects(()=>racingArm.armApprovedRestaurantReservation({actor,runId:'fixture-run'}),/restaurant_reservation_state_changed/)
assert.equal(liveAction.payload_json,refreshedPayload,'Stale arm must not overwrite refreshed context or attach old authority')
liveRun={...liveRun,status:'waiting_approval',updated_at:'2026-10-18T09:00:00Z'}
liveAction={...liveAction,status:'waiting_approval',updated_at:'2026-10-18T09:00:00Z',payload_json:{...payload,diningContext:undefined}}
raceLegacy=true
await assert.rejects(()=>racingArm.armApprovedRestaurantReservation({actor,runId:'fixture-run'}),/restaurant_reservation_state_changed/,'Legacy review must also fence stale writes before blocking refreshed context')
assert.equal(liveAction.payload_json,refreshedPayload)
raceLegacy=false;raceAtRead=false;dropActionWrite=true
liveRun={...liveRun,status:'waiting_approval',updated_at:'2026-10-18T09:00:00Z'}
liveAction={...liveAction,status:'waiting_approval',updated_at:'2026-10-18T09:00:00Z',payload_json:payload}
await assert.rejects(()=>racingArm.armApprovedRestaurantReservation({actor,runId:'fixture-run'}),/restaurant_reservation_action_changed/,'Zero affected action rows cannot be reported as armed')
assert.equal(liveAction.status,'waiting_approval')
console.log('Actual reservation worker and real approval fingerprint: bounded context, material-change and failed-refresh guards passed. Inert synthetic I/O only.')
