import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {buildApprovalBinding,assertApprovalBinding} from '../lib/agent/approval-binding'
import * as dining from '../lib/agent/reservation-dining-context'

const fixed=Date.parse('2026-10-18T10:00:00Z')
class FixtureDate extends Date {constructor(value?:any){super(value===undefined?fixed:value)}static now(){return fixed}}
function load(file:string,deps:Record<string,unknown>){const exports:any={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>deps[name]||{},Date:FixtureDate,Intl,console,URL,Set,Map});return exports}
const preparation=load('lib/agent/restaurant-reservation.ts',{})
const actor={legacyTelegramId:123,userId:'fixture-user',name:'Synthetic Owner'}
const travel={source:'travel_presence',participants:['Synthetic Owner'],confidence:1,startAt:'2026-10-21T00:00:00Z',endAt:'2026-10-24T23:00:00Z',location:'Away city',inferred:false,sourceRefs:[]}
const inventory={ownerId:'123',coveredFrom:new Date(fixed).toISOString(),coveredUntil:'2026-12-17T10:00:00.000Z',incomplete:false,facts:[travel]}
const snapshot=dining.buildReservationDiningContext({actor,timezone:'Asia/Kolkata',requestedDate:'',releaseAt:'2026-10-19T14:30:00Z',now:new Date(fixed),pack:{reservationTravel:inventory}})
const payload:any={restaurant:'Synthetic Restaurant',reservationUrl:'https://example.test/reserve',reservationLocation:'Home city',partySize:2,preferredStart:'19:00',preferredEnd:'21:00',requestedDate:'',releaseAt:'2026-10-19T14:30:00Z',contextWindows:snapshot.windows,diningContext:snapshot,approvalId:'fixture-approval'}
const boundInput=()=>preparation.restaurantReservationApprovalInput({runId:'fixture-run',lifeEventId:'fixture-event',actionId:'fixture-action',...payload,providerUrl:payload.reservationUrl})
// The real fingerprint, not a fixture implementation, binds all material fields.
const binding=buildApprovalBinding(boundInput())
for(const altered of [{...payload,reservationLocation:'Changed city'},{...payload,diningContext:{...snapshot,until:'2026-12-18T10:00:00Z'}},{...payload,contextWindows:[]}]){
 assert.throws(()=>assertApprovalBinding(preparation.restaurantReservationApprovalInput({runId:'fixture-run',lifeEventId:'fixture-event',actionId:'fixture-action',...altered,providerUrl:altered.reservationUrl}),binding),/approval_action_changed/)
}
let freshInventory:any=inventory, browserCalls=0, objective='',legacyMode=false
const updates:Array<{table:string;value:any}>=[]
const db={from(table:string){let writing=false;const q:any={select:()=>q,eq:(key:string,value:any)=>{if(key==='telegram_id')assert.equal(String(value),'123');return q},in:()=>q,order:()=>q,limit:()=>q,
 update:(value:any)=>{writing=true;updates.push({table,value});return q},maybeSingle:async()=>({error:null,data:table==='life_event_actions'?{id:'fixture-action',payload_json:legacyMode?{...payload,diningContext:undefined}:payload}:table==='agent_runs'?{id:'fixture-run',metadata_json:{plan_type:'restaurant_reservation_release',life_event_id:'fixture-event',life_event_action_id:'fixture-action'}}:table==='life_events'?{id:'fixture-event',title:'Synthetic Restaurant',timezone:'Asia/Kolkata',location:'Home city',metadata_json:{}}:table==='users'?{id:'fixture-user',telegram_id:123,whatsapp_id:'',name:'Synthetic Owner',timezone:'Asia/Kolkata'}:table==='agent_approvals'?{id:'fixture-approval',run_id:'fixture-run',status:'approved',...(legacyMode?buildApprovalBinding({...boundInput(),payload:{...boundInput().payload,diningContext:undefined,reservationLocation:undefined}}):binding)}:table==='agent_permissions'?{level:'ask'}:null}),
 insert:(value:any)=>{updates.push({table,value});return q},then:(resolve:any)=>resolve({error:null})};return q}}
const actual=load('lib/agent/restaurant-reservation-worker.ts',{
 '@/lib/supabase-admin':{supabaseAdmin:db},'./restaurant-reservation':preparation,'./approval-binding':{assertApprovalBinding},'./reservation-dining-context':dining,
 './context-brain':{buildContextPack:async(input:any)=>{assert.equal(input.actor.legacyTelegramId,123);if(freshInventory instanceof Error)throw freshInventory;return{reservationTravel:freshInventory}}},
 './policy':{evaluateAgentExecutionPolicy:()=>({allowed:true})},'./sentinel':{evaluateAgentSentinel:()=>({allowed:true})},
 './secondary-auth-handoff':{releaseRunAuthHandoff:async()=>{}},
 './secure-computer':{runSecureBrowser:async(input:any)=>{browserCalls++;objective=input.objective;return{status:'completed',pageText:'No available slots',actions:[]}}}
})
const action={id:'fixture-action',telegram_id:'123',life_event_id:'fixture-event',payload_json:payload}
const failures:string[]=[]
for(const [label,fresh]of [['unchanged',inventory],['new travel',{...inventory,facts:[{...travel,location:'Changed city'}]}],['partial',{...inventory,incomplete:true}],['failed',new Error('fixture source failure')]] as const){
 freshInventory=fresh;browserCalls=0;objective='';updates.length=0
 try{
  await actual.processOne(action)
  if(label==='unchanged'){if(browserCalls!==1||!/covered|coverage/i.test(objective)||!objective.includes(snapshot.until))failures.push('unchanged snapshot must pass the actual worker with an explicit dining horizon')}
  else if(browserCalls!==0||!updates.some(row=>row.table==='agent_runs'&&row.value.status==='paused'))failures.push(label+' must pause before provider execution')
 }catch(error){failures.push(label+': '+(error instanceof Error?error.message:String(error)))}
}
assert.deepEqual(failures,[],'Fresh context may not silently change or remove approved restrictions')
legacyMode=true;updates.length=0
const legacyPreparation=load('lib/agent/restaurant-reservation.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'./approval-binding':{assertApprovalBinding},'./reservation-dining-context':dining})
const legacy=await legacyPreparation.armApprovedRestaurantReservation({actor,runId:'fixture-run'})
assert.equal(legacy.status,'paused','Legacy approval lacking dining coverage must enter refreshable review')
assert.ok(updates.some(row=>row.table==='agent_approvals'&&row.value.status==='expired'))
assert.ok(updates.some(row=>row.table==='agent_runs'&&row.value.status==='paused'))
assert.equal(updates.some(row=>row.table==='life_event_actions'&&row.value.status==='ready'),false)
console.log('Actual reservation worker and real approval fingerprint: bounded context, material-change and failed-refresh guards passed. Inert synthetic I/O only.')
