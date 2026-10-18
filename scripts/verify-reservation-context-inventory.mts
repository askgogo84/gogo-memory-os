import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import * as redaction from '../lib/bot/memory-redaction'
import * as travelTime from '../lib/services/travel-time'

const now=Date.parse('2026-10-18T10:00:00Z')
class FixtureDate extends Date {constructor(value?:any){super(value===undefined?now:value)}static now(){return now}}
let count=20,failed=false,tickets:any[]=[],ticketFilters:string[]=[]
const db={from(table:string){let filter='';const q:any={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(String(value),'123');return q},order:()=>q,limit:()=>q,in:()=>q,or:(value:string)=>{filter=value;if(table==='travel_tickets')ticketFilters.push(value);return q},
 maybeSingle:async()=>({data:{memory_enabled:false,gmail_enabled:false},error:null}),
 then:(resolve:any)=>resolve({error:table==='life_events'&&failed?{message:'synthetic read failure'}:null,data:table==='life_events'?Array.from({length:count},(_,i)=>({id:'fixture-'+i,event_type:'flight',subtype:'flight',title:'Synthetic flight '+i,start_at:'2026-10-21T00:00:00Z',end_at:'2026-10-24T00:00:00Z',location:'City '+i,participants:['Synthetic Owner'],lifecycle_state:'planned',source_refs:[]})):table==='travel_tickets'?tickets.filter(row=>{const lower=filter.match(/depart_at.gte.([^,]+)/)?.[1];return !row.depart_at||!lower||Date.parse(row.depart_at)>=Date.parse(lower)}):[]})};return q}}
const actual:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/context-brain.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports:actual,require:(name:string)=>name==='node:crypto'?{createHash}:name==='@/lib/supabase-admin'?{supabaseAdmin:db}:name==='./typed-object-context'?{latestTypedContext:async()=>null}:name==='@/lib/bot/memory-redaction'?redaction:name==='@/lib/services/travel-time'?travelTime:{},Date:FixtureDate,Intl,console,Set,Map})
const read=(includeReservationTravel=true)=>actual.buildContextPack({actor:{legacyTelegramId:123,userId:'fixture-user',name:'Synthetic Owner'},text:'Restaurant dining context',options:{includeSemantic:false,includeReservationTravel,maxFacts:4,horizonDays:60}})
const complete=await read()
assert.equal(complete.facts.length,4)
assert.equal(complete.reservationTravel.facts.length,20,'Travel safety inventory precedes the conversational ranking cap')
assert.equal(complete.reservationTravel.ownerId,'123')
assert.equal(complete.reservationTravel.incomplete,false)
assert.equal(complete.reservationTravel.facts[0].participants[0],'Synthetic Owner')
count=80
assert.equal((await read()).reservationTravel.incomplete,true,'Source row cap must remain visible')
count=0;failed=true
assert.equal((await read()).reservationTravel.incomplete,true,'Failed travel source cannot be a complete empty inventory')
failed=false;ticketFilters=[]
tickets=[{id:'outbound',type:'flight',booking_group:'synthetic-trip',from_city:'Bengaluru',to_city:'Delhi',depart_at:'2026-10-10T00:00:00Z',arrive_at:'2026-10-10T03:00:00Z',passengers:['Synthetic Owner'],raw:{timeNormalizationVersion:2}},
 {id:'return',type:'flight',booking_group:'synthetic-trip',from_city:'Delhi',to_city:'Bengaluru',depart_at:'2026-10-30T00:00:00Z',arrive_at:'2026-10-30T03:00:00Z',passengers:['Synthetic Owner'],raw:{timeNormalizationVersion:2}}]
const ongoing=await read()
assert(ticketFilters.some(filter=>filter.includes('depart_at.lte.')&&!filter.includes('depart_at.gte.')),'Reservation inventory needs a separate bounded query without a departure lookback')
assert(ongoing.reservationTravel.facts.some((fact:any)=>fact.source==='travel_presence'&&Date.parse(fact.startAt)<now&&Date.parse(fact.endAt)>Date.parse('2026-10-20T12:00:00Z')),'Older outbound plus future return must retain the ongoing away stay')
assert.equal(ongoing.reservationTravel.incomplete,false)
tickets=[{id:'unverified-flight',type:'flight',depart_at:null,arrive_at:null,raw:{}}]
assert.equal((await read()).reservationTravel.incomplete,true,'An unrepresented flight with unknown dates cannot prove clear coverage')
ticketFilters=[]
assert.equal((await read(false)).reservationTravel,undefined,'Ordinary context must not request the dedicated reservation inventory')
assert.equal(ticketFilters.length,1,'Ordinary context keeps its existing single ticket query')
console.log('Actual context producer retains owner-scoped travel before ranking and exposes source caps/failures; inert database only.')
