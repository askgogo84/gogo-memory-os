// TEST ONLY — EXPECTED SECURITY RED on current deployed life-graph source.
// Executes the original TypeScript module in an isolated VM; every DB/IO dependency
// is a synthetic, in-memory fixture. No network, real users, tokens, providers or files
// are accessed beyond reading the checked-out repository source.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

const OWNER_A='9007199254740992'
const OWNER_B='9007199254740993'
const SAFE='123456789'
const START='2026-11-01T07:00:00.000Z'
const END='2026-11-01T11:00:00.000Z'
const NOW=new Date('2026-10-30T10:00:00.000Z')
assert.equal(Number(OWNER_A),Number(OWNER_B),'fixture requires unsafe JS 64-bit alias')

type RecordRow=Record<string,unknown>
const event=(owner:string,key:string):RecordRow=>({
  id:'EVENT_'+key,telegram_id:owner,event_type:'travel',subtype:'flight',
  title:'Flight '+key,provider:'synthetic',start_at:START,end_at:END,
  location:'Bengaluru → Mumbai',confirmation_ref:null,lifecycle_state:'active',metadata_json:{},
})
const ticket=(owner:string,key:string):RecordRow=>({
  id:'TICKET_'+key,telegram_id:owner,type:'flight',
  airline:'Synthetic '+key,flight_no:key+'-100',from_city:'Bengaluru',to_city:'Mumbai',
  depart_at:START,arrive_at:END,pnr:null,
})
const document=(owner:string,key:string):RecordRow=>({
  id:'DOC_'+key,telegram_id:owner,doc_type:'passport',title:'Private passport '+key,
  extracted:{userLabel:'Holder '+key,fields:{name:'Holder '+key}},
  expires_on:'2031-01-02',created_at:'2026-10-29T12:00:00.000Z',
})

