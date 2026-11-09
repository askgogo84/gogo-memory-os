// TEST-ONLY: execute unchanged candidate sendProactiveEmailCard with fictional records.
// No network, provider, credentials, customer data, or real account side effects.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { randomUUID } from 'node:crypto'

const file = 'lib/agent/autonomy-pulse.ts'
const source = fs.readFileSync(file, 'utf8')
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const node = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'sendProactiveEmailCard')
assert.ok(node, 'candidate unchanged production sendProactiveEmailCard not found')
const compiled = ts.transpileModule(node.getText(ast), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 }
}).outputText
assert.match(compiled, /async function sendProactiveEmailCard/, 'must execute original candidate function')

const EMAIL_KEY = 'email:fictional-thread-a'
const OWNER = '-42'
const recipient = { telegram_id: OWNER, whatsapp_id: '+919999000001', gmail_email: 'user@example.invalid' }
const picked = {
  loopId: 'fictional-loop-a',
  threadId: 'fictional-thread-a',
  score: .98,
  category: 'action',
  senderEmail: 'billing@example.invalid',
  senderName: 'Fictional Sender',
  why: 'Needs review',
  ask: 'Review fictional notice',
  email: { id: 'fictional-message-a', from: 'Fictional Sender <billing@example.invalid>', subject: 'Synthetic notice', snippet: 'Fictional text only' }
}
const eligible = [{id:picked.loopId,kind:'attention',title:'Synthetic notice',summary:'Fictional',
  source_type:'gmail_thread',source_id:picked.threadId,evidence_json:{},created_at:'2026-11-01T00:00:00Z'}]

function harness(opts = {}) {
  const history = [...(opts.history || [])]
  const attempts = []
  const activityWrites = []
  const queries = []
  let sendCount = 0
  let gateCount = 0
  let releaseGate
  const gate = new Promise(resolve => { releaseGate = resolve })
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const send = async (phone, body) => {
    assert.equal(phone, recipient.whatsapp_id, 'fictional recipient only')
    sendCount++
    attempts.push({phone, body})
    if (opts.concurrent) {
      gateCount++
      if (gateCount >= 2) releaseGate()
      await Promise.race([gate, pause(450)])
    }
    if (opts.providerUnknownFirst && sendCount === 1) {
      throw new Error('synthetic_provider_timeout_outcome_unknown')
    }
    return {sid:'FAKE_SID_NO_PROVIDER_' + sendCount}
  }
  // ADAPTED for #1209's merged contract: an atomic in-memory stand-in for the
  // claim_autonomy_email_card / finish_autonomy_email_card RPCs (mirrors the SQL: per owner/day
  // 2-item budget, one claim per owner+thread forever, duplicate claim rolls back the budget).
  // Each RPC body is synchronous between check and write, so it is atomic like the DB row lock.
  const budget = new Map()
  const claims = new Map()
  const rpcCalls = []
  const db = {
    async rpc(name, args) {
      rpcCalls.push(name)
      assert.ok(['claim_autonomy_email_card','finish_autonomy_email_card'].includes(name), 'unexpected RPC ' + name)
      assert.equal(String(args.p_owner), OWNER, 'owner passed exactly')
      if (name === 'claim_autonomy_email_card') {
        const keys = args.p_threads || []
        const dayKey = args.p_owner + '|' + args.p_day
        const prior = Math.max(budget.get(dayKey) || 0, args.p_prior_count || 0)
        if (!keys.length || keys.length > 2 || new Set(keys).size !== keys.length) return {data:false,error:null}
        if (prior + keys.length > 2) return {data:false,error:null}
        if (keys.some(k => claims.has(args.p_owner + '|' + k)))
          return {data:null,error:{message:'autonomy_email_duplicate_claim'}}
        budget.set(dayKey, prior + keys.length)
        for (const k of keys) claims.set(args.p_owner + '|' + k, {token:args.p_token,state:'outcome_unknown'})
        return {data:true,error:null}
      }
      for (const c of claims.values()) {
        if (c.token === args.p_token && c.state === 'outcome_unknown') { c.state = 'provider_accepted'; c.provider = args.p_provider_id }
      }
      return {data:[...claims.values()].some(c => c.token === args.p_token && c.provider === args.p_provider_id),error:null}
    },
    from(table) {
      assert.ok(['agent_open_loops','email_attention_rules','conversations',
        'email_attention_events','agent_activity'].includes(table),
      'forbid non-fixture database table ' + table)
      let action = 'read'
      const q = {
        select() {return q},
        eq(field,value) {queries.push([table,field,String(value)]);return q},
        in() {return q},
        order() {return q},
        limit() {return q},
        update() {action = 'update';return q},
        insert(row) {
          assert.ok(['conversations','email_attention_events','agent_activity'].includes(table))
          if(table === 'agent_activity') {
            assert.equal(row.telegram_id, OWNER)
            assert.equal(row.event_type, 'autonomy_email_sent')
            activityWrites.push(row)
            if (opts.activityWriteError) return Promise.resolve({error:{message:'fictional_activity_insert_failed'}})
            history.push({
              type:'autonomy_email_sent',
              at:'2026-11-02T00:00:00Z',
              keys:(row.metadata_json?.item_keys || []).map(String)
            })
          }
          return Promise.resolve({error:null})
        },
        then(resolve,reject) {
          const data = action === 'update' ? [] :
            table === 'agent_open_loops' ? (opts.noEmail ? [] : eligible) :
            table === 'email_attention_rules' ? [] : []
          return Promise.resolve({data,error:null}).then(resolve,reject)
        }
      }
      return q
    }
  }
  const context = {
    supabaseAdmin: db,
    sendWhatsApp: send,
    sendWhatsAppReminderTemplate: send,
    recentSurfacedKeys: async () => history.map(r => ({...r,keys:[...r.keys]})),
    allowedByTopic: () => !opts.topicDenied,
    topicForPulse: () => 'email',
    selectProactiveEmails: (_allowed, state) => {
      if (state.sentToday >= 2 || state.alreadySurfaced.has(EMAIL_KEY)) return []
      return [picked]
    },
    formatProactiveEmailCard: () => 'Fictional high-priority email notice',
    decodeHtmlEntities: t => t,
    clean: (value,max) => String(value || '').slice(0,max || 500),
    ownerKey: s => s,
    localDay: () => '2026-11-02',
    randomUUID,
    Date, Set, String, Number, Promise, console
  }
  const fn = vm.runInNewContext(compiled + '\n({sendProactiveEmailCard})',context,{timeout:1500}).sendProactiveEmailCard
  assert.equal(typeof fn,'function')
  return {
    call: () => fn(OWNER,recipient,'Asia/Kolkata',{},true),
    history,activityWrites,queries,attempts,
    sends:()=>sendCount
  }
}
let controlPass=0,controlFail=0,mandatoryPass=0,mandatoryFail=0
async function check(label,mandatory,exercise) {
  try {
    await exercise()
    if(mandatory) mandatoryPass++; else controlPass++
    console.log('PASS ['+(mandatory?'MANDATORY':'CONTROL')+'] '+label)
  } catch (error) {
    if(mandatory) mandatoryFail++; else controlFail++
    console.error('FAIL ['+(mandatory?'MANDATORY':'CONTROL')+'] '+label+': '+(error?.message || error))
  }
}

