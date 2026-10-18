import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import * as redaction from '../lib/bot/memory-redaction'

const now=Date.parse('2026-10-18T10:00:00Z')
class FixtureDate extends Date {constructor(value?:any){super(value===undefined?now:value)}static now(){return now}}
let count=20,failed=false
const db={from(table:string){const q:any={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(String(value),'123');return q},order:()=>q,limit:()=>q,in:()=>q,or:()=>q,
 maybeSingle:async()=>({data:{memory_enabled:false,gmail_enabled:false},error:null}),
 then:(resolve:any)=>resolve({error:table==='life_events'&&failed?{message:'synthetic read failure'}:null,data:table==='life_events'?Array.from({length:count},(_,i)=>({id:'fixture-'+i,event_type:'flight',subtype:'flight',title:'Synthetic flight '+i,start_at:'2026-10-21T00:00:00Z',end_at:'2026-10-24T00:00:00Z',location:'City '+i,participants:['Synthetic Owner'],lifecycle_state:'planned',source_refs:[]})):[]})};return q}}
const actual:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/context-brain.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports:actual,require:(name:string)=>name==='node:crypto'?{createHash}:name==='@/lib/supabase-admin'?{supabaseAdmin:db}:name==='./typed-object-context'?{latestTypedContext:async()=>null}:name==='@/lib/bot/memory-redaction'?redaction:{},Date:FixtureDate,Intl,console,Set,Map})
const read=()=>actual.buildContextPack({actor:{legacyTelegramId:123,userId:'fixture-user',name:'Synthetic Owner'},text:'Restaurant dining context',options:{includeSemantic:false,maxFacts:4,horizonDays:60}})
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
console.log('Actual context producer retains owner-scoped travel before ranking and exposes source caps/failures; inert database only.')
