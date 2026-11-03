// TEST-ONLY diagnostic. Executes the original syncConversationSignals function with fictional records.
// Every DB read and every upsert is intercepted: no network, credentials or customer data.
// Run: node scripts/verify-openloop-conversation-owner-testonly.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path = 'lib/agent/open-loops.ts'
const source = fs.readFileSync(path, 'utf8')
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const original = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'syncConversationSignals')
assert.ok(original, 'production syncConversationSignals function must exist')
const compiled = ts.transpileModule(original.getText(ast), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText

const A = '9007199254740992'
const B = '9007199254740993'
const createdAt = '2026-10-30T09:00:00.000Z'
function privateConversation(owner, suffix = owner) {
  return { id: 'fictional-message-' + suffix, telegram_id: owner,
    content: 'SYNTHETIC_PRIVATE: owner ' + owner + ' confidential meeting follow-up',
    created_at: createdAt }
}

function harness(opts = {}) {
  const consent = new Map(opts.consent ?? [['42', {telegram_id:'42', memory_enabled:true}]])
  const conversations = new Map(opts.conversations ?? [['42', [privateConversation('42')]]])
  const reads = []
  const writes = []
  const db = {
    from(table) {
      if (!['user_consent_settings', 'conversations'].includes(table)) throw Error('unexpected table ' + table)
      const filters = {}
      const builder = {
        select() { return builder },
        eq(column, value) { filters[column] = value; return builder },
        gte() { return builder },
        order() { return builder },
        maybeSingle() {
          assert.equal(table, 'user_consent_settings')
          const selected = String(filters.telegram_id)
          reads.push({table, selected, original: filters.telegram_id})
          return Promise.resolve({data: consent.get(selected) ?? null, error:opts.consentError ?? null})
        },
        limit() {
          assert.equal(table, 'conversations')
          const selected = String(filters.telegram_id)
          reads.push({table, selected, original: filters.telegram_id})
          const records = conversations.get(selected) ?? []
          return Promise.resolve({data:records, error:opts.conversationError ?? null})
        },
      }
      return builder
    },
  }
  const context = {
    supabaseAdmin:db,
    parseExplicitOpenLoop:(value) => String(value).startsWith('SYNTHETIC_PRIVATE:')
      ? {kind:'followup',title:value,summary:value,priority:0.94} : null,
    upsertOpenLoop:async (input) => {writes.push(input);return {id:'fictional-open-loop'}},
    isoPlusHoursFrom:(date,hours) => new Date(Date.parse(date) + hours*3600_000).toISOString(),
    Date, console,
  }
  const originalFunction = vm.runInNewContext(compiled + '\nsyncConversationSignals', context, {timeout:1000})
  assert.equal(typeof originalFunction, 'function')
  return {reads,writes,run:(telegramId) => originalFunction(telegramId)}
}

let controlPass=0,controlFail=0,mandatoryPass=0,mandatoryFail=0
async function check(name, mandatory, fn) {
  try {
    await fn()
    if(mandatory) mandatoryPass++
    else controlPass++
    console.log('PASS [' + (mandatory?'MANDATORY':'CONTROL') + '] ' + name)
  } catch(e) {
    if(mandatory) mandatoryFail++
    else controlFail++
    console.error('FAIL [' + (mandatory?'MANDATORY':'CONTROL') + '] ' + name + ': ' + (e?.message||e))
  }
}

// Benign cases must all remain green: controls distinguish an actual safety regression from a broken fixture.
await check('canonical safe positive owner creates only its own fictional loop',false,async()=>{
  const h=harness()
  assert.equal(await h.run('42'),1)
  assert.equal(h.writes.length,1)
  assert.equal(h.writes[0].telegramId,'42')
  assert.equal(h.writes[0].sourceRefs[0].id,'fictional-message-42')
  assert.deepEqual(h.reads.map(x=>x.selected),['42','42'])
})
await check('canonical safe negative WhatsApp owner still works',false,async()=>{
  const h=harness({consent:[['-42',{telegram_id:'-42',memory_enabled:true}]],
    conversations:[['-42',[privateConversation('-42')]]]})
  assert.equal(await h.run('-42'),1)
  assert.equal(h.writes[0].telegramId,'-42')
})
await check('explicit memory-disabled consent prevents private conversation read',false,async()=>{
  const h=harness({consent:[['42',{telegram_id:'42',memory_enabled:false}]]})
  assert.equal(await h.run('42'),0)
  assert.equal(h.writes.length,0)
  assert.deepEqual(h.reads.map(x=>x.table),['user_consent_settings'])
})
await check('no conversations means no new open loops',false,async()=>{
  const h=harness({conversations:[]})
  assert.equal(await h.run('42'),0)
  assert.equal(h.writes.length,0)
})
await check('unparseable message does not become a follow-up',false,async()=>{
  const h=harness({conversations:[['42',[{...privateConversation('42'),content:'fictional ordinary hello'}]]]})
  assert.equal(await h.run('42'),0)
  assert.equal(h.writes.length,0)
})
await check('conversation query error fails without writing an open loop',false,async()=>{
  const h=harness({conversationError:{message:'synthetic_read_failure'}})
  await assert.rejects(h.run('42'),/open_loop_conversation_read_failed/)
  assert.equal(h.writes.length,0)
})

// Required privacy gates. Current live-source behavior is expected RED until the reviewed fix.
await check('adjacent signed BIGINT owners may never alias into another owner private conversation',true,async()=>{
  const h=harness({consent:[[A,{telegram_id:A,memory_enabled:true}]],
    conversations:[[A,[privateConversation(A,'A')]]]})
  await h.run(B)
  assert.ok(!h.reads.some(x=>x.selected===A),
    'owner B rounded to owner A before privileged consent/conversation lookup')
  assert.equal(h.writes.length,0,'another owner private message was materialized as owner B loop')
})
await check('already-rounded unsafe numeric owner must fail before all privileged reads',true,async()=>{
  const h=harness()
  await h.run(9007199254740992)
  assert.equal(h.reads.length,0,'unsafe numeric ID crossed privileged DB boundary')
  assert.equal(h.writes.length,0)
})
await check('consent row must prove exact requested owner before private conversation access',true,async()=>{
  const h=harness({consent:[['42',{telegram_id:'99',memory_enabled:true}]]})
  await h.run('42')
  assert.equal(h.reads.filter(x=>x.table==='conversations').length,0,
    'mismatched persisted consent owner allowed private conversation read')
  assert.equal(h.writes.length,0)
})
await check('conversation row must be bound to requested exact owner before upsert',true,async()=>{
  const h=harness({conversations:[['42',[privateConversation('99','wrong-owner')]]]})
  await h.run('42')
  assert.equal(h.writes.length,0,'mismatched private conversation written into target owner open loops')
})
await check('consent read failure may not authorize conversation scan',true,async()=>{
  const h=harness({consentError:{message:'synthetic_permissions_denied'}})
  await h.run('42').catch(()=>{})
  assert.equal(h.reads.filter(x=>x.table==='conversations').length,0,
    'unreadable consent was treated as permission to inspect private conversations')
  assert.equal(h.writes.length,0)
})
await check('fractional owner string must never make privileged requests',true,async()=>{
  const h=harness()
  await h.run('42.5')
  assert.equal(h.reads.length,0,'fractional owner was passed to service-role lookup')
})
await check('scientific-notation owner string must never be normalized into a different owner',true,async()=>{
  const h=harness()
  await h.run('4.2e1')
  assert.equal(h.reads.length,0,'noncanonical owner was coerced to another owner')
})

console.log('OPEN LOOP CONVERSATION EXACT OWNER control PASS=' + controlPass +
  ' FAIL=' + controlFail + '; mandatory PASS=' + mandatoryPass + ' FAIL=' + mandatoryFail)
if(controlFail) process.exitCode=2
else if(mandatoryFail) process.exitCode=1
