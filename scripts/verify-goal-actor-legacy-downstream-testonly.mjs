// TEST ONLY — sealed synthetic owner-precision regression for the real goal actor.
// No customer data, secrets, Supabase connection, agent dispatch, Workspace API,
// WhatsApp provider, bookings or external network actions are performed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const goalPath = 'lib/agent/goal-engine.ts'
const source = readFileSync(goalPath, 'utf8')
const sameBrain = readFileSync('lib/agent/same-brain.ts', 'utf8')
const ast = ts.createSourceFile(goalPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const actorDeclaration = ast.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'actorForTelegram')
assert.ok(actorDeclaration?.body, 'real actorForTelegram function must be found; do not silently skip')
const compiled = ts.transpileModule(actorDeclaration.getText(ast), {
  fileName: goalPath,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const EVEN = '9007199254740992'
const ODD = '9007199254740993'
const users = new Map([
  ['42', { id: 'uuid-42', telegram_id: '42', whatsapp_id: 'whatsapp:+15550000042', name: 'Fictional 42' }],
  ['43', { id: 'uuid-43', telegram_id: '43', whatsapp_id: 'whatsapp:+15550000043', name: 'Fictional 43' }],
  ['44', { id: 'uuid-44', telegram_id: '44', whatsapp_id: '', name: 'No verified channel' }],
  [EVEN, { id: 'uuid-even', telegram_id: EVEN, whatsapp_id: 'whatsapp:+15550000192', name: 'Fictional Even' }],
  [ODD, { id: 'uuid-odd', telegram_id: ODD, whatsapp_id: 'whatsapp:+15550000193', name: 'Fictional Odd' }],
])

function harness({ overrideRow, dbError = false } = {}) {
  const queries = []
  const fakeDb = { from(table) {
    assert.equal(table, 'users', 'no other privileged table is allowed in this test')
    return { select(fields) {
      assert.equal(fields, 'id,telegram_id,whatsapp_id,name')
      return { eq(field, value) {
        assert.equal(field, 'telegram_id')
        queries.push({ field, value })
        return { async maybeSingle() {
          return dbError
            ? { data: null, error: { message: 'synthetic_unavailable' } }
            : { data: overrideRow === undefined ? users.get(String(value)) ?? null : overrideRow, error: null }
        } }
      } }
    } }
  } }
  const resolve = vm.runInNewContext(compiled + '\nactorForTelegram', {
    supabaseAdmin: fakeDb, Number, String, Promise, Error,
  }, { filename: goalPath, timeout: 2500 })
  return { resolve, queries }
}
async function resolve(owner, options = {}) {
  const h = harness(options)
  const actor = await h.resolve(owner)
  return { actor, queries: h.queries }
}
let controlsPassed = 0, controlsFailed = 0, mandatoryPassed = 0, mandatoryFailed = 0
async function check(group, label, fn) {
  try {
    await fn()
    if (group === 'control') controlsPassed++
    else mandatoryPassed++
    console.log('PASS ' + group + ': ' + label)
  } catch (e) {
    if (group === 'control') controlsFailed++
    else mandatoryFailed++
    console.error('FAIL ' + group + ': ' + label + ' — ' + String(e?.message || e).slice(0, 320))
  }
}

// Benign controls demonstrate the harness actually executes existing source.
await check('control', 'safe user 42 keeps its UUID, number and notification owner', async () => {
  const { actor, queries } = await resolve('42')
  assert.equal(actor?.userId, 'uuid-42')
  assert.equal(actor?.legacyTelegramId, 42)
  assert.equal(actor?.whatsappId, 'whatsapp:+15550000042')
  assert.equal(queries.length, 1)
  assert.equal(queries[0].value, 42)
})
await check('control', 'safe distinct user 43 keeps its own actor', async () => {
  const { actor } = await resolve('43')
  assert.equal(actor?.userId, 'uuid-43')
  assert.equal(actor?.legacyTelegramId, 43)
})
await check('control', 'unknown user produces no actor', async () => {
  const { actor } = await resolve('999')
  assert.equal(actor, null)
})
await check('control', 'database failure does not authorize a synthetic actor', async () => {
  const { actor } = await resolve('42', { dbError: true })
  assert.equal(actor, null)
})
await check('control', 'wrong row is rejected even for a representable owner', async () => {
  const { actor } = await resolve('42', { overrideRow: users.get('43') })
  assert.equal(actor, null)
})
await check('control', 'missing verified WhatsApp cannot dispatch', async () => {
  const { actor } = await resolve('44')
  assert.equal(actor, null)
})
await check('control', 'high 64-bit lookup preserves the correct UUID and recipient', async () => {
  const { actor, queries } = await resolve(ODD)
  // Fail-closed is also safe; if an actor exists, neither UUID nor recipient may alias.
  if (actor) {
    assert.equal(actor.userId, 'uuid-odd')
    assert.equal(actor.whatsappId, 'whatsapp:+15550000193')
  }
  assert.ok(queries.every(({ value }) => typeof value !== 'number' || Number.isSafeInteger(value)))
})
await check('control', 'real private-action callsite and token-bearing downstream owner query exist', async () => {
  assert.match(source, /const actor=await actorForTelegram\(tg\)/)
  assert.match(source, /dispatchThroughSameBrain\(\{internalStep:true,actor,text:step\.instruction/)
  assert.match(sameBrain, /async function disconnectWorkspace\(actor:AgentActor\)/)
  assert.match(sameBrain, /\.eq\('telegram_id',actor\.legacyTelegramId\)/)
  assert.match(sameBrain, /gmail_access_token,gmail_refresh_token/)
})

// On every approved source fix, these negatives MUST be green. Current deployed
// source constructs a rounded numeric legacy owner even after an exact DB match.
function assertActorIdentityExact(owner, actor) {
  if (!actor) return // refusing unrepresentable owners before all private actions is safe
  const legacy = actor.legacyTelegramId
  assert.ok(typeof legacy === 'string' || (typeof legacy === 'number' && Number.isSafeInteger(legacy)),
    'AgentActor contains an unsafe rounded numeric legacy owner')
  assert.equal(String(legacy), owner,
    'AgentActor legacy owner differs from the exact approved/watch owner')
}
await check('mandatory', 'odd 64-bit owner never dispatches a rounded legacy account id', async () => {
  const { actor } = await resolve(ODD)
  assertActorIdentityExact(ODD, actor)
})
await check('mandatory', 'even 64-bit owner never emits an unsafe numeric legacy owner', async () => {
  const { actor } = await resolve(EVEN)
  assertActorIdentityExact(EVEN, actor)
})
await check('mandatory', 'distinct 64-bit owners never share a Same Brain legacy tenant id', async () => {
  const [a, b] = await Promise.all([resolve(EVEN), resolve(ODD)])
  if (a.actor && b.actor)
    assert.notEqual(String(a.actor.legacyTelegramId), String(b.actor.legacyTelegramId),
      'two different exact owners share a rounded downstream agent identity')
})
await check('mandatory', 'high owner input that resolves exact row still cannot yield wrong private-token key', async () => {
  const { actor, queries } = await resolve(ODD)
  assert.ok(queries.every(({ value }) => typeof value === 'string' || Number.isSafeInteger(value)))
  assertActorIdentityExact(ODD, actor)
})

console.log('RESULT controls_pass=' + controlsPassed + '/8 controls_fail=' + controlsFailed +
  ' mandatory_pass=' + mandatoryPassed + '/4 mandatory_fail=' + mandatoryFailed)
if (controlsFailed) process.exit(2) // fixture/source-control failure, not security evidence
if (mandatoryFailed) process.exit(1) // mandatory production safety is RED