type QueryRecord={table:string;column:string;value:unknown}
function fixture(rows: {events?:RecordRow[];tickets?:RecordRow[];documents?:RecordRow[]}={}) {
  const calls:QueryRecord[]=[]
  const tables:Record<string,RecordRow[]>={
    life_events:rows.events||[],travel_tickets:rows.tickets||[],documents:rows.documents||[],
  }
  const fakeAdmin={
    from(table:string){
      if(!Object.prototype.hasOwnProperty.call(tables,table)) throw Error('BLOCKED external table '+table)
      const clauses:Array<{column:string;value:unknown;kind:string}>=[]
      const q={
        select(_columns:string){return this},
        eq(column:string,value:unknown){
          calls.push({table,column,value});clauses.push({column,value,kind:'eq'});return this
        },
        in(column:string,value:unknown[]){
          clauses.push({column,value,kind:'in'});return this
        },
        not(_column:string,_operator:string,_value:string){return this},
        or(_text:string){return this},
        gte(_column:string,_value:string){return this},
        lte(_column:string,_value:string){return this},
        order(_column:string,_opts:unknown){return this},
        limit(_n:number){return this},
        then(ok:(result:{data:RecordRow[];error:null})=>unknown,fail?:(error:unknown)=>unknown){
          const selected=tables[table].filter(row=>clauses.every(c=>{
            if(c.kind==='eq')return String(row[c.column])===String(c.value)
            if(c.kind==='in')return (c.value as unknown[]).some(v=>String(v)===String(row[c.column]))
            return true
          }))
          return Promise.resolve({data:selected,error:null}).then(ok,fail)
        },
      }
      return q
    },
  }
  const source=readFileSync('lib/memory/life-graph.ts','utf8')
  const compiled=ts.transpileModule(source,{
    fileName:'lib/memory/life-graph.ts',reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  })
  const errors=(compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
  assert.equal(errors.length,0,'original deployed source must transpile')
  const mod={exports:{} as Record<string,any>}
  const deps:Record<string,unknown>={
    '@/lib/supabase-admin':{supabaseAdmin:fakeAdmin},
    './names':{labelNameMismatch:()=>false},
  }
  const sandbox={
    module:mod,exports:mod.exports,Date,Intl,URL,console,Promise,setTimeout,clearTimeout,
    process:{env:{}},
    fetch(){throw Error('BLOCKED external network')},
    require(name:string){
      if(!Object.prototype.hasOwnProperty.call(deps,name))throw Error('BLOCKED external import '+name)
      return deps[name]
    },
  }
  runInNewContext(compiled.outputText,sandbox,{filename:'lib/memory/life-graph.ts',timeout:2000})
  assert.equal(typeof mod.exports.loadTrips,'function')
  assert.equal(typeof mod.exports.loadTravelDocs,'function')
  assert.equal(typeof mod.exports.travelDocLines,'function')
  return {api:mod.exports,calls}
}
const both=()=>fixture({
  events:[event(OWNER_A,'A'),event(OWNER_B,'B')],
  tickets:[ticket(OWNER_A,'A'),ticket(OWNER_B,'B')],
  documents:[document(OWNER_A,'A'),document(OWNER_B,'B')],
})
function items(trips:any[]):any[]{return trips.flatMap(t=>t.items||[])}
function has(items:any[],fragment:string){return items.some(x=>String(x.id||x.holder||'').includes(fragment))}
let controls=0,securityPass=0,securityFail=0
async function control(label:string,fn:()=>Promise<void>){
  await fn();controls++;console.log('PASS CONTROL: '+label)
}
async function safety(label:string,fn:()=>Promise<void>){
  try{await fn();securityPass++;console.log('PASS SAFETY: '+label)}
  catch(err:any){securityFail++;console.error('FAIL SAFETY (expected until corrected): '+label+': '+String(err?.message||err))}
}
await control('safe integer owner receives only its own passport details',async()=>{
  const h=fixture({documents:[document(SAFE,'SAFE'),document(OWNER_A,'A')]})
  const docs=await h.api.loadTravelDocs(SAFE,NOW.getTime())
  assert.equal(docs.length,1);assert.equal(docs[0].holder,'Holder SAFE')
  assert.ok(h.calls.some(c=>c.table==='documents'&&c.column==='telegram_id'&&String(c.value)===SAFE))
})
await control('safe integer owner sees its own fallback travel ticket',async()=>{
  const h=fixture({events:[event(SAFE,'SAFE')],tickets:[ticket(SAFE,'SAFE')]})
  const tripItems=items(await h.api.loadTrips(SAFE,NOW))
  assert.ok(has(tripItems,'EVENT_SAFE'));assert.ok(has(tripItems,'TICKET_SAFE'))
})
await control('owner B primary life-events predicate already preserves exact identity',async()=>{
  const h=both()
  const tripItems=items(await h.api.loadTrips(OWNER_B,NOW))
  assert.ok(has(tripItems,'EVENT_B'),'B primary event must remain in B trip')
  assert.ok(!has(tripItems,'EVENT_A'),'exact life event predicate excludes A')
  assert.ok(h.calls.some(c=>c.table==='life_events'&&c.column==='telegram_id'&&String(c.value)===OWNER_B))
})
await control('absent safe owner has neither document nor itinerary data',async()=>{
  const h=both()
  assert.equal((await h.api.loadTravelDocs(SAFE,NOW.getTime())).length,0)
  assert.equal((await h.api.loadTrips(SAFE,NOW)).length,0)
})
await safety('P1 owner B travel document read must never select owner A passport',async()=>{
  const h=both()
  const docs=await h.api.loadTravelDocs(OWNER_B,NOW.getTime())
  assert.ok(!has(docs,'Holder A'),'owner B read A private passport holder')
})
await safety('P1 owner B must retain its own passport holder and expiry',async()=>{
  const h=both()
  const docs=await h.api.loadTravelDocs(OWNER_B,NOW.getTime())
  assert.ok(has(docs,'Holder B'),'owner B passport details were replaced by owner A')
})
await safety('P1 owner B trip must not include owner A fallback ticket',async()=>{
  const h=both()
  const tripItems=items(await h.api.loadTrips(OWNER_B,NOW))
  assert.ok(!has(tripItems,'TICKET_A'),'owner A ticket entered owner B linked trip')
})
await safety('P1 owner B trip must retain owner B fallback ticket',async()=>{
  const h=both()
  const tripItems=items(await h.api.loadTrips(OWNER_B,NOW))
  assert.ok(has(tripItems,'TICKET_B'),'owner B ticket excluded by rounded predicate')
})
await safety('P1 owner B synthesized travel document lines must not disclose owner A holder',async()=>{
  const h=both()
  const trips=await h.api.loadTrips(OWNER_B,NOW)
  const docs=await h.api.loadTravelDocs(OWNER_B,NOW.getTime())
  const lines=h.api.travelDocLines(docs,trips)
  assert.ok(!lines.join(' ').includes('Holder A'),'another owner passport holder entered synthesized trip text')
})
console.log('CONTROLS='+controls+' SAFETY_PASS='+securityPass+' SAFETY_FAIL='+securityFail)
if(securityFail)process.exitCode=1
