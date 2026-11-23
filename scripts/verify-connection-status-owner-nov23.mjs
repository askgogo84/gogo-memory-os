// Security regression: execute the real connection-status handler in a sealed VM.
// All DB and provider activity is synthetic; the original connected-services test remains unchanged.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const ts=createRequire(import.meta.url)('typescript')
const source=readFileSync('lib/agent/autonomy-status.ts','utf8')
const compiled=ts.transpileModule(source,{
  fileName:'autonomy-status.ts',
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText
const statusQuestion='Which email ID am I connected to?'

function fixture(){
  const calls=[]
  const syntheticUser={
    gmail_connected:true,gmail_send_connected:false,gmail_email:'fixture@example.invalid',
    gmail_connected_at:null,google_calendar_connected:false,google_refresh_token:null,
  }
  const database={
    from(table){
      if(!['users','user_consent_settings'].includes(table))throw Error('unexpected private table '+table)
      calls.push({op:'from',table})
      const query={
        select(columns){calls.push({op:'select',table,columns});return query},
        eq(key,owner){assert.equal(key,'telegram_id');calls.push({op:'eq',table,owner});return query},
        async maybeSingle(){
          calls.push({op:'read',table})
          return {data:table==='users'?syntheticUser:{gmail_enabled:false},error:null}
        },
        insert(){throw Error('account or consent write forbidden in fixture')},
        update(){throw Error('account or consent write forbidden in fixture')},
        delete(){throw Error('account or consent write forbidden in fixture')},
      }
      return query
    },
  }
  const inertModules=new Set([
    './open-loops','./task-lifecycle','./task-status','./task-title','./attention-state',
  ])
  const exports={}
  runInNewContext(compiled,{
    exports,
    require(id){
      if(id==='@/lib/supabase-admin')return {supabaseAdmin:database}
      if(inertModules.has(id))return {}
      throw Error('unexpected module in isolated test: '+id)
    },
    Date,Intl,console,
  },{filename:'isolated-autonomy-status.js',timeout:5000})
  return {actual:exports,calls}
}

let passed=0,failed=0
async function check(label,fn){
  try{await fn();passed++;console.log('PASS',label)}
  catch(error){failed++;console.error('FAIL',label,error)}
}

await check('recognized connected-account status takes the real private read path',async()=>{
  const f=fixture()
  assert.equal(f.actual.isConnectionStatus(statusQuestion),true)
  assert.equal(f.actual.isConnectionCapabilityQuery(statusQuestion),false)
  const result=await f.actual.tryGetConnectionStatus({
    actor:{legacyTelegramId:42},text:statusQuestion,
  })
  assert.equal(result.handledBy,'connection-status')
  assert.match(result.text,/Connected accounts/)
  assert.deepEqual(f.calls.filter(c=>c.op==='from').map(c=>c.table),['users','user_consent_settings'])
  assert.deepEqual(f.calls.filter(c=>c.op==='eq').map(c=>c.owner),[42,42])
  assert.equal(f.calls.some(c=>c.op==='insert'||c.op==='update'||c.op==='delete'),false)
})

for(const owner of [-42,-1001234567890,1,42,Number.MAX_SAFE_INTEGER,Number.MIN_SAFE_INTEGER]){
  await check('CONTROL: exact safe signed owner '+owner+' stays owner-bound',async()=>{
    const f=fixture()
    const result=await f.actual.tryGetConnectionStatus({actor:{legacyTelegramId:owner},text:statusQuestion})
    assert.equal(result.handledBy,'connection-status')
    assert.deepEqual(f.calls.filter(c=>c.op==='eq').map(c=>c.owner),[owner,owner],
      'user and consent reads must retain exact original owner')
  })
}

for(const [label,owner] of [
  ['zero',0],['negative zero',-0],['fraction',42.5],
  ['NaN',NaN],['positive infinity',Infinity],['negative infinity',-Infinity],
  ['rounded positive integer',Number.MAX_SAFE_INTEGER+1],
  ['rounded negative integer',Number.MIN_SAFE_INTEGER-1],
  ['out-of-range BigInt',BigInt('9223372036854775807')],
  ['string instead of number','42'],['null',null],['missing',undefined],
  ['boolean',true],['object',{value:42}],
]){
  await check('MANDATORY: '+label+' fails closed before any private lookup',async()=>{
    const f=fixture()
    await assert.rejects(
      f.actual.tryGetConnectionStatus({actor:{legacyTelegramId:owner},text:statusQuestion}),
      /connection_status_owner_invalid/,
    )
    assert.deepEqual(f.calls,[],'invalid owner must cause zero service-role DB operations')
  })
}

await check('unrelated queries are unchanged and never read connected accounts',async()=>{
  const f=fixture()
  const result=await f.actual.tryGetConnectionStatus({
    actor:{legacyTelegramId:42},text:'What is the time in London?',
  })
  assert.equal(result,null)
  assert.deepEqual(f.calls,[])
})

console.log('Connection status exact owner: '+passed+' PASS / '+failed+
  ' FAIL. Real handler, inert database, no provider/credentials/network or account changes.')
if(failed)process.exitCode=1
