// TEST-ONLY / EXPECTED SECURITY RED until flight check-in actor owner binding is exact.
// Execute the original, UNMODIFIED resolveActor function extracted via TypeScript AST
// from the checked-out source. All rows are synthetic and in memory: NO live DB,
// browser, credentials, Vault, network, notifications, customers or provider actions.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

const FILE='lib/agent/life-event-worker.ts'
const source=readFileSync(FILE,'utf8')
const tree=ts.createSourceFile(FILE,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
function originalFunction(name:string){
  const node=tree.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text===name)
  assert.ok(node&&ts.isFunctionDeclaration(node),'source function not found: '+name)
  return node.getText(tree)
}
const resolver=originalFunction('resolveActor')
const preparation=originalFunction('prepareFlightCheckin')
assert.match(preparation,/const actor\s*=\s*await resolveActor\(telegramId\)/,
  'flight preparation must use the source actor resolver')
assert.match(preparation,/runSecureBrowser\(\{[\s\S]*?userId\s*:\s*actor\.userId\s*,/,
  'the selected UUID is used as the browser identity')
assert.match(preparation,/attachSecondaryAuthHandoff\(\{userId\s*:\s*actor\.userId\s*,/,
  'the same selected UUID can be used for auth handoffs')

const A='9007199254740992'
const B='9007199254740993'
const SAFE='123456789'
assert.equal(Number(A),Number(B),'synthetic 64-bit owner fixture must collide after Number()')
type User={telegram_id:string;id:string;whatsapp_id:string;name:string}
const person=(id:string,key:string):User=>({
  telegram_id:id,id:'synthetic-uuid-'+key,
  whatsapp_id:'whatsapp:+1555000000'+(key==='A'?'1':key==='B'?'2':'3'),
  name:'Synthetic '+key,
})
type Lookup={table:string;column:string;value:unknown}
function fixture(users:User[],failDb=false) {
  const lookups:Lookup[]=[]
  const db={
    from(table:string){
      assert.equal(table,'users','only fake users table may be read')
      let predicate:unknown=undefined
      return {
        select(_columns:string){return this},
        eq(column:string,value:unknown){
          assert.equal(column,'telegram_id','actor lookup must scope the account')
          predicate=value
          lookups.push({table,column,value})
          return this
        },
        async maybeSingle(){
          if(failDb)return {data:null,error:{message:'synthetic lookup failure'}}
          const data=users.find(u=>u.telegram_id===String(predicate))||null
          return {data,error:null}
        },
      }
    },
  }
  const transformed=ts.transpileModule(
    resolver+'\nmodule.exports.resolveActor=resolveActor;',
    {fileName:FILE,reportDiagnostics:true,
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}},
  )
  const errors=(transformed.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
  assert.equal(errors.length,0,'actual source resolver must transpile')
  const module={exports:{} as Record<string,any>}
  runInNewContext(transformed.outputText,{
    module,exports:module.exports,supabaseAdmin:db,Number,String,Promise,Error,
    fetch(){throw Error('BLOCKED external fetch')},
    require(){throw Error('BLOCKED module import')},
  },{filename:FILE,timeout:2000})
  assert.equal(typeof module.exports.resolveActor,'function')
  return {resolve:module.exports.resolveActor as (owner:string)=>Promise<any>,lookups}
}
const twoOwners=()=>fixture([person(A,'A'),person(B,'B'),person(SAFE,'SAFE')])
async function maybeResolve(h:ReturnType<typeof fixture>,id:string){
  try {return await h.resolve(id)}catch{return null}
}
let positive=0,safetyPassed=0,safetyFailed=0
async function control(label:string,fn:()=>Promise<void>){
  await fn();positive++;console.log('PASS CONTROL: '+label)
}
async function safety(label:string,fn:()=>Promise<void>){
  try{await fn();safetyPassed++;console.log('PASS SAFETY: '+label)}
  catch(e:any){safetyFailed++;console.error('FAIL SAFETY (expected until fixed): '+label+': '+String(e?.message||e))}
}
await control('normal exact safe owner resolves its own browser UUID and WhatsApp',async()=>{
  const h=twoOwners()
  const actor=await h.resolve(SAFE)
  assert.equal(actor.userId,'synthetic-uuid-SAFE')
  assert.equal(actor.whatsappId,person(SAFE,'SAFE').whatsapp_id)
  assert.equal(actor.legacyTelegramId,Number(SAFE))
  assert.equal(h.lookups.length,1)
})
await control('unknown ordinary owner is not given any actor',async()=>{
  const h=fixture([person(SAFE,'SAFE')])
  await assert.rejects(()=>h.resolve('987654321'),/life_event_actor_missing/)
})
await control('synthetic owner lookup error cannot yield a browser actor',async()=>{
  const h=fixture([person(SAFE,'SAFE')],true)
  await assert.rejects(()=>h.resolve(SAFE),/life_event_actor_lookup_failed/)
})
await control('owner missing a persisted UUID cannot proceed to browsing',async()=>{
  const broken={...person(SAFE,'SAFE'),id:''}
  const h=fixture([broken])
  await assert.rejects(()=>h.resolve(SAFE),/life_event_actor_missing/)
})
await safety('P1: owner B check-in must never run under owner A browser UUID',async()=>{
  const h=twoOwners()
  const actor=await maybeResolve(h,B)
  assert.ok(!actor||actor.userId==='synthetic-uuid-B',
    'owner B check-in chose another browser UUID '+String(actor?.userId))
})
await safety('P1: owner B must not inherit owner A WhatsApp/auth-handoff identity',async()=>{
  const h=twoOwners()
  const actor=await maybeResolve(h,B)
  assert.ok(!actor||actor.whatsappId===person(B,'B').whatsapp_id,
    'owner B check-in selected A WhatsApp '+String(actor?.whatsappId))
})
await safety('P1: 64-bit B query must be exact or fail closed before any lookup',async()=>{
  const h=twoOwners()
  await maybeResolve(h,B)
  assert.ok(h.lookups.every(x=>String(x.value)===B),
    'unsafe query rounded owner B to '+String(h.lookups[0]?.value))
})
await safety('P1: missing owner B must never resolve existing A for flight check-in',async()=>{
  const h=fixture([person(A,'A')])
  const actor=await maybeResolve(h,B)
  assert.ok(!actor||actor.userId!=='synthetic-uuid-A',
    'absent B selected A browser UUID')
})
await safety('P1: check-in must never carry a rounded, unsafe numeric actor ID',async()=>{
  const h=twoOwners()
  const actor=await maybeResolve(h,B)
  assert.ok(!actor||typeof actor.legacyTelegramId!=='number'||Number.isSafeInteger(actor.legacyTelegramId),
    'actor legacy ID became unsafe rounded Number '+String(actor?.legacyTelegramId))
})
console.log('RESULT controls='+positive+' safety_pass='+safetyPassed+' safety_fail='+safetyFailed)
assert.equal(positive,4,'all positive fixtures must pass before safety evaluation')
assert.equal(safetyPassed,5,'all check-in owner-isolation safety assertions must pass before any merge')
console.log('SECURITY GREEN: exact check-in preparation browser/recipient owner binding')