// Benign controls: do not disable real owner-approved notifications to make a security test pass.
await check('no eligible mail sends nothing',false,async()=>{
  const h=harness({noEmail:true}); const result=await h.call()
  assert.equal(result.sent,false);assert.equal(h.sends(),0)
})
await check('allowed synthetic email sends once and records the item key',false,async()=>{
  const h=harness();const result=await h.call()
  assert.equal(result.sent,true);assert.equal(h.sends(),1)
  assert.equal(h.activityWrites.length,1)
  assert.ok(h.history[0].keys.includes(EMAIL_KEY))
})
await check('persisted event blocks later repeat of same thread',false,async()=>{
  const h=harness();await h.call();const second=await h.call()
  assert.equal(second.sent,false);assert.equal(h.sends(),1)
})
await check('two previously recorded local-day items block more email',false,async()=>{
  const h=harness({history:[{type:'autonomy_email_sent',at:'2026-11-02T00:00:00Z',
    keys:['email:older-a','email:older-b']}]})
  const result=await h.call();assert.equal(result.sent,false);assert.equal(h.sends(),0)
})
await check('muted owner topic sends nothing',false,async()=>{
  const h=harness({topicDenied:true});const result=await h.call()
  assert.equal(result.sent,false);assert.equal(h.sends(),0)
})

// Mandatory reliability/privacy boundaries: RED until there is a durable owner/key claim,
// provider-unknown reconciliation, and unambiguous no-repeat behavior.
await check('accepted provider sid with failed durable activity write must not report verified sent',true,async()=>{
  const h=harness({activityWriteError:true})
  const result=await h.call()
  assert.notEqual(result.sent,true,'returned sent despite rejected durable delivery receipt')
  assert.equal(h.sends(),1)
})
await check('accepted provider sid plus failed receipt cannot blindly resend same email',true,async()=>{
  const h=harness({activityWriteError:true})
  await h.call(); await h.call()
  assert.equal(h.sends(),1,'same email sent twice after first accepted sid and missing receipt')
})
await check('parallel same-owner same-thread workers must issue at most one WhatsApp send',true,async()=>{
  const h=harness({concurrent:true})
  await Promise.allSettled([h.call(),h.call()])
  assert.equal(h.sends(),1,'two workers passed the pre-send history check')
})
await check('one existing daily email plus two parallel workers must respect daily cap of two',true,async()=>{
  const h=harness({concurrent:true,history:[
    {type:'autonomy_email_sent',at:'2026-11-02T00:00:00Z',keys:['email:older-c']}
  ]})
  await Promise.allSettled([h.call(),h.call()])
  assert.ok(1+h.sends()<=2,'two parallel workers exceeded two/day budget')
})
await check('provider unknown outcome must not trigger an immediate blind retry',true,async()=>{
  const h=harness({providerUnknownFirst:true})
  // ADAPTED for #1209's merged contract: an unknown provider outcome is returned as
  // {sent:false, reason:'outcome_unknown'} (claim stays fenced) instead of rethrowing the provider error.
  const first = await h.call()
  assert.equal(first.sent, false, 'unknown outcome must not report sent')
  assert.equal(first.reason, 'outcome_unknown')
  await h.call()
  assert.equal(h.sends(),1,'unknown first outcome was followed by a second provider attempt')
})

console.log('PROACTIVE EMAIL DELIVERY: '+controlPass+' controls passing, '+controlFail+
  ' controls failing; '+mandatoryPass+' mandatory passing, '+mandatoryFail+
  ' mandatory failing; ALL DATA/TRANSPORTS FICTIONAL; ZERO REAL SENDS')
if(controlFail)process.exitCode=2
else if(mandatoryFail)process.exitCode=1
