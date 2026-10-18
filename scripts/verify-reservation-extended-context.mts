import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import * as redaction from '../lib/bot/memory-redaction'
import * as travelTime from '../lib/services/travel-time'
import * as calendarIntervals from '../lib/calendar-intervals'
import {buildReservationDiningContext,usableReservationDiningContext,sameReservationRestrictions} from '../lib/agent/reservation-dining-context'
import {buildApprovalBinding,assertApprovalBinding} from '../lib/agent/approval-binding'
const epoch=Date.parse('2026-10-18T10:00:00Z')
class FixtureDate extends Date{constructor(value?:string|number){super(value===undefined?epoch:value)}static now(){return epoch}}
const reads:string[]=[]
const hotel={id:'synthetic-hotel',telegram_id:'123',event_type:'hotel',subtype:'hotel',title:'Synthetic owner hotel stay',start_at:'2026-10-21T00:00:00Z',end_at:'2026-10-24T00:00:00Z',location:'New York',participants:['Synthetic Owner'],lifecycle_state:'planned',source_refs:[{type:'life_event',id:'synthetic-hotel'}]}
const mission={id:'synthetic-flight',telegram_id:'123',type:'travel_research',status:'queued',metadata_json:{context:{kind:'flight',origin:{label:'Bengaluru'},destination:{label:'New York'},startDate:'2026-10-21',returnDate:'2026-10-24',roundTrip:true}},updated_at:'2026-10-18T09:00:00Z'}
const preference={id:'synthetic-rule',telegram_id:123,rule_text:'Only vegetarian restaurants',created_at:'2026-10-18T09:00:00Z'}
let missions:any[]=[mission],preferences:any[]=[preference],faultTable='',missionCap=false,preferenceCap=false
const db={from(table:string){reads.push(table);let fields='';const filters:Array<(row:any)=>boolean>=[];const execute=()=>{
 const source=table==='life_events'?[hotel]:table==='agent_runs'?(missionCap?Array.from({length:81},(_,i)=>({...mission,id:'mission-'+i})):missions):table==='user_preferences'?(preferenceCap?Array.from({length:21},(_,i)=>({...preference,id:'rule-'+i})):preferences):[]
 const data=source.filter(row=>filters.every(fn=>fn(row))).map(row=>{if(table!=='agent_runs'||!fields.includes(':'))return row;const selected:any={};for(const field of fields.split(',')){const [alias,query]=field.split(':');if(!query)selected[alias]=row[alias];else selected[alias]=query.split(/->>?/).reduce((value:any,key:string)=>value?.[key],row)}return selected})
 return{error:faultTable===table?{message:'Synthetic source unavailable'}:null,data:faultTable===table?null:data}
 }
 const q:any={select:(value:string)=>{fields=value;if(table==='agent_runs')assert.ok(!/objective|travellers|dob|credential|handoff/i.test(value),'select only minimal mission context');return q},eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(String(value),'123');filters.push(row=>String(row[key])===String(value));return q},in:(key:string,values:unknown[])=>{filters.push(row=>values.includes(row[key]));return q},not:(key:string,_op:string,_value:unknown)=>{filters.push(row=>key.split(/->>?/).reduce((value:any,part:string)=>value?.[part],row)!=null);return q},order:()=>q,limit:()=>q,or:()=>q,maybeSingle:async()=>({data:{memory_enabled:false,gmail_enabled:false},error:null}),then:(resolve:any)=>resolve(execute())};return q
}}
const actual:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/context-brain.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:actual,require:(name:string)=>name==='node:crypto'?{createHash}:name==='@/lib/supabase-admin'?{supabaseAdmin:db}:name==='./typed-object-context'?{latestTypedContext:async()=>null}:name==='@/lib/bot/memory-redaction'?redaction:name==='@/lib/services/travel-time'?travelTime:name==='../calendar-intervals'?calendarIntervals:{},Date:FixtureDate,Intl,console,Set,Map})
const actor={legacyTelegramId:123,userId:'synthetic-owner',name:'Synthetic Owner'}
const read=(includeReservationTravel=true)=>actual.buildContextPack({actor,text:'Restaurant dining context',options:{includeSemantic:false,includeReservationTravel,maxFacts:4,horizonDays:60}})
const coverage={ownerId:'123',coveredFrom:new Date(epoch).toISOString(),coveredUntil:'2026-12-01T10:00:00Z',incomplete:false}
const emptyPreferences={ownerId:'123',incomplete:false,rules:[]}
const snapshotFor=(rules:any[]=[],facts:any[]=[])=>buildReservationDiningContext({actor,timezone:'Asia/Kolkata',requestedDate:'2026-10-22',releaseAt:'2026-10-19T14:30:00Z',now:new Date(epoch),pack:{reservationTravel:{...coverage,facts},reservationCalendar:{...coverage,connected:true,windows:[]},reservationPreferences:{...emptyPreferences,rules}} as any})
const failures:string[]=[]
async function check(label:string,fn:()=>Promise<void>){try{await fn();console.log('PASS '+label)}catch(error){failures.push(label+': '+(error instanceof Error?error.message:String(error)))}finally{missions=[mission];preferences=[preference];faultTable='';missionCap=false;preferenceCap=false}}
await check('actual producer retains owner hotel stays in the complete pre-ranking safety inventory',async()=>{
 const pack=await read();assert.ok(pack.facts.some((f:any)=>f.id==='life-event:synthetic-hotel'),'positive control: conversational fact exists')
 assert.ok(pack.reservationTravel.facts.some((f:any)=>f.id==='life-event:synthetic-hotel'),'hotel safety restriction must not disappear')
 const saved=pack.reservationTravel.facts.find((f:any)=>f.id==='life-event:synthetic-hotel')
 assert.equal(saved.inferred,true,'a planned hotel record is not provider verification of a booking or presence')
 assert.match(saved.summary,/not.*verified|not.*booking/i)
})
await check('actual approval snapshot retains a supplied owner hotel restriction',async()=>{
 const coverage={ownerId:'123',coveredFrom:new Date(epoch).toISOString(),coveredUntil:'2026-12-01T10:00:00Z',incomplete:false}
 const snapshot=buildReservationDiningContext({actor,timezone:'Asia/Kolkata',requestedDate:'2026-10-22',releaseAt:'2026-10-19T14:30:00Z',now:new Date(epoch),pack:{reservationTravel:{...coverage,facts:[{source:'life_event',kind:'hotel',participants:['Synthetic Owner'],startAt:hotel.start_at,endAt:hotel.end_at,location:hotel.location,confidence:1,inferred:false,sourceRefs:hotel.source_refs}]},reservationCalendar:{...coverage,connected:true,windows:[]}}})
 assert.equal(snapshot.windows.length,1,'complete hotel evidence must survive actual snapshot selection')
})
await check('active travel mission intent is retrieved without claiming a verified booking',async()=>{
 reads.length=0;const pack=await read();assert.ok(reads.includes('agent_runs'),'active mission source must be checked')
 const fact=pack.reservationTravel.facts.find((f:any)=>f.sourceRefs?.some((ref:any)=>ref.type==='agent_run'&&ref.id===mission.id))
 assert.ok(fact,'active dated travel intent must reach bounded constraints');assert.equal(fact.inferred,true,'research intent does not verify a booking or presence')
})
await check('explicit saved preferences are retrieved with their owner-bound provenance',async()=>{
 reads.length=0;const pack=await read();assert.ok(reads.includes('user_preferences'),'explicit rules must be read before proposal')
 assert.equal(pack.reservationPreferences?.ownerId,'123');assert.equal(pack.reservationPreferences?.incomplete,false)
 assert.ok(pack.reservationPreferences?.rules.some((r:any)=>r.id===preference.id&&r.text===preference.rule_text),'preserve explicit rule and source identity')
})
await check('ordinary conversational context does not add dedicated reservation source reads',async()=>{
 reads.length=0;const pack=await read(false);assert.equal(pack.reservationTravel,undefined);assert.equal(pack.reservationPreferences,undefined)
 assert.equal(reads.includes('agent_runs'),false);assert.equal(reads.includes('user_preferences'),false)
})
await check('mission and preference failures and row caps stay incomplete rather than a clear inventory',async()=>{
 for(const table of ['agent_runs','user_preferences']){
  faultTable=table;const pack=await read();assert.equal(table==='agent_runs'?pack.reservationTravel.incomplete:pack.reservationPreferences?.incomplete,true,table+' failure must remain unknown')
 }
 faultTable='';missionCap=true;assert.equal((await read()).reservationTravel.incomplete,true);missionCap=false
 preferenceCap=true;assert.equal((await read()).reservationPreferences?.incomplete,true);preferenceCap=false
})
await check('malformed and one-way active intent cannot certify complete travel coverage',async()=>{
 for(const context of [{...mission.metadata_json.context,startDate:'2026-02-30'},{kind:'flight',destination:{label:'New York'},startDate:'2026-10-21'}]){
  missions=[{...mission,metadata_json:{context}}];assert.equal((await read()).reservationTravel.incomplete,true)
 }
 missions=[mission]
})
await check('other-owner and terminal missions do not enter the active owner restrictions',async()=>{
 missions=[{...mission,telegram_id:'456',id:'other-owner'},{...mission,status:'cancelled',id:'terminal'},{...mission,status:'stopped',id:'stopped'}]
 const pack=await read();assert.ok(reads.includes('agent_runs'));assert.equal(pack.reservationTravel.facts.some((f:any)=>f.source==='travel_mission'),false)
 missions=[mission]
})
await check('preference lookup keeps secret-shaped text out and exposes incomplete enforcement',async()=>{
 preferences=[{...preference,rule_text:'My password is fixture-secret-value'}]
 const pack=await read();assert.equal(pack.reservationPreferences?.incomplete,true);assert.ok(!JSON.stringify(pack.reservationPreferences).includes('fixture-secret-value'))
 preferences=[preference]
})
await check('new version snapshot binds explicit preferences and rejects older or missing coverage',async()=>{
 const first=snapshotFor([{id:preference.id,text:preference.rule_text}])
 assert.equal(first.version,3);assert.equal(usableReservationDiningContext(first),true)
 assert.equal(usableReservationDiningContext({...first,version:2}),false)
 assert.equal(usableReservationDiningContext({...first,preferences:undefined}),false)
 const changed=snapshotFor([{id:preference.id,text:'Quiet indoor seating only'}])
 assert.equal(sameReservationRestrictions(first,changed,new Date(epoch)),false,'fresh constraints may not silently change an approved rule')
 const input=(context:unknown)=>({missionId:'mission',stepId:'action',capability:'browser',actionType:'booking',target:'https://provider.example',payload:{diningContext:context}})
 assert.throws(()=>assertApprovalBinding(input(changed),buildApprovalBinding(input(first))),/approval_action_changed/)
})
await check('later one-way intent does not fabricate uncertainty for an earlier bounded dining date',async()=>{
 missions=[{...mission,metadata_json:{context:{kind:'flight',destination:{label:'New York'},startDate:'2026-10-21'}}}]
 const span={from:'2026-10-18T18:30:00Z',until:'2026-10-19T18:30:00Z'}
 const pack=await actual.buildContextPack({actor,text:'Restaurant dining on 19 October',options:{includeSemantic:false,includeReservationTravel:true,reservationCalendarCoverage:span,maxFacts:4,horizonDays:60}})
 assert.equal(pack.reservationTravel.incomplete,false,'known departure after the whole dining day cannot make that earlier scope unknown')
 assert.equal(Date.parse(pack.reservationTravel.coveredFrom),Date.parse(span.from));assert.equal(Date.parse(pack.reservationTravel.coveredUntil),Date.parse(span.until),'complete inventory must advertise only the scope actually checked')
 assert.equal(pack.reservationTravel.facts.some((f:any)=>f.source==='travel_mission'),false)
})
await check('completed research with future dates stays tentative while finished past travel is excluded',async()=>{
 // Canonical source audit: job completion is not completion of the dated trip.
 missions=[{...mission,id:'finished-search',status:'completed'},{...mission,id:'old-search',status:'completed',metadata_json:{context:{...mission.metadata_json.context,startDate:'2026-09-01',returnDate:'2026-09-05'}}},{...mission,id:'undated-old-job',status:'completed',metadata_json:{}}]
 const pack=await read();assert.ok(pack.reservationTravel.facts.some((f:any)=>f.id==='travel-mission:finished-search'&&f.inferred===true))
 assert.equal(pack.reservationTravel.facts.some((f:any)=>f.id==='travel-mission:old-search'),false)
 assert.equal(pack.reservationTravel.incomplete,false,'an undated old terminal job is not evidence of an active unknown trip')
})
await check('failed future research is unresolved intent, never cancellation or a successful booking',async()=>{
 missions=[{...mission,id:'failed-search',status:'failed'}]
 const pack=await read();const fact=pack.reservationTravel.facts.find((f:any)=>f.id==='travel-mission:failed-search')
 assert.ok(fact,'a failed search is not revocation of its dated future travel intent');assert.equal(fact.inferred,true);assert.match(fact.summary,/failed/);assert.match(fact.summary,/not.*verified/)
})
await check('minimal structured flight booking intent is read without traveller or objective fields',async()=>{
 missions=[{id:'flight-booking',telegram_id:'123',type:'secure_browser',status:'paused',metadata_json:{objective:'PRIVATE OBJECTIVE',flight_booking:{route:'BLR-JFK',depart:'2026-10-21',return:'2026-10-24',travellers:2,private_dob:'PRIVATE DOB'}}},{id:'unrelated-browser',telegram_id:'123',type:'secure_browser',status:'paused',metadata_json:{objective:'PRIVATE UNRELATED'}}]
 const pack=await read();const fact=pack.reservationTravel.facts.find((f:any)=>f.id==='travel-mission:flight-booking')
 assert.ok(fact);assert.equal(fact.inferred,true);assert.equal(pack.reservationTravel.incomplete,false);assert.doesNotMatch(JSON.stringify(pack.reservationTravel),/PRIVATE/)
 assert.equal(pack.reservationTravel.facts.some((f:any)=>f.id==='travel-mission:unrelated-browser'),false)
})
await check('actual one-way research departure search end never becomes a return date',async()=>{
 const research:any={}
 runInNewContext(ts.transpileModule(readFileSync('lib/agent/travel-research.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:research,require:()=>({}),Date:FixtureDate,Intl,console,Set,Map})
 const context=research.buildTravelResearchContext('Find one-way flights from Bengaluru to New York on 21 October 2026',new Date(epoch),'Asia/Kolkata')
 assert.equal(context.startDate,'2026-10-21');assert.equal(context.endDate,'2026-10-21');assert.equal(context.returnDate,undefined)
 for(const status of ['queued','completed','failed']){
  missions=[{...mission,status,metadata_json:{context}}]
  const span={from:'2026-10-24T18:30:00Z',until:'2026-10-25T18:30:00Z'}
  const pack=await actual.buildContextPack({actor,text:'Restaurant dining on 25 October',options:{includeSemantic:false,includeReservationTravel:true,reservationCalendarCoverage:span,maxFacts:4,horizonDays:60}})
  assert.equal(pack.reservationTravel.incomplete,true,status+': a departure search horizon is not evidence of return')
 }
 missions=[{...mission,status:'completed',metadata_json:{context:{...context,startDate:'2026-10-10',endDate:'2026-10-10'}}}]
 assert.equal((await read()).reservationTravel.incomplete,true,'An older completed one-way search does not prove the traveller has returned')
})
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}else console.log('Extended reservation inventory/snapshot controls passed; inert fixtures, not full T12 or live acceptance.')
