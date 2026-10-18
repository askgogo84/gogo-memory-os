import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import * as timezone from '../lib/timezone'
import * as dining from '../lib/agent/reservation-dining-context'

// Actual preparation/parser/snapshot; all transports are inert and owner-checked.
const epoch=Date.parse('2026-09-27T10:00:00Z')
class Clock extends Date{constructor(value?:any){super(value===undefined?epoch:value)}static now(){return epoch}}
const actor={legacyTelegramId:-123,userId:'fixture-owner',name:'Synthetic Owner'}
const away={source:'travel_presence',kind:'inferred_presence',startAt:'2026-09-27T00:00:00Z',endAt:'2026-10-02T00:00:00Z',location:'New York',participants:['Synthetic Owner'],inferred:true,confidence:.9,sourceRefs:[{type:'travel_ticket',id:'outbound'},{type:'inference',id:'stay'}]}
const returning={source:'travel_ticket',kind:'flight',startAt:'2026-10-02T00:00:00Z',endAt:'2026-10-02T18:00:00Z',location:'New York → Bengaluru',participants:['Synthetic Owner'],inferred:false,confidence:.98,sourceRefs:[{type:'travel_ticket',id:'return'}]}
let facts:any[]=[away,returning],busy:any[]=[],mode='',writes:Array<{table:string;value:any}>=[],contextReads:any[]=[]
const coverage={ownerId:String(actor.legacyTelegramId),incomplete:false,coveredFrom:new Date(epoch).toISOString(),coveredUntil:'2026-11-26T10:00:00Z'}
const db={from(table:string){const q:any={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(String(value),String(actor.legacyTelegramId));return q},in:()=>q,order:()=>q,limit:()=>q,
 maybeSingle:async()=>({data:table==='users'?{timezone:'Asia/Kolkata'}:null,error:null}),upsert:(value:any)=>{assert.equal(String(value.telegram_id),String(actor.legacyTelegramId));writes.push({table,value});return q},insert:(value:any)=>{assert.equal(String(value.telegram_id),String(actor.legacyTelegramId));writes.push({table,value});return q},single:async()=>({data:{id:'fixture-'+table},error:null}),then:(resolve:any)=>resolve({data:[],error:null})};return q}}
