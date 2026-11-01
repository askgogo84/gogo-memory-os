#!/usr/bin/env node
/**
 * ISOLATED / TEST-ONLY owner-precision diagnostic.
 * Executes the UNCHANGED watcherActor function extracted from production source.
 * No network, service credentials, customer records, mailbox access or notifications.
 * Mandatory negatives are deliberately red until an independently reviewed fix.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const sourcePath = fileURLToPath(new URL('../lib/agent/watchers.ts', import.meta.url))
const source = readFileSync(sourcePath, 'utf8')
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'watcherActor')
assert.equal(declarations.length, 1, 'extract exactly one unchanged production watcherActor declaration')
const functionText = declarations[0].getText(ast)
assert.match(source, /const telegramId\s*=\s*String\(watcher\.telegram_id\)/, 'Gmail triage uses the watcher owner')
assert.match(source, /const actor\s*=\s*await watcherActor\(telegramId\)/, 'Gmail triage calls this exact resolver')
assert.match(source, /listRecentWorkspaceInbox\(actor,\s*12\)/, 'Gmail triage passes the resolved actor to private inbox reader')

const compiled = ts.transpileModule(
  functionText + '\nexports.watcherActor = watcherActor;\n',
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText

const A = '9007199254740992'
const B = '9007199254740993'
assert.equal(Number(A), Number(B), 'fixture requires two distinct strings that collide as JavaScript Number')
assert.notEqual(A, B)
const row = (telegram_id, userId, whatsappId) => ({
  id: userId, telegram_id, whatsapp_id: whatsappId, name: 'Synthetic',
})
const rowA = row(A, 'fake-owner-a', 'whatsapp:+911111111111')
const rowB = row(B, 'fake-owner-b', 'whatsapp:+912222222222')

// All database operations are intercepted inside this inert, local module VM.
// `forcedRow` deliberately models a mismatched/corrupt read so the resolver must
// verify returned-row owner binding instead of trusting a service-role query alone.
function fixture(rows = [], { forcedRow, error = null } = {}) {
  const queries = []
  const db = {
    from(table) {
      assert.equal(table, 'users', 'resolver may only select fictional users')
      return {
        select(columns) {
          assert.match(columns, /telegram_id/, 'resolver must read persisted owner')
          return {
            eq(column, value) {
              queries.push({ column, value })
              assert.equal(column, 'telegram_id', 'resolver must filter on owner identity')
              return {
                async maybeSingle() {
                  return {
                    data: forcedRow !== undefined
                      ? forcedRow
                      : (rows.find(r => String(r.telegram_id) === String(value)) ?? null),
                    error,
                  }
                },
              }
            },
          }
        },
      }
    },
  }
  const sandbox = {
    supabaseAdmin: db,
    exports: {},
    Number, String, Error, Promise,
  }
  vm.runInNewContext(compiled, sandbox, { timeout: 1000, filename: 'watcherActor.production.vm.js' })
  assert.equal(typeof sandbox.exports.watcherActor, 'function')
  return { resolve: sandbox.exports.watcherActor, queries }
}

const counts = { benignPassed: 0, benignFailed: 0, safetyPassed: 0, safetyFailed: 0 }
async function check(kind, label, fn) {
  try {
    await fn()
    counts[kind === 'benign' ? 'benignPassed' : 'safetyPassed']++
    console.log('PASS', kind.toUpperCase(), label)
  } catch (error) {
    counts[kind === 'benign' ? 'benignFailed' : 'safetyFailed']++
    console.error('FAIL', kind.toUpperCase(), label, '—', error?.message || String(error))
  }
}

await check('benign', 'safe-integer owner resolves its own Gmail actor', async () => {
  const { resolve, queries } = fixture([row('42', 'safe-owner', 'whatsapp:+919999999999')])
  const actor = await resolve('42')
  assert.equal(actor?.userId, 'safe-owner')
  assert.equal(actor?.whatsappId, 'whatsapp:+919999999999')
  assert.equal(queries.length, 1)
})
await check('benign', 'absent user returns null and does not invent an actor', async () => {
  const { resolve } = fixture([])
  assert.equal(await resolve('42'), null)
})
await check('benign', 'database read error fails closed with an exception', async () => {
  const { resolve } = fixture([], { error: { message: 'fixture-read-failed' } })
  await assert.rejects(() => resolve('42'), /email_triage_user_read_failed/)
})
await check('benign', 'missing destination never yields an actor', async () => {
  const { resolve } = fixture([row('42', 'safe-owner', null)])
  assert.equal(await resolve('42'), null)
})
await check('benign', 'actual production source feeds this actor to the inbox reader', async () => {
  assert.match(source, /processInboxTriageWatcher\(watcher:any,now:Date\)/)
  assert.match(source, /listRecentWorkspaceInbox\(actor,\s*12\)/)
})

await check('safety', '64-bit owner B cannot select A Gmail actor', async () => {
  const { resolve } = fixture([rowA, rowB])
  const actor = await resolve(B)
  assert.ok(!actor || actor.userId === rowB.id, 'rounded B selected different owner A')
})
await check('safety', 'owner query preserves exact 64-bit decimal identity', async () => {
  const { resolve, queries } = fixture([rowA, rowB])
  await resolve(B)
  assert.equal(queries.length, 1)
  assert.equal(queries[0].value, B, 'the lookup must not convert exact owner to Number')
})
await check('safety', 'two distinct 64-bit owners cannot resolve to the same actor', async () => {
  const { resolve } = fixture([rowA, rowB])
  const a = await resolve(A)
  const b = await resolve(B)
  assert.ok(!a || !b || a.userId !== b.userId, 'distinct owners share one Gmail actor')
})
await check('safety', 'mismatched returned user row must fail closed', async () => {
  const { resolve } = fixture([], { forcedRow: row('41', 'foreign-owner', 'whatsapp:+913333333333') })
  assert.equal(await resolve('42'), null, 'unbound service-role row became Gmail actor')
})
await check('safety', 'already-rounded unsafe numeric input must be rejected', async () => {
  const { resolve } = fixture([rowA, rowB])
  const actor = await resolve(Number(B))
  assert.equal(actor, null, 'already-aliased JS Number was accepted as an owner')
})
await check('safety', 'unsafe numeric database owner cannot be trusted', async () => {
  const { resolve } = fixture([row(Number(B), 'unsafe-row', 'whatsapp:+914444444444')])
  assert.equal(await resolve(B), null, 'unsafe numeric persisted owner was accepted')
})
await check('safety', 'null persisted owner cannot become number zero', async () => {
  const { resolve } = fixture([], { forcedRow: row(null, 'null-owner', 'whatsapp:+915555555555') })
  assert.equal(await resolve('0'), null, 'null persisted owner became a valid actor')
})
await check('safety', 'scientific-notation alias cannot select somebody else account', async () => {
  const { resolve } = fixture([rowA, rowB])
  assert.equal(await resolve('9.007199254740993e15'), null, 'non-decimal alias selected an actor')
})

console.log('RESULT', JSON.stringify(counts))
if (counts.benignFailed || counts.safetyFailed) process.exitCode = 1
