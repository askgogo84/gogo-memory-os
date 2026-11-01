// SECURITY REGRESSION: exercise the actual corrected inbound-mail notification helper with synthetic records.
// No real Supabase, Twilio, provider, network, credentials, mail, or customer records.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const file = 'lib/email/inbound.ts'
const source = fs.readFileSync(file, 'utf8')
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const notifyNode = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'notify')
assert.ok(notifyNode, 'must execute actual inbound notify function')
const inboundNode = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'processInboundEmail')
assert.ok(inboundNode, 'downstream inbound mail handler must remain present')
const inboundBody = inboundNode.getText(ast)
// The caller treats the helper's returned "pushed" boolean as notification accounting.
assert.match(inboundBody, /const pushed\s*=\s*await notify\(/, 'must exercise actual pushed boolean returned to caller')
assert.match(inboundBody, /if\s*\(pushed\)\s*await supabaseAdmin\.from\(['"]inbound_emails['"]\)\.update\(\{\s*notified_at:/,
  'caller writes notified_at only when helper confirms provider acceptance')
const compiled = ts.transpileModule(notifyNode.getText(ast), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 }
}).outputText
assert.match(compiled, /async function notify\(/, 'test production AST rather than a rewritten test double')

function harness(status, { missingRecipient=false, throwDelivery=false }={}) {
  const conversations=[]
  const deliveryCalls=[]
  const queryLog=[]
  let userLookups=0
  const owner=-43 // valid fictional signed WhatsApp owner
  const phone='+919900000043' // fictional recipient; no network transport
  const db={
    from(table) {
      assert.ok(['users','conversations'].includes(table), 'unexpected table: '+table)
      if(table==='users') {
        const q={
          select(field){assert.equal(field,'whatsapp_id');return q},
          eq(field,value){assert.equal(field,'telegram_id');assert.equal(value,owner);queryLog.push([field,value]);return q},
          async maybeSingle(){userLookups++;return {data:missingRecipient?null:{whatsapp_id:phone},error:null}}
        }
        return q
      }
      return {
        insert(row){
          assert.deepEqual(Object.keys(row).sort(),['content','role','telegram_id'])
          assert.equal(row.telegram_id,owner)
          assert.equal(row.role,'assistant')
          assert.equal(row.content,'Fictional attention card')
          conversations.push(row)
          return Promise.resolve({error:null})
        }
      }
    }
  }
  const context={
    supabaseAdmin: db,
    deliverNotification: async config => {
      deliveryCalls.push(config)
      assert.equal(config.key,'fictional-email-urgent-key')
      assert.equal(config.owner,owner)
      assert.equal(config.channel,'whatsapp')
      assert.equal(config.source,'watch_alert')
      // Do not call send, or any real provider: simulate the durable delivery state.
      if(throwDelivery) throw new Error('synthetic-delivery-failure')
      return status
    },
    sendWhatsApp: async () => {throw new Error('NETWORK_AND_PROVIDER_FORBIDDEN')},
    String,Date,Promise,console: {error:()=>{}}
  }
  const fn=vm.runInNewContext(compiled+'\nnotify',context,{timeout:1500})
  assert.equal(typeof fn,'function')
  return {
    call:()=>fn(owner,'fictional-email-urgent-key','Fictional attention card'),
    conversations,deliveryCalls,queryLog,
    lookups:()=>userLookups
  }
}

let controlPass=0,controlFail=0,mandatoryPass=0,mandatoryFail=0
async function check(name, mandatory, callback) {
  try {
    await callback()
    if(mandatory)mandatoryPass++;else controlPass++
    console.log('PASS ['+(mandatory?'MANDATORY':'CONTROL')+'] '+name)
  }catch(e){
    if(mandatory)mandatoryFail++;else controlFail++
    console.error('FAIL ['+(mandatory?'MANDATORY':'CONTROL')+'] '+name+': '+(e?.message||e))
  }
}

await check('unknown recipient is never reported pushed',false,async()=>{
  const h=harness('provider_accepted',{missingRecipient:true})
  assert.equal(await h.call(),false)
  assert.equal(h.deliveryCalls.length,0)
  assert.equal(h.conversations.length,0)
  assert.equal(h.lookups(),1)
})
await check('fictional provider accepted SID is recorded as attempted and chat card added',false,async()=>{
  const h=harness('provider_accepted')
  assert.equal(await h.call(),true)
  assert.equal(h.deliveryCalls.length,1)
  assert.equal(h.conversations.length,1)
})
await check('explicit failed delivery is not recorded pushed',false,async()=>{
  const h=harness('failed')
  assert.equal(await h.call(),false)
  assert.equal(h.conversations.length,0)
})
await check('caught transport failure is not recorded pushed',false,async()=>{
  const h=harness('provider_accepted',{throwDelivery:true})
  assert.equal(await h.call(),false)
  assert.equal(h.conversations.length,0)
})

// Mandatory: only a real provider-accepted outcome may be reported as pushed.
// An unknown result is not proof of failure, either: retain the ledger and reconcile, never blind-retry.
for(const status of ['skipped','suppressed','deferred','persistence_failed','outcome_unknown']) {
  await check(status+' must not count as pushed or cause notified_at downstream',true,async()=>{
    const h=harness(status)
    const pushed=await h.call()
    assert.equal(pushed,false,'inbound caller would mark notified_at for status='+status)
    assert.equal(h.conversations.length,0,'non-accepted outcome must not create delivered-chat history')
    assert.equal(h.deliveryCalls.length,1)
  })
}
await check('unknown provider outcome must not create a delivered assistant chat card',true,async()=>{
  const h=harness('outcome_unknown')
  await h.call()
  assert.equal(h.conversations.length,0,'unknown provider acceptance cannot be written as sent assistant card')
})

await check('unrecognized notification state fails closed instead of claiming delivery',true,async()=>{
  const h=harness('future_unrecognized_state')
  assert.equal(await h.call(),false)
  assert.equal(h.deliveryCalls.length,1)
  assert.equal(h.conversations.length,0)
})

console.log(JSON.stringify({controlPass,controlFail,mandatoryPass,mandatoryFail,literalSource:file,syntheticOnly:true}))
if(controlFail||mandatoryFail)process.exitCode=1
