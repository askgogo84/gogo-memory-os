// TEST ONLY. Execute ORIGINAL compileForUser (unchanged source AST) in a sealed VM.
// All rows/phones/watchers/providers are fictional. No live imports or network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const SRC = 'lib/agent/contextual-travel-watchers.ts'
const source = readFileSync(SRC, 'utf8')
const ast = ts.createSourceFile(SRC, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const names = ['exactTravelOwner', 'requireTravelOwner', 'travelRowsBelongToOwner', 'compileForUser']
const declarations = names.map(name => {
  const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name)
  assert.ok(fn, 'must execute actual unchanged original source function '+name)
  return fn.getText(ast)
}).join('\n')
const js = ts.transpileModule(declarations + '\nexports.compileForUser = compileForUser;', {
  fileName: SRC, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const A = '9007199254740992', B = '9007199254740993'
assert.equal(Number(A), Number(B), 'fixture requires JavaScript 64-bit identity alias')
const SAFE = '42'
const trip = owner => ({ id: 'FICTIONAL-LEG-'+owner, telegram_id: owner, booking_group: null,
  leg_index: 1, from_city: 'Fictional Departure', to_city: 'Fictional Arrival',
  depart_at: '2026-11-06T06:00:00.000Z', arrive_at: '2026-11-06T08:00:00.000Z',
  airline: 'Fictional Air', flight_no: 'ZZ123', passengers: [], raw: {} })
const user = (telegram_id,name,gmail_connected) => ({ telegram_id,name,gmail_connected })
const memory = (telegram_id,content) => ({ id:'fictional-'+telegram_id,telegram_id,content })

function harness({owner=SAFE,ticketOwner=owner,users=[],memories=[],failProfile=false,foreignProfile=null}={}) {
  const reads=[], proposed=[], homeCities=[], readProfiles=[]
  const tables={ users, memories, agent_watchers:[] }
  const db={
    from(table){
      if(!['users','memories','agent_watchers','agent_activity'].includes(table))throw Error('Unmocked external table '+table)
      const equals=[],ins=[]
      const query={
        select(){return this},
        eq(col,value){reads.push({table,col,value});equals.push({col,value});return this},
        in(col,values){ins.push({col,values});return this},
        or(){return this},order(){return this},limit(){return this},
        then(done,fail){return Promise.resolve({data:matching(),error:null}).then(done,fail)},
        async maybeSingle(){
          if(failProfile&&table==='users')return {data:null,error:{message:'synthetic blocked profile read'}}
          const selected=table==='users'&&foreignProfile?foreignProfile:(matching()[0]??null)
          if(table==='users')readProfiles.push(selected)
          return {data:selected,error:null}
        },
        insert(record){
          if(table!=='agent_activity')throw Error('Unmocked external write '+table)
          assert.equal(record.telegram_id,owner,'activity writes must use original owner identity')
          return {then(ok,fail){return Promise.resolve({error:null}).then(ok,fail)}}
        },
      }
      function matching(){
        return (tables[table]??[]).filter(row=>
          equals.every(({col,value}) => String(row[col])===String(value)) &&
          ins.every(({col,values})=>values.some(value=>String(row[col])===String(value))))
      }
      return query
    },
  }
  const mod={exports:{}}
  const context={
    exports:mod.exports, module:mod, console, Date, Promise, String, Number, BigInt, Math, Set,
    Object, Array, Map, JSON, Boolean,
    supabaseAdmin:db,
    nearestRetainedTrip:rows=>rows[0], rootFor:()=> 'travel:fictional',
    tripExpiry:()=> '2026-11-10T12:00:00.000Z', sourceRefs:rows=>rows.map(row=>({type:'travel_ticket',id:row.id})),
    getCostBudget:async()=>({activeWebWatchersMax:4}),
    declaredHomeCity:rows=>String(rows[0]?.content??'').replace(/^home city:\s*/i,''),
    desiredWebConditions:(_rows,_root,_expiry,homeCity)=>{homeCities.push(homeCity);return []},
    routeLabel:()=> 'Fictional Departure → Fictional Arrival',
    clean:(value,max=160)=>String(value??'').trim().slice(0,max),
    upsertContextWatcher:async p=>{proposed.push(p);return {id:'FICTIONAL-WATCH',created:true,stopped:false}},
    fetch(){throw Error('Network access explicitly blocked')},
    require(){throw Error('Live imports explicitly blocked')},
    process:{env:{}},
  }
  runInNewContext(js,context,{filename:SRC,timeout:2000})
  assert.equal(typeof mod.exports.compileForUser,'function')
  return {run:()=>mod.exports.compileForUser(owner,[trip(ticketOwner)]),reads,proposed,homeCities,readProfiles}
}

let controlPass=0,controlFail=0,mandatoryPass=0,mandatoryFail=0
async function control(label,fn){
  try{await fn();controlPass++;console.log('PASS CONTROL '+label)}
  catch(e){controlFail++;console.error('FAIL CONTROL '+label+': '+(e?.message??e))}
}
async function mandatory(label,fn){
  try{await fn();mandatoryPass++;console.log('PASS MANDATORY '+label)}
  catch(e){mandatoryFail++;console.error('FAIL MANDATORY '+label+': '+(e?.message??e))}
}
const both=()=>harness({owner:B,users:[user(A,'Alice',true),user(B,'Bela',false)],
  memories:[memory(A,'home city: Private Alpha'),memory(B,'home city: Private Beta')]})
await control('safe decimal owner sees only its own memory and Gmail state',async()=>{
  const h=harness({owner:SAFE,users:[user(SAFE,'Safe',false),user(A,'Alice',true)],
    memories:[memory(SAFE,'home city: Own City'),memory(A,'home city: Private Alpha')]})
  await h.run();assert.equal(h.homeCities[0],'Own City')
  assert.equal(h.proposed.filter(p=>p.type==='email_triage').length,0)
})
await control('owner A with actual Gmail opt-in creates its own one triage watch',async()=>{
  const h=harness({owner:A,users:[user(A,'Alice',true)],memories:[memory(A,'home city: Private Alpha')]})
  await h.run();assert.equal(h.homeCities[0],'Private Alpha')
  assert.equal(h.proposed.filter(p=>p.type==='email_triage').length,1)
  assert.equal(h.proposed[0].telegramId,A)
})
await control('owner B exact string scopes existing watcher reads',async()=>{
  const h=both();await h.run()
  assert.ok(h.reads.filter(r=>r.table==='agent_watchers'&&r.col==='telegram_id').every(r=>r.value===B))
})
await control('unreadable owner profile stops compilation instead of creating watches',async()=>{
  const h=harness({owner:SAFE,failProfile:true,users:[user(SAFE,'Safe',true)]})
  await assert.rejects(h.run(),/context_owner_profile_lookup_failed/)
  assert.equal(h.proposed.length,0)
})
await mandatory('64-bit owner B private memory query keeps exact decimal B, never rounded A',async()=>{
  const h=both();await h.run();const q=h.reads.find(r=>r.table==='memories'&&r.col==='telegram_id')
  assert.equal(typeof q?.value,'string');assert.equal(q.value,B)
})
await mandatory('64-bit owner B private profile query keeps exact decimal B, never rounded A',async()=>{
  const h=both();await h.run();const q=h.reads.find(r=>r.table==='users'&&r.col==='telegram_id')
  assert.equal(typeof q?.value,'string');assert.equal(q.value,B)
})
await mandatory('owner B travel compilation cannot include owner A private home city',async()=>{
  const h=both();await h.run();assert.notEqual(h.homeCities[0],'Private Alpha')
})
await mandatory('owner B travel compilation uses B home-city memory, not A memory',async()=>{
  const h=both();await h.run();assert.equal(h.homeCities[0],'Private Beta')
})
await mandatory('owner B cannot inherit A Gmail-connected status into its watcher',async()=>{
  const h=both();await h.run();assert.equal(h.proposed.filter(p=>p.type==='email_triage').length,0)
})
await mandatory('owner B profile must be its own or fail closed before consent read',async()=>{
  const h=both();await h.run();assert.ok(h.readProfiles.every(u=>!u||u.name!=='Alice'))
})

await mandatory('valid negative WhatsApp owner uses exact signed identity and retains own context',async()=>{
  const owner='-991234567'
  const h=harness({owner,users:[user(owner,'Negative',false)],memories:[memory(owner,'home city: Fictional Local')]})
  await h.run()
  assert.equal(h.homeCities[0],'Fictional Local')
  assert.ok(h.reads.filter(r=>['users','memories'].includes(r.table)&&r.col==='telegram_id').every(r=>r.value===owner))
  assert.equal(h.proposed.filter(p=>p.type==='email_triage').length,0)
})
await mandatory('already-rounded 64-bit numeric owner is rejected before any private read or write',async()=>{
  const h=harness({owner:Number(B),users:[],memories:[]})
  await assert.rejects(h.run(),/context_travel_owner_invalid/)
  assert.equal(h.reads.length,0)
  assert.equal(h.proposed.length,0)
})
await mandatory('malformed noncanonical identity is rejected without private lookup',async()=>{
  const h=harness({owner:'00042',users:[user('00042','Malformed',false)]})
  await assert.rejects(h.run(),/context_travel_owner_invalid/)
  assert.equal(h.reads.length,0)
})
await mandatory('out-of-range int64 owner is rejected without private lookup',async()=>{
  const h=harness({owner:'9223372036854775808'})
  await assert.rejects(h.run(),/context_travel_owner_invalid/)
  assert.equal(h.reads.length,0)
})
await mandatory('foreign ticket cannot compile watches for another owner',async()=>{
  const h=harness({owner:B,ticketOwner:A,users:[user(B,'Bela',false)]})
  await assert.rejects(h.run(),/context_travel_ticket_owner_mismatch/)
  assert.equal(h.reads.length,0)
  assert.equal(h.proposed.length,0)
})
await mandatory('owner profile missing fails closed before touching any watcher',async()=>{
  const h=harness({owner:B,users:[],memories:[]})
  await assert.rejects(h.run(),/context_owner_profile_lookup_failed/)
  assert.equal(h.reads.some(r=>r.table==='agent_watchers'),false)
  assert.equal(h.proposed.length,0)
})
await mandatory('mismatched returned profile cannot grant foreign Gmail consent',async()=>{
  const h=harness({owner:B,users:[user(B,'Bela',false)],foreignProfile:user(A,'Alice',true)})
  await assert.rejects(h.run(),/context_profile_owner_mismatch/)
  assert.equal(h.proposed.length,0)
})

console.log(JSON.stringify({controlPass,controlFail,mandatoryPass,mandatoryFail,literalSource:SRC,syntheticOnly:true}))
if(controlFail||mandatoryFail)process.exitCode=1
