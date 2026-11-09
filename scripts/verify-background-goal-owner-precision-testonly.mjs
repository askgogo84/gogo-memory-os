// TEST ONLY: execute the unchanged production background-goal actor resolver in a sealed,
// fictional database. Expected mandatory safety RED until reviewed application remediation.
// No real Supabase, agents, WhatsApp, Google, browser, credentials or customer data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const sourceFile = 'lib/agent/goal-engine.ts'
const source = readFileSync(sourceFile, 'utf8')
const ast = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'actorForTelegram')
assert.ok(fn?.body, 'the original goal actor resolver is missing; inspect changed source, never skip')
const compiled = ts.transpileModule(fn.getText(ast), {
  fileName: sourceFile,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const EVEN = '9007199254740992'
const ODD = '9007199254740993'
const users = new Map([
  ['42', { id: 'uuid-safe-42', telegram_id: '42', whatsapp_id: 'whatsapp:+15550000042', name: 'Safe 42' }],
  ['43', { id: 'uuid-safe-43', telegram_id: '43', whatsapp_id: 'whatsapp:+15550000043', name: 'Safe 43' }],
  ['44', { id: 'uuid-no-whatsapp', telegram_id: '44', whatsapp_id: '', name: 'No channel' }],
  [EVEN, { id: 'uuid-even', telegram_id: EVEN, whatsapp_id: 'whatsapp:+15550000192', name: 'Fictional Even' }],
  [ODD, { id: 'uuid-odd', telegram_id: ODD, whatsapp_id: 'whatsapp:+15550000193', name: 'Fictional Odd' }],
])

function harness({ dbError = false, overrideRow = undefined } = {}) {
  const queries = []
  const db = { from(table) {
    assert.equal(table, 'users', 'unexpected privileged table')
    return { select(columns) {
      assert.equal(columns, 'id,telegram_id,whatsapp_id,name', 'unexpected identity projection')
      return { eq(column, value) {
        assert.equal(column, 'telegram_id')
        queries.push({ column, value })
        return { async maybeSingle() {
          if (dbError) return { data: null, error: { message: 'fictional_database_unavailable' } }
          return { data: overrideRow !== undefined ? overrideRow : (users.get(String(value)) ?? null), error: null }
        } }
      } }
    } }
  } }
  const resolve = vm.runInNewContext(compiled + '\nactorForTelegram', {
    supabaseAdmin: db, Number, String, Error, Promise,
  }, { filename: sourceFile, timeout: 2500 })
  return { resolve, queries }
}

async function outcome(owner, options = {}) {
  const h = harness(options)
  let actor = null, error = null
  try { actor = await h.resolve(owner) } catch (err) { error = String(err?.message || err) }
  return { actor, error, queries: h.queries }
}

let controlsPass = 0, controlsFail = 0, safetyPass = 0, safetyFail = 0
async function check(kind, label, run) {
  try {
    await run()
    if (kind === 'control') controlsPass++
    else safetyPass++
    console.log('PASS ' + kind + ': ' + label)
  } catch (err) {
    if (kind === 'control') controlsFail++
    else safetyFail++
    console.error('FAIL ' + kind + ': ' + label + ' — ' + String(err?.message || err).slice(0, 250))
  }
}

// Positive controls keep safety failures attributable to actual source, not a faulty fixture.
await check('control', 'safe decimal owner 42 selects its own fictional actor', async () => {
  const r = await outcome('42')
  assert.equal(r.error, null)
  assert.equal(r.actor?.userId, 'uuid-safe-42')
  assert.equal(r.actor?.legacyTelegramId, 42)
  assert.equal(r.actor?.whatsappId, 'whatsapp:+15550000042')
  assert.equal(r.queries.length, 1)
})
await check('control', 'separate safe owner 43 selects its own actor', async () => {
  const r = await outcome('43')
  assert.equal(r.actor?.userId, 'uuid-safe-43')
  assert.equal(r.actor?.legacyTelegramId, 43)
})
await check('control', 'unknown safe owner cannot produce a goal actor', async () => {
  const r = await outcome('999')
  assert.equal(r.actor, null)
})
await check('control', 'database read failure denies resolution', async () => {
  const r = await outcome('42', { dbError: true })
  assert.equal(r.actor, null)
})
await check('control', 'owner missing verified WhatsApp routing cannot produce a goal actor', async () => {
  const r = await outcome('44')
  assert.equal(r.actor, null)
})
await check('control', 'non-finite owner input is rejected', async () => {
  const r = await outcome('not-an-id')
  assert.equal(r.actor, null)
  assert.equal(r.queries.length, 0)
})
await check('control', 'real goal watcher reaches actor, Same Brain private action and owner WhatsApp', async () => {
  assert.match(source, /export async function processGoalReviewWatcher\(/)
  assert.match(source, /const tg=String\(watcher\.telegram_id\)/)
  assert.match(source, /const actor=await actorForTelegram\(tg\)/)
  assert.match(source, /dispatchThroughSameBrain\(\{internalStep:true,actor,text:step\.instruction/)
  assert.match(source, /await notify\(actor,/)
  assert.match(source, /if\(!safePrivate\)/)
})

// All mandatory negatives must be GREEN on a source fix; RED blocks this diagnostic PR.
await check('mandatory', 'two distinct 64-bit goal owners never resolve the same private actor', async () => {
  const even = await outcome(EVEN), odd = await outcome(ODD)
  if (even.actor && odd.actor) {
    assert.notEqual(even.actor.userId, odd.actor.userId, 'two different owners resolved the same private actor')
    assert.notEqual(even.actor.whatsappId, odd.actor.whatsappId, 'cross-owner WhatsApp recipient collision')
  }
})
await check('mandatory', 'odd 64-bit goal owner resolves only itself or fails closed', async () => {
  const r = await outcome(ODD)
  if (!r.actor) return
  assert.equal(r.actor.userId, 'uuid-odd', 'background private action would run for the other tenant')
  assert.equal(r.actor.whatsappId, 'whatsapp:+15550000193', 'background notification routed to another tenant')
})
await check('mandatory', 'privileged user lookup never receives an imprecise JS Number owner', async () => {
  const r = await outcome(ODD)
  assert.ok(r.queries.every(({value}) => typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))),
    'service-role owner query received an unsafe rounded Number')
})
await check('mandatory', 'already-rounded numeric input must fail closed before privileged lookup', async () => {
  const r = await outcome(Number(ODD))
  assert.equal(r.queries.length, 0, 'already rounded legacy owner was trusted for privileged lookup')
  assert.equal(r.actor, null)
})
await check('mandatory', 'a mismatched returned user row cannot authorize a private goal action', async () => {
  const r = await outcome('42', { overrideRow: users.get('43') })
  assert.equal(r.actor, null, 'unverified row returned another account actor')
})
await check('mandatory', 'unsafe numeric owner returned by database fails closed', async () => {
  const r = await outcome('42', { overrideRow: {
    id: 'uuid-untrusted', telegram_id: Number(ODD), whatsapp_id: 'whatsapp:+15550000193', name: 'Unsafe',
  } })
  assert.equal(r.actor, null, 'an already-rounded database BIGINT was accepted in an AgentActor')
})
await check('mandatory', 'noncanonical alternate numeric representations cannot bind to other accounts', async () => {
  const r = await outcome('4.2e1')
  assert.equal(r.queries.length, 0, 'scientific notation reached privileged identity lookup')
  assert.equal(r.actor, null, 'scientific notation selected another account')
})

console.log('RESULT controls_pass=' + controlsPass + '/7 controls_fail=' + controlsFail +
  ' mandatory_pass=' + safetyPass + '/7 mandatory_fail=' + safetyFail)
if (controlsFail) process.exit(2)
if (safetyFail) process.exit(1)
