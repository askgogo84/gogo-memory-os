// TEST ONLY: run the unchanged approved-browser owner resolver with fictional users.
// No providers, browsers, accounts, messages, credentials, or production I/O.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path = 'lib/agent/approved-browser-worker.ts'
const source = readFileSync(path, 'utf8')
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const node = ast.statements.find(x => ts.isFunctionDeclaration(x) && x.name?.text === 'actorForTelegramId')
assert.ok(node?.body, 'original actorForTelegramId definition must be present')
const original = node.getText(ast).replace(/^export\s+/, '')
const js = ts.transpileModule(original, {
  fileName: path,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

// Reachability guards: both approved execution and background resume resolve this actor;
// they pass it to a private browser command and can send the result to its WhatsApp target.
assert.ok(source.includes('actorForTelegramId(String(run.telegram_id))'), 'approved-run callsite absent')
assert.ok(source.includes('actorForTelegramId(String(claimed.telegram_id))'), 'background-read callsite absent')
assert.ok(source.includes('executeApprovedBrowserCommand({ actor, runId: String(run.id) })'), 'approved browser execution absent')
assert.ok(source.includes('sendWhatsApp(actor.whatsappId, outcome)'), 'outcome notification target absent')

const even = {
  id: 'synthetic-even-owner', telegram_id: '9007199254740992',
  whatsapp_id: 'whatsapp:+15550000002', name: 'Even',
}
const odd = {
  id: 'synthetic-odd-owner', telegram_id: '9007199254740993',
  whatsapp_id: 'whatsapp:+15550000003', name: 'Odd',
}
function fixture({ users = [even, odd], lookupError = null } = {}) {
  const queries = []
  const logs = []
  const fakeDb = {
    from(table) {
      assert.equal(table, 'users', 'test forbids all other database tables')
      return {
        select(columns) {
          assert.equal(columns, 'id,telegram_id,whatsapp_id,name')
          return {
            eq(column, value) {
              assert.equal(column, 'telegram_id')
              queries.push({ column, value })
              return {
                async maybeSingle() {
                  if (lookupError) return { data: null, error: { message: lookupError } }
                  // Simulate an exact Postgres BIGINT comparison to the serialized query.
                  // Deliberately do NOT round stored IDs: the two owners stay different.
                  return {
                    data: users.find(row => String(row.telegram_id) === String(value)) || null,
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
  const resolve = vm.runInNewContext(js + '\nactorForTelegramId', {
    supabaseAdmin: fakeDb,
    Number,
    String,
    console: { error: (...xs) => { logs.push(xs.map(String).join(' ')) } },
  }, { filename: path, timeout: 2000 })
  assert.equal(typeof resolve, 'function')
  return { resolve, queries, logs }
}

let controlPass = 0, controlFail = 0, mandatoryPass = 0, mandatoryFail = 0
async function check(kind, label, test) {
  try {
    await test()
    if (kind === 'control') controlPass++
    else mandatoryPass++
    console.log('PASS ' + kind + ': ' + label)
  } catch (e) {
    if (kind === 'control') controlFail++
    else mandatoryFail++
    console.error('FAIL ' + kind + ': ' + label + ' — ' + String(e?.message || e).slice(0, 250))
  }
}

await check('control', 'safe decimal owner resolves its own UUID and WhatsApp recipient', async () => {
  const f = fixture({ users: [{ id: 'synthetic-safe-42', telegram_id: '42', whatsapp_id: 'whatsapp:+15550000042', name: 'Safe' }] })
  const actor = await f.resolve('42')
  assert.equal(actor?.userId, 'synthetic-safe-42')
  assert.equal(actor?.whatsappId, 'whatsapp:+15550000042')
  assert.equal(actor?.legacyTelegramId, 42)
  assert.equal(f.queries.length, 1)
})
await check('control', 'missing owner returns null', async () => {
  const f = fixture({ users: [] })
  assert.equal(await f.resolve('42'), null)
})
await check('control', 'database lookup error fails without selecting actor', async () => {
  const f = fixture({ lookupError: 'synthetic_unavailable' })
  assert.equal(await f.resolve('42'), null)
  assert.ok(f.logs.some(s => s.includes('APPROVED_BROWSER_ACTOR_FAILED')))
})
await check('control', 'invalid nonnumeric owner cannot select account', async () => {
  const f = fixture()
  assert.equal(await f.resolve('not-an-owner'), null)
})
await check('control', 'incomplete persisted row is not converted to actor', async () => {
  const f = fixture({ users: [{ id: null, telegram_id: '42', whatsapp_id: 'whatsapp:+15550000042', name: 'Absent' }] })
  assert.equal(await f.resolve('42'), null)
})

await check('mandatory', 'unsafe odd BIGINT never selects a different owner browser actor', async () => {
  const f = fixture()
  const actor = await f.resolve('9007199254740993')
  assert.ok(actor === null || actor.userId === odd.id, 'odd owner resolved to another account: ' + actor?.userId)
})
await check('mandatory', 'two distinct BIGINT owners never resolve to the same live actor', async () => {
  const f = fixture()
  const first = await f.resolve(even.telegram_id)
  const second = await f.resolve(odd.telegram_id)
  assert.ok(!(first?.userId && first.userId === second?.userId), 'distinct owners shared browser actor UUID')
})
await check('mandatory', 'unsafe rounded numbers never reach privileged owner query', async () => {
  const f = fixture()
  await f.resolve(odd.telegram_id)
  assert.ok(f.queries.every(q => typeof q.value !== 'number' || Number.isSafeInteger(q.value)),
    'service-role query used an unsafe rounded numeric owner')
})
await check('mandatory', 'already-rounded numeric caller fails closed before database access', async () => {
  const f = fixture()
  assert.equal(await f.resolve(9007199254740993), null, 'unsafe number picked an actor')
  assert.equal(f.queries.length, 0, 'unsafe number reached privileged lookup')
})
await check('mandatory', 'unsafe numeric database row cannot become an authenticated actor', async () => {
  const f = fixture({ users: [{
    id: 'synthetic-rounded-row', telegram_id: 9007199254740992,
    whatsapp_id: 'whatsapp:+15550000002', name: 'Rounded',
  }] })
  assert.equal(await f.resolve('9007199254740992'), null,
    'rounded numeric DB owner accepted without exact proof')
})

console.log('RESULT controls_pass=' + controlPass + '/5 controls_fail=' + controlFail +
  ' mandatory_pass=' + mandatoryPass + '/5 mandatory_fail=' + mandatoryFail)
if (controlFail) process.exit(2)
if (mandatoryFail) process.exit(1)
