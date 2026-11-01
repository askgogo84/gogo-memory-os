// TEST ONLY. Execute unchanged reservation-browser actor resolver in a sealed fictional database.
// Mandatory safety failures are intentionally RED; never merge/deploy this diagnostic as a fix.
// Zero real Supabase, browser, WhatsApp, reservation submission, approval changes, Gmail or customer operations.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const sourceFile = 'lib/agent/restaurant-reservation-worker.ts'
const source = readFileSync(sourceFile, 'utf8')
const ast = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'actorFor')
assert.ok(fn?.body, 'original reservation worker actor resolver missing; inspect source, never skip')
const compiled = ts.transpileModule(fn.getText(ast), {
  fileName: sourceFile,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const EVEN = '9007199254740992'
const ODD  = '9007199254740993'
const users = new Map([
  ['42', {id:'uuid-safe-42',telegram_id:'42',whatsapp_id:'whatsapp:+15550000042',name:'Safe 42'}],
  ['43', {id:'uuid-safe-43',telegram_id:'43',whatsapp_id:'whatsapp:+15550000043',name:'Safe 43'}],
  [EVEN, {id:'uuid-even',telegram_id:EVEN,whatsapp_id:'whatsapp:+15550000192',name:'Fictional Even'}],
  [ODD,  {id:'uuid-odd',telegram_id:ODD,whatsapp_id:'whatsapp:+15550000193',name:'Fictional Odd'}],
])
function harness({ dbError = false, overrideRow } = {}) {
  const queries = []
  const fakeDb = { from(table) {
    assert.equal(table, 'users', 'unexpected privileged table')
    return { select(columns) {
      assert.equal(columns, 'id,telegram_id,whatsapp_id,name,timezone', 'unexpected identity projection')
      return { eq(column,value) {
        assert.equal(column, 'telegram_id', 'unexpected identity filter')
        queries.push(value)
        return { async maybeSingle() {
          if(dbError) return {data:null,error:{message:'fictional-db-error'}}
          return {data:overrideRow !== undefined ? overrideRow : (users.get(String(value)) ?? null),error:null}
        } }
      } }
    } }
  } }
  const resolve = vm.runInNewContext(compiled+'\nactorFor', {
    supabaseAdmin:fakeDb,console:{error(){}},Number,String,Promise,
  },{filename:sourceFile,timeout:2500})
  return {resolve,queries}
}
async function outcome(owner,options={}) {
  const h=harness(options)
  let actor=null,error=null
  try {actor=await h.resolve(owner)} catch(e){error=String(e?.message||e)}
  return {actor,error,queries:h.queries}
}
let controlsPass=0,controlsFail=0,safetyPass=0,safetyFail=0
async function check(kind,label,action){
  try{
    await action()
    if(kind==='control')controlsPass++;else safetyPass++
    console.log('PASS '+kind+': '+label)
  }catch(err){
    if(kind==='control')controlsFail++;else safetyFail++
    console.error('FAIL '+kind+': '+label+' — '+String(err?.message||err).slice(0,240))
  }
}

// Benign controls establish that the test harness really executes the production function.
await check('control','normal numeric owner 42 resolves its own fictional actor',async()=>{
  const r=await outcome('42')
  assert.equal(r.error,null)
  assert.equal(r.actor?.userId,'uuid-safe-42')
  assert.equal(r.actor?.legacyTelegramId,42)
  assert.equal(r.actor?.whatsappId,'whatsapp:+15550000042')
  assert.equal(r.queries.length,1)
})
await check('control','separate normal numeric owner 43 resolves independently',async()=>{
  const r=await outcome('43')
  assert.equal(r.actor?.userId,'uuid-safe-43')
  assert.equal(r.actor?.legacyTelegramId,43)
})
await check('control','unknown owner is not fabricated',async()=>{
  const r=await outcome('999')
  assert.equal(r.actor,null)
  assert.match(String(r.error), /restaurant_reservation_actor_missing/)
})
await check('control','synthetic database error denies actor lookup',async()=>{
  const r=await outcome('42',{dbError:true})
  assert.equal(r.actor,null)
  assert.match(String(r.error), /restaurant_reservation_actor_missing/)
})
await check('control','non-numeric owner has no users row',async()=>{
  const r=await outcome('not-a-number')
  assert.equal(r.actor,null)
  assert.match(String(r.error), /restaurant_reservation_actor_missing/)
})
await check('control','approved reservation reaches this actor resolver before using the browser owner',async()=>{
  assert.match(source,/const actor=await actorFor\(tg\)/)
  assert.match(source,/\.from\('agent_approvals'\)[^\n]*\.eq\('telegram_id',tg\)/)
  assert.match(source,/runSecureBrowser\(\{reserveHumanHandoff:true,userId:actor\.userId,url,mode:'execute',objective:instruction\}\)/)
  assert.match(source,/await notify\(actor,/)
})

// Mandatory privacy/identity checks should fail under unchanged unsafe code.
// A corrected implementation may safely deny unsafe historical owners; no guessed fallback.
await check('mandatory','odd 64-bit owner must never resolve the other actor',async()=>{
  const r=await outcome(ODD)
  if(!r.actor)return
  assert.equal(r.actor.userId,'uuid-odd','wrong browser owner selected for approved reservation')
  assert.equal(r.actor.whatsappId,'whatsapp:+15550000193','wrong WhatsApp recipient selected for approved reservation')
})
await check('mandatory','two distinct BIGINT owners cannot map to same reservation browser actor',async()=>{
  const a=await outcome(EVEN),b=await outcome(ODD)
  if(a.actor&&b.actor)assert.notEqual(a.actor.userId,b.actor.userId,'cross-tenant actor collision')
})
await check('mandatory','privileged users lookup must never receive unsafe rounded JS owner number',async()=>{
  const r=await outcome(ODD)
  assert.ok(r.queries.every(v=>typeof v==='string'||(typeof v==='number'&&Number.isSafeInteger(v))),
    'rounded identifier supplied to service-role lookup')
})
await check('mandatory','already-rounded input is denied before selecting a users row',async()=>{
  const r=await outcome(Number(ODD))
  assert.equal(r.queries.length,0,'untrusted rounded number queried privileged users')
  assert.equal(r.actor,null)
})
await check('mandatory','mismatched returned row cannot select another owner's browser context',async()=>{
  const r=await outcome('42',{overrideRow:users.get('43')})
  assert.equal(r.actor,null,'wrong owner row accepted without explicit binding check')
})
await check('mandatory','already-rounded BIGINT in DB row cannot become an AgentActor',async()=>{
  const row={id:'uuid-unsafe',telegram_id:Number(ODD),whatsapp_id:'whatsapp:+15550000193',name:'Unsafe'}
  const r=await outcome('42',{overrideRow:row})
  assert.equal(r.actor,null,'unsafe DB owner identity accepted')
})
await check('mandatory','scientific-notation identifier must not select another owner',async()=>{
  const r=await outcome('4.2e1')
  assert.equal(r.queries.length,0,'noncanonical owner reached privileged lookup')
  assert.equal(r.actor,null)
})

console.log('RESULT controls_pass='+controlsPass+'/6 controls_fail='+controlsFail+
  ' mandatory_pass='+safetyPass+'/7 mandatory_fail='+safetyFail)
if(controlsFail)process.exit(2)
if(safetyFail)process.exit(1)
