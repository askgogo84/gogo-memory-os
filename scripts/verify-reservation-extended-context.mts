import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import * as redaction from '../lib/bot/memory-redaction'
import * as travelTime from '../lib/services/travel-time'
import {buildReservationDiningContext} from '../lib/agent/reservation-dining-context'
const epoch=Date.parse('2026-10-18T10:00:00Z')
class FixtureDate extends Date{constructor(value?:string|number){super(value===undefined?epoch:value)}static now(){return epoch}}
const reads:string[]=[]
const hotel={id:'synthetic-hotel',telegram_id:'123',event_type:'hotel',subtype:'hotel',title:'Synthetic owner hotel stay',start_at:'2026-10-21T00:00:00Z',end_at:'2026-10-24T00:00:00Z',location:'New York',participants:['Synthetic Owner'],lifecycle_state:'planned',source_refs:[{type:'life_event',id:'synthetic-hotel'}]}
const mission={id:'synthetic-flight',telegram_id:'123',type:'travel_research',status:'queued',metadata_json:{context:{kind:'flight',origin:{label:'Bengaluru'},destination:{label:'New York'},startDate:'2026-10-21',returnDate:'2026-10-24',roundTrip:true}},updated_at:'2026-10-18T09:00:00Z'}
const preference={id:'synthetic-rule',telegram_id:123,rule_text:'Only vegetarian restaurants',created_at:'2026-10-18T09:00:00Z'}
const db={from(table:string){reads.push(table);const filters:Array<(row:any)=>boolean>=[];const execute=()=>({error:null,data:(table==='life_events'?[hotel]:table==='agent_runs'?[mission]:table==='user_preferences'?[preference]:[]).filter(row=>filters.every(fn=>fn(row)))})
 const q:any={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(String(value),'123');filters.push(row=>String(row[key])===String(value));return q},in:(key:string,values:unknown[])=>{filters.push(row=>values.includes(row[key]));return q},order:()=>q,limit:()=>q,or:()=>q,maybeSingle:async()=>({data:{memory_enabled:false,gmail_enabled:false},error:null}),then:(resolve:any)=>resolve(execute())};return q
}}
const actual:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/context-brain.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:actual,require:(name:string)=>name==='node:crypto'?{createHash}:name==='@/lib/supabase-admin'?{supabaseAdmin:db}:name==='./typed-object-context'?{latestTypedContext:async()=>null}:name==='@/lib/bot/memory-redaction'?redaction:name==='@/lib/services/travel-time'?travelTime:{},Date:FixtureDate,Intl,console,Set,Map})
const actor={legacyTelegramId:123,userId:'synthetic-owner',name:'Synthetic Owner'}
const read=(includeReservationTravel=true)=>actual.buildContextPack({actor,text:'Restaurant dining context',options:{includeSemantic:false,includeReservationTravel,maxFacts:4,horizonDays:60}})
const failures:string[]=[]
async function check(label:string,fn:()=>Promise<void>){try{await fn();console.log('PASS '+label)}catch(error){failures.push(label+': '+(error instanceof Error?error.message:String(error)))}}
await check('actual producer retains owner hotel stays in the complete pre-ranking safety inventory',async()=>{
 const pack=await read();assert.ok(pack.facts.some((f:any)=>f.id==='life-event:synthetic-hotel'),'positive control: conversational fact exists')
 assert.ok(pack.reservationTravel.facts.some((f:any)=>f.id==='life-event:synthetic-hotel'),'hotel safety restriction must not disappear')
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
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}else console.log('Extended reservation inventory/snapshot controls passed; inert fixtures, not full T12 or live acceptance.')