const actual:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/restaurant-reservation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:actual,require:(name:string)=>name==='node:crypto'?{createHash}:name==='@/lib/supabase-admin'?{supabaseAdmin:db}:name==='@/lib/timezone'?timezone:name==='./reservation-dining-context'?dining:name==='./secure-computer'?{runSecureBrowser:async(input:any)=>{assert.equal(input.mode,'read');return{status:'completed',pageText:'Sold out. Bookings open every Monday at 8 PM.'}}}:name==='./approval-binding'?{buildApprovalBinding:()=>({})}:name==='./context-brain'?{buildContextPack:async(input:any)=>{
 assert.equal(input.actor.legacyTelegramId,actor.legacyTelegramId);assert.equal(input.options.includeReservationTravel,true);assert.equal(input.options.includeReservationCalendar,true);contextReads.push(input)
 if(mode==='candidateRejected'&&contextReads.length>1)throw Error('synthetic failed context')
 const scope=input.options.reservationCalendarCoverage||coverage
 const c={...coverage,coveredFrom:scope.from||coverage.coveredFrom,coveredUntil:scope.until||coverage.coveredUntil}
 const freshFacts=contextReads.length>1&&mode==='returnTentative'?facts.map(f=>f===returning?{...f,inferred:true,confidence:.45}:f):contextReads.length>1&&mode==='returnDepartureChanged'?facts.map(f=>f===returning?{...f,startAt:'2026-10-03T00:00:00Z'}:f):facts
 return{facts:[],reservationTravel:{...c,facts:freshFacts,incomplete:mode==='candidateIncomplete'&&contextReads.length>1},reservationCalendar:{...c,connected:mode!=='disconnected',windows:busy},reservationPreferences:{ownerId:String(actor.legacyTelegramId),incomplete:mode==='candidatePreferences'&&contextReads.length>1,rules:[]}}
}}:{},Date:Clock,Intl,console,URL,Map,Set})
const request=(text='Book Naru Noodle Bar for 2 at the next available slot between 7 PM and 9 PM.')=>actual.tryRunRestaurantReservation({actor,surface:'dashboard',text})
const failures:string[]=[]
async function check(label:string,fn:()=>Promise<void>){try{await fn();console.log('PASS '+label)}catch(e){failures.push(label+': '+(e instanceof Error?e.message:String(e)))}finally{facts=[away,returning];busy=[];mode='';writes=[];contextReads=[]}}
await check('canonical release during New York itinerary yields a provisional after-return proposal without writes',async()=>{
 const result=await request();assert.equal(result.status,'paused');assert.equal(writes.length,0)
 assert.match(result.text,/New York/);assert.match(result.text,/release/i);assert.match(result.text,/dining/i);assert.match(result.text,/2026-10-03/)
 assert.match(result.text,/19:00.*21:00/);assert.match(result.text,/2 people|party.*2/i);assert.match(result.text,/₹0/)
 assert.match(result.text,/provisional/i);assert.match(result.text,/availability.*not.*verified|not.*availability/i);assert.match(result.text,/duration.*not.*verified|duration.*unverified/i)
 assert.ok(contextReads.some(r=>r.options.reservationCalendarCoverage?.from==='2026-10-02T18:30:00.000Z'),'Proposed local date requires a fresh bounded Calendar/context read')
 assert.doesNotMatch(result.text,/you (?:are|will be) (?:back|in New York)|confirmed return/i)
})
await check('release while away does not reject an explicitly requested clear later dining day',async()=>{
 const r=await request('Book Naru Noodle Bar for 2 on 2026-10-04 between 7 PM and 9 PM.');assert.equal(r.status,'waiting_approval');assert.ok(writes.some(w=>w.table==='agent_approvals'))
})
await check('requested dining window conflicting with saved travel pauses before mission and approval writes',async()=>{
 const r=await request('Book Naru Noodle Bar for 2 on 2026-09-30 between 7 PM and 9 PM.');assert.equal(r.status,'paused');assert.equal(writes.length,0);assert.match(r.text,/saved|itinerary/i);assert.match(r.text,/2026-10-03/)
})
await check('same-city saved hotel does not become an away-trip conflict',async()=>{
 facts=[{...away,source:'life_event',kind:'hotel',location:'Bengaluru'}];assert.equal((await request()).status,'waiting_approval')
})
await check('other traveller and inferred stay end never become an owner return',async()=>{
 facts=[{...away,participants:[]},{...returning,participants:['Different Traveller']}]
 const r=await request();assert.equal(r.status,'paused');assert.equal(writes.length,0);assert.doesNotMatch(r.text,/Provisional.*2026-10-03/i);assert.match(r.text,/clarif|return.*unverified|return.*not.*verified/i)
})
await check('hotel checkout and research dates never substitute for an explicit owner return flight',async()=>{
 for(const fact of [{...away,source:'life_event',kind:'hotel'},{...away,source:'travel_mission',kind:'flight'}]){
  facts=[fact];const r=await request();assert.equal(r.status,'paused');assert.equal(writes.length,0);assert.doesNotMatch(r.text,/Provisional.*2026-10-03/i)
 }
})
await check('busy candidate dates are skipped within bounded fresh checks and original preferred hours',async()=>{
 busy=[{startAt:'2026-10-03T13:30:00Z',endAt:'2026-10-03T15:30:00Z',sourceRefs:[{type:'calendar_event',id:'busy-three'}]}]
 const r=await request();assert.equal(r.status,'paused');assert.match(r.text,/2026-10-04/);assert.match(r.text,/19:00.*21:00/);assert.equal(writes.length,0);assert.ok(contextReads.length<=4)
})
await check('failed incomplete or preference-incomplete candidate reads never claim a compatible proposal',async()=>{
 for(const failure of ['candidateRejected','candidateIncomplete','candidatePreferences']){
  mode=failure;writes=[];contextReads=[];const r=await request();assert.equal(r.status,'paused');assert.equal(writes.length,0);assert.doesNotMatch(r.text,/Provisional planning window/i);assert.match(r.text,/could not verify|not verified|unverified/i)
 }
})
await check('Calendar busy time on a requested dining window pauses before staging authority',async()=>{
 facts=[];busy=[{startAt:'2026-10-04T13:30:00Z',endAt:'2026-10-04T15:30:00Z',sourceRefs:[{type:'calendar_event',id:'requested-busy'}]}]
 const r=await request('Book Naru Noodle Bar for 2 on 2026-10-04 between 7 PM and 9 PM.');assert.equal(r.status,'paused');assert.equal(writes.length,0);assert.match(r.text,/Calendar/)
 assert.match(r.text,/different.*date|different.*time/i);assert.doesNotMatch(r.text,/clarify the traveller|scheduled owner return/i)
})
await check('distinct named travellers are not silently attributed to the owner',async()=>{
 facts=[{...away,participants:['Different Traveller']},{...returning,participants:['Different Traveller']}];assert.equal((await request()).status,'waiting_approval')
})
await check('unknown preferred start window requires clarification rather than invented hours',async()=>{
 const r=await request('Book Naru Noodle Bar for 2 at the next available slot.');assert.equal(r.status,'paused');assert.equal(writes.length,0);assert.doesNotMatch(r.text,/Provisional planning window/i);assert.match(r.text,/time window|preferred.*time/i)
})
await check('unknown arrival disconnected Calendar or unverified return attribution prevents a compatible proposal',async()=>{
 for(const scenario of ['arrival','attribution','disconnected']){
  facts=scenario==='arrival'?[away,{...returning,endAt:null}]:scenario==='attribution'?[away,{...returning,participants:[]}]:[away,returning]
  mode=scenario==='disconnected'?'disconnected':'';writes=[];contextReads=[];const r=await request();assert.equal(r.status,'paused');assert.equal(writes.length,0);assert.doesNotMatch(r.text,/Provisional planning window/i)
 }
})
await check('fresh return evidence must retain its source certainty and valid departure interval',async()=>{
 for(const changed of ['returnTentative','returnDepartureChanged']){
  mode=changed;contextReads=[];writes=[];const r=await request();assert.equal(r.status,'paused');assert.equal(writes.length,0);assert.doesNotMatch(r.text,/Provisional planning window/i,changed)
 }
})
await check('numeric participant identity preserves the sign of an owner identifier',async()=>{
 facts=[away,{...returning,participants:['123']}]
 const r=await request();assert.equal(r.status,'paused');assert.equal(writes.length,0);assert.doesNotMatch(r.text,/Provisional planning window/i,'Positive123 is not owner negative123')
})
await check('the actual approval snapshot also preserves signed participant identities',async()=>{
 const snapshot=dining.buildReservationDiningContext({actor,timezone:'Asia/Kolkata',requestedDate:'2026-10-02',releaseAt:'2026-09-28T14:30:00Z',now:new Date(epoch),pack:{reservationTravel:{...coverage,facts:[{...returning,participants:['123']}]},reservationCalendar:{...coverage,connected:true,windows:[]},reservationPreferences:{ownerId:String(actor.legacyTelegramId),incomplete:false,rules:[]}}})
 assert.equal(snapshot.incomplete,false);assert.equal(snapshot.windows.length,1);assert.equal(snapshot.windows[0].applicability,'unknown','Signed identifiers are exact data, not punctuation-insensitive names')
})
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}else console.log('Reservation conflict/provisional proposal controls passed; inert fixtures, not provider availability or full T12 acceptance.')
