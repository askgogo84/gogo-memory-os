// TEST-ONLY / EXPECTED SECURITY RED until the browser's persistent sandbox owner is exact.
// This executes the *unaltered* private owner resolver extracted via the TypeScript AST from
// the checked-out secure-computer.ts source. All database rows are synthetic and in memory.
// NO actual browser, Vercel sandbox, network, credentials, customer data or external effects.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const SOURCE_PATH='lib/agent/secure-computer.ts'
const source=readFileSync(SOURCE_PATH,'utf8')
const tree=ts.createSourceFile(SOURCE_PATH,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
function original(name:string) {
  const node=tree.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text===name)
  assert.ok(node&&ts.isFunctionDeclaration(node),'deployed function missing: '+name)
  return node.getText(tree)
}
const resolver=original('canonicalBrowserOwnerId')
const getComputer=original('getComputer')
assert.match(getComputer,/const canonicalUserId\s*=\s*await canonicalBrowserOwnerId\(userId\)/,
  'persistent browser must resolve the account identity')
assert.match(getComputer,/const name\s*=\s*userSandboxName\(canonicalUserId\)/,
  'persistent sandbox name is calculated from that resolved owner')
assert.match(getComputer,/Sandbox\.getOrCreate\(\{[\s\S]*?persistent\s*:\s*true/,
  'the selected sandbox is persistent; collision can reuse a signed-in session')
const watcher=readFileSync('lib/agent/watchers.ts','utf8')
assert.match(watcher,/runSecureBrowser\(\{\s*userId\s*:\s*telegramId\s*,/,
  'the shipped watcher supplies the original numeric-looking telegram owner to the browser')

const A='9007199254740992'
const B='9007199254740993'
const SAFE='123456789'
const A_UUID='synthetic-user-A'
const B_UUID='synthetic-user-B'
assert.equal(Number(A),Number(B),'test fixture must exercise real IEEE-754 owner aliasing')

type User={telegram_id:string;id:string}
function harness(users:User[],dbFailure=false){
  const calls:Array<{table:string;column:string;value:unknown}>=[]
  const fake={
    from(table:string){
      assert.equal(table,'users','resolver must only query synthetic users')
      let ownerPredicate:unknown=undefined
      return {
        select(_fields:string){return this},
        eq(col:string,value:unknown){
          assert.equal(col,'telegram_id','resolver must bind by owner')
          ownerPredicate=value
          calls.push({table,column:col,value})
          return this
        },
        async maybeSingle(){
          if(dbFailure)return {data:null,error:{message:'synthetic database error'}}
          const row=users.find(u=>u.telegram_id===String(ownerPredicate))
          return {data:row?{id:row.id,telegram_id:row.telegram_id}:null,error:null}
        },
      }
    },
  }
  const compiled=ts.transpileModule(resolver+'\nmodule.exports.canonicalBrowserOwnerId=canonicalBrowserOwnerId;',{
    fileName:SOURCE_PATH,reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  })
  const errors=(compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
  assert.equal(errors.length,0,'the shipped function must transpile')
  const mod={exports:{} as Record<string,any>}
  const context={module:mod,exports:mod.exports,supabaseAdmin:fake,Number,String,Error,Promise}
  runInNewContext(compiled.outputText,context,{filename:SOURCE_PATH,timeout:2000})
  assert.equal(typeof mod.exports.canonicalBrowserOwnerId,'function')
  return {resolve:mod.exports.canonicalBrowserOwnerId as (value:string)=>Promise<string>,calls}
}
const standard=()=>harness([
  {telegram_id:SAFE,id:'synthetic-user-SAFE'},
  {telegram_id:A,id:A_UUID},
  {telegram_id:B,id:B_UUID},
])
let controls=0,safetyPass=0,safetyFail=0
async function control(label:string,fn:()=>Promise<void>){
  await fn();controls++;console.log('PASS CONTROL: '+label)
}
async function safety(label:string,fn:()=>Promise<void>){
  try{await fn();safetyPass++;console.log('PASS SAFETY: '+label)}
  catch(err:any){safetyFail++;console.error('FAIL SAFETY (expected until fixed): '+label+': '+String(err?.message||err))}
}
async function guardedResolve(h:ReturnType<typeof harness>,id:string){
  try{return await h.resolve(id)}catch{return null}
}

await control('safe numeric owner resolves to the right synthetic user UUID',async()=>{
  const h=standard()
  assert.equal(await h.resolve(SAFE),'synthetic-user-SAFE')
  assert.equal(h.calls.length,1)
  assert.equal(String(h.calls[0].value),SAFE)
})
await control('an opaque UUID remains its own sandbox owner without numeric lookup',async()=>{
  const h=standard()
  assert.equal(await h.resolve('uuid-owner-opaque'),'uuid-owner-opaque')
  assert.equal(h.calls.length,0)
})
await control('blank browser owner fails closed without DB access',async()=>{
  const h=standard()
  await assert.rejects(()=>h.resolve('   '),/browser_owner_missing/)
  assert.equal(h.calls.length,0)
})
await control('synthetic database errors cannot authorize a new owner',async()=>{
  const h=harness([{telegram_id:SAFE,id:'synthetic-user-SAFE'}],true)
  await assert.rejects(()=>h.resolve(SAFE),/browser_owner_lookup_failed/)
})
await control('unknown safe owner does not inherit another user sandbox',async()=>{
  const h=harness([{telegram_id:SAFE,id:'synthetic-user-SAFE'}])
  assert.equal(await h.resolve('987654321'),'987654321')
})

await safety('P1: owner B may resolve only to its own persistent browser identity or fail closed',async()=>{
  const h=standard()
  const resolved=await guardedResolve(h,B)
  assert.ok(resolved===B_UUID||resolved===null,
    'owner B resolved another persistent owner: '+String(resolved))
})
await safety('P1: 64-bit owner B DB query must preserve exact identity, never a rounded number',async()=>{
  const h=standard()
  await guardedResolve(h,B)
  assert.ok(h.calls.every(c=>String(c.value)===B),
    'owner B lookup sent rounded value '+String(h.calls[0]?.value))
})
await safety('P1: two distinct 64-bit owners cannot share persistent browser sandbox owner',async()=>{
  const h=standard()
  const a=await guardedResolve(h,A)
  const b=await guardedResolve(h,B)
  assert.ok(b===null||a!==b,
    'owner A/B would select the same persistent sandbox identity: '+String(b))
})
await safety('P1: when B is absent, B must not inherit A signed-in sandbox',async()=>{
  const h=harness([{telegram_id:A,id:A_UUID}])
  const resolved=await guardedResolve(h,B)
  assert.notEqual(resolved,A_UUID,
    'missing owner B selected owner A persistent browser identity')
})
console.log('RESULT controls='+controls+' safety_pass='+safetyPass+' safety_fail='+safetyFail)
assert.equal(controls,5,'positive fixtures must pass first')
assert.equal(safetyPass,4,'all four exact owner/sandbox safety assertions must pass before merge')
console.log('SECURITY GREEN: no cross-owner persistent sandbox alias')
