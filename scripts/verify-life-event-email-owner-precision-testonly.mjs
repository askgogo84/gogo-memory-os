// TEST ONLY: sealed, fictional accounts. Original life-event Gmail actor resolver;
// no real Google access, push, network, credentials, database, or account operations.
// Expected on unfixed main: benign controls PASS, mandatory owner-isolation checks RED.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const file = 'lib/agent/life-event-email-worker.ts'
const src = readFileSync(file, 'utf8')
const cron = readFileSync('app/api/cron/life-events/route.ts', 'utf8')
const ast = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'resolveActor')
assert.ok(node?.body, 'original life-event email resolveActor missing; do not silently skip safety tests')
const compiled = ts.transpileModule(node.getText(ast), {
  fileName: file,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const EVEN = '9007199254740992'
const ODD = '9007199254740993'
const fixtures = new Map([
  ['42', { id: 'fixture-safe', telegram_id: '42', whatsapp_id: 'whatsapp:+15550000042', name: 'Safe', gmail_connected: true }],
  ['43', { id: 'fixture-unlinked', telegram_id: '43', whatsapp_id: '', name: 'No Gmail', gmail_connected: false }],
  [EVEN, { id: 'fixture-even', telegram_id: EVEN, whatsapp_id: 'whatsapp:+15550000002', name: 'Even', gmail_connected: true }],
  [ODD, { id: 'fixture-odd', telegram_id: ODD, whatsapp_id: 'whatsapp:+15550000003', name: 'Odd', gmail_connected: true }],
])

function harness({ dbError = false, returnedRow = null } = {}) {
  const queries = []
  const db = { from(table) {
    assert.equal(table, 'users', 'no other tables or provider effects expected')
    return { select(columns) {
      assert.equal(columns, 'id,telegram_id,whatsapp_id,name,gmail_connected')
      return { eq(field, value) {
        assert.equal(field, 'telegram_id')
        queries.push({ value })
        return { async maybeSingle() {
          if (dbError) return { data: null, error: { message: 'synthetic_db_unavailable' } }
          const row = returnedRow ?? fixtures.get(String(value)) ?? null
          return { data: row, error: null }
        } }
      } }
    } }
  } }
  const resolve = vm.runInNewContext(compiled + '\nresolveActor', {
    supabaseAdmin: db, Number, String, Error,
  }, { filename: file, timeout: 2000 })
  return { resolve, queries }
}

async function outcome(input, options) {
  const h = harness(options)
  try { return { accepted: await h.resolve(input), error: null, queries: h.queries } }
  catch (e) { return { accepted: null, error: String(e?.message || e), queries: h.queries } }
}

let controlsPass = 0, controlsFail = 0, safetyPass = 0, safetyFail = 0
async function check(kind, label, f) {
  try {
    await f()
    kind === 'control' ? controlsPass++ : safetyPass++
    console.log('PASS ' + kind + ': ' + label)
  } catch (error) {
    kind === 'control' ? controlsFail++ : safetyFail++
    console.error('FAIL ' + kind + ': ' + label + ' — ' + String(error?.message || error).slice(0, 220))
  }
}

await check('control', 'exact safe tenant resolves to its own Gmail-capable actor', async () => {
  const r = await outcome('42')
  assert.equal(r.error, null)
  assert.equal(r.accepted?.userId, 'fixture-safe')
  assert.equal(r.accepted?.whatsappId, 'whatsapp:+15550000042')
  assert.equal(r.accepted?.legacyTelegramId, 42)
})
await check('control', 'unknown tenant fails closed', async () => {
  const r = await outcome('7')
  assert.equal(r.accepted, null)
  assert.match(r.error, /life_event_email_actor_missing/)
})
await check('control', 'unconnected Gmail tenant is rejected', async () => {
  const r = await outcome('43')
  assert.equal(r.accepted, null)
  assert.match(r.error, /workspace_not_connected/)
})
await check('control', 'database failure does not authorize Gmail access', async () => {
  const r = await outcome('42', { dbError: true })
  assert.equal(r.accepted, null)
  assert.match(r.error, /life_event_email_actor_lookup_failed/)
})
await check('control', 'production cron and boarding-pass worker reach this actor before Gmail read', async () => {
  assert.match(cron, /processDueLifeEventEmailWatches\(\)/)
  assert.match(src, /async function processBoardingPassWatch\(/)
  assert.match(src, /const actor = await resolveActor\(telegramId\)/)
  assert.match(src, /searchWorkspaceEmails\(actor,/)
  assert.match(src, /readWorkspaceEmailBrief\(actor,/)
})

await check('mandatory', 'distinct BIGINT tenants never resolve to the same private Gmail actor', async () => {
  const left = await outcome(EVEN), right = await outcome(ODD)
  if (left.accepted && right.accepted) {
    assert.notEqual(left.accepted.userId, right.accepted.userId,
      'two distinct owner strings reached the same Gmail/Workspace user')
  }
})
await check('mandatory', 'odd BIGINT owner must resolve exactly or reject, never select even account', async () => {
  const r = await outcome(ODD)
  if (r.accepted) {
    assert.equal(r.accepted.userId, 'fixture-odd')
    assert.equal(r.accepted.whatsappId, 'whatsapp:+15550000003')
  }
})
await check('mandatory', 'privileged owner lookup may not receive a rounded unsafe JS Number', async () => {
  const r = await outcome(ODD)
  assert.ok(r.queries.every(({ value }) =>
    typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))),
    'unsafe numeric owner reached users.telegram_id lookup')
})
await check('mandatory', 'already-rounded numeric actor input fails closed BEFORE privileged read', async () => {
  const r = await outcome(Number(ODD))
  assert.equal(r.accepted, null, 'already-rounded numeric owner was authorized')
  assert.equal(r.queries.length, 0, 'already-rounded actor was used in privileged lookup')
})
await check('mandatory', 'unsafe numeric owner returned by DB cannot become an authenticated actor', async () => {
  const r = await outcome('42', { returnedRow: {
    id: 'synthetic-wrong-tenant', telegram_id: Number(ODD),
    whatsapp_id: 'whatsapp:+15550000099', name: 'Rounded', gmail_connected: true,
  } })
  assert.equal(r.accepted, null, 'unverifiable unsafe database owner was accepted')
})

console.log('RESULT controls_pass=' + controlsPass + '/5 controls_fail=' + controlsFail +
  ' mandatory_pass=' + safetyPass + '/5 mandatory_fail=' + safetyFail)
if (controlsFail) process.exit(2)
if (safetyFail) process.exit(1)
