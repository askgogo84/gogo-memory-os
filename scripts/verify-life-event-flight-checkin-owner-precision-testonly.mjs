// INERT TEST ONLY: execute the original flight check-in actor resolver against fictional owners.
// Mandatory privacy assertions are intentionally RED on unchanged source. Never merge/deploy as a fix.
// No real DB, Vault, browser session, provider, PNR, email, account, notification or booking operations.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const sourceFile = 'lib/agent/life-event-worker.ts'
const source = readFileSync(sourceFile, 'utf8')
const route = readFileSync('app/api/cron/life-events/route.ts', 'utf8')
const ast = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const original = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'resolveActor')
assert.ok(original?.body, 'original flight check-in actor resolver missing: stop and inspect')
const javascript = ts.transpileModule(original.getText(ast), {
  fileName: sourceFile,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const EVEN = '9007199254740992'
const ODD = '9007199254740993'
const users = new Map([
  ['42', { id: 'uuid-42', telegram_id: '42', whatsapp_id: 'whatsapp:+15550000042', name: 'Fictional 42' }],
  ['43', { id: 'uuid-43', telegram_id: '43', whatsapp_id: 'whatsapp:+15550000043', name: 'Fictional 43' }],
  [EVEN, { id: 'uuid-even', telegram_id: EVEN, whatsapp_id: 'whatsapp:+15550000192', name: 'Fictional even' }],
  [ODD, { id: 'uuid-odd', telegram_id: ODD, whatsapp_id: 'whatsapp:+15550000193', name: 'Fictional odd' }],
])

function sandbox({ dbError = false, overrideRow } = {}) {
  const queries = []
  const supabaseAdmin = {
    from(table) {
      assert.equal(table, 'users', 'unexpected privileged table in resolver')
      return {
        select(columns) {
          assert.equal(columns, 'id,telegram_id,whatsapp_id,name', 'unexpected identity projection')
          return {
            eq(column, value) {
              assert.equal(column, 'telegram_id', 'unexpected owner predicate')
              queries.push(value)
              return {
                async maybeSingle() {
                  if (dbError) return { data: null, error: { message: 'synthetic-db-denied' } }
                  return {
                    data: overrideRow !== undefined ? overrideRow : (users.get(String(value)) ?? null),
                    error: null,
                  }
                },
              }
            },
          }
        },
      }
    },
  }
  const resolve = vm.runInNewContext(javascript + '\nresolveActor', {
    supabaseAdmin, Number, String, Promise, console: { error() {} },
  }, { filename: sourceFile, timeout: 2500 })
  return { resolve, queries }
}
async function run(owner, options = {}) {
  const h = sandbox(options)
  let actor = null
  let error = null
  try { actor = await h.resolve(owner) } catch (e) { error = String(e?.message || e) }
  return { actor, error, queries: h.queries }
}

let controlsPass = 0, controlsFail = 0, mandatoryPass = 0, mandatoryFail = 0
async function check(kind, label, task) {
  try {
    await task()
    if (kind === 'control') controlsPass++
    else mandatoryPass++
    console.log('PASS ' + kind + ': ' + label)
  } catch (e) {
    if (kind === 'control') controlsFail++
    else mandatoryFail++
    console.error('FAIL ' + kind + ': ' + label + ' — ' + String(e?.message || e).slice(0, 300))
  }
}

// Benign controls distinguish a real reproduced source defect from a broken test fixture.
await check('control', 'normal owner 42 resolves its own fictional browser actor', async () => {
  const result = await run('42')
  assert.equal(result.error, null)
  assert.equal(result.actor?.userId, 'uuid-42')
  assert.equal(result.actor?.legacyTelegramId, 42)
  assert.equal(result.actor?.whatsappId, 'whatsapp:+15550000042')
  assert.equal(result.queries.length, 1)
})
await check('control', 'normal owner 43 resolves independently', async () => {
  const result = await run('43')
  assert.equal(result.error, null)
  assert.equal(result.actor?.userId, 'uuid-43')
  assert.equal(result.actor?.legacyTelegramId, 43)
})
await check('control', 'unknown owner fails closed', async () => {
  const result = await run('999')
  assert.equal(result.actor, null)
  assert.match(String(result.error), /life_event_actor_missing/)
})
await check('control', 'database failure cannot fabricate a browser actor', async () => {
  const result = await run('42', { dbError: true })
  assert.equal(result.actor, null)
  assert.match(String(result.error), /life_event_actor_lookup_failed/)
})
await check('control', 'unparseable owner has no actor', async () => {
  const result = await run('unparseable-owner')
  assert.equal(result.actor, null)
  assert.match(String(result.error), /life_event_actor_missing/)
})
await check('control', 'real cron executes this resolver before browser draft carrying PNR', async () => {
  assert.match(route, /processDueLifeEventActions\(\)/)
  assert.match(source, /export async function prepareFlightCheckin/)
  assert.match(source, /const actor = await resolveActor\(telegramId\)/)
  assert.match(source, /runSecureBrowser\(\{[\s\S]*?userId:\s*actor\.userId/)
  assert.match(source, /mode:\s*'draft'/)
  assert.match(source, /Booking reference\/PNR:/)
  assert.match(source, /attachSecondaryAuthHandoff\(\{userId:actor\.userId,telegramId/)
})

// Mandatory controls must all pass in a separately reviewed source correction.
// Rejecting unsafe historic owner input is permitted; selecting another tenant is not.
await check('mandatory', 'odd 64-bit flight owner never chooses even owner browser', async () => {
  const result = await run(ODD)
  if (!result.actor) return
  assert.equal(result.actor.userId, 'uuid-odd', 'wrong-account browser sandbox')
  assert.equal(result.actor.whatsappId, 'whatsapp:+15550000193', 'wrong identity at handoff')
})
await check('mandatory', 'two distinct 64-bit owners never share the same browser actor', async () => {
  const a = await run(EVEN)
  const b = await run(ODD)
  if (a.actor && b.actor) assert.notEqual(a.actor.userId, b.actor.userId, 'cross-owner collision')
})
await check('mandatory', 'privileged users lookup never receives rounded unsafe JS integer', async () => {
  const result = await run(ODD)
  assert.ok(result.queries.every(v => typeof v === 'string' || (typeof v === 'number' && Number.isSafeInteger(v))),
    'unsafe rounded number sent to service-role lookup')
})
await check('mandatory', 'already-rounded numeric owner cannot reach privileged lookup', async () => {
  const result = await run(Number(ODD))
  assert.equal(result.queries.length, 0, 'rounded owner queried the users table')
  assert.equal(result.actor, null)
})
await check('mandatory', 'mismatched DB user row cannot select another owners browser', async () => {
  const result = await run('42', { overrideRow: users.get('43') })
  assert.equal(result.actor, null, 'actor selected without exact returned-row owner verification')
})
await check('mandatory', 'unsafe numeric 64-bit owner returned from DB must fail closed', async () => {
  const unsafe = { id: 'uuid-unsafe', telegram_id: Number(ODD),
    whatsapp_id: 'whatsapp:+15550000193', name: 'Fictional unsafe' }
  const result = await run('42', { overrideRow: unsafe })
  assert.equal(result.actor, null, 'already-rounded DB owner became privileged browser actor')
})
await check('mandatory', 'scientific-notation owner alias must fail closed', async () => {
  const result = await run('4.2e1')
  assert.equal(result.queries.length, 0, 'noncanonical owner was used in privileged lookup')
  assert.equal(result.actor, null)
})

console.log('RESULT controls_pass=' + controlsPass + '/6 controls_fail=' + controlsFail +
  ' mandatory_pass=' + mandatoryPass + '/7 mandatory_fail=' + mandatoryFail)
if (controlsFail) process.exit(2)
if (mandatoryFail) process.exit(1)
