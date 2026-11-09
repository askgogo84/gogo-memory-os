import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Execute the exact production Gmail reply branch in a sealed synthetic fixture.
// No DB, provider, credentials, network, WhatsApp send or user account is accessed.
const source = readFileSync('lib/feature-intents.ts', 'utf8')
const start = source.indexOf('  if(extra?.telegramId&&isGmailReplyCommand(text)){')
const end = source.indexOf('\n\n  // Explicit list display', start)
assert.ok(start >= 0 && end > start, 'the original Gmail reply branch must remain discoverable')
const originalBranch = source.slice(start, end)
const fixtureSource = [
  'async function fixtureRoute(extra, phone, text) {',
  'const __trace = { mark() {} };',
  originalBranch,
  'return null;',
  '}',
].join('\n')
const js = ts.transpileModule(fixtureSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const UUID_A = '00000000-0000-4000-8000-0000000000a1'
const UUID_B = '00000000-0000-4000-8000-0000000000b2'
const REPLY = 'Reply to the last email saying received'
const OWNER_A = 123
const PHONE_A = 'whatsapp:+919000000123'

function exercise({ owner = OWNER_A, returned = { id: UUID_A, telegram_id: OWNER_A, whatsapp_id: PHONE_A, name: 'Fixture' }, error = null, gmailText = 'fixture Gmail handled' } = {}) {
  const observed = { tables: [], selects: [], predicates: [], queries: 0, calls: [], trace: [] }
  const supabaseAdmin = {
    from(table) {
      observed.tables.push(table)
      assert.equal(table, 'users', 'only the identity row may be queried before entering Gmail specialist')
      observed.queries++
      const chain = {
        select(columns) {
          observed.selects.push(columns)
          assert.ok(!/gmail_(?:access|refresh)_token|gmail_connected|gmail_email/.test(columns), 'no private Gmail columns at identity resolution')
          return chain
        },
        eq(column, value) { observed.predicates.push([column, value]); return chain },
        async maybeSingle() { return { data: returned, error } },
      }
      return chain
    },
  }
  const isGmailReplyCommand = text => String(text).toLowerCase().startsWith('reply to ')
  const tryRunGmailSendCommand = async params => {
    observed.calls.push(params)
    return { text: gmailText }
  }
  const fixtureRoute = new Function('supabaseAdmin', 'isGmailReplyCommand', 'tryRunGmailSendCommand',
    js + '\nreturn fixtureRoute;')(supabaseAdmin, isGmailReplyCommand, tryRunGmailSendCommand)
  return { run: (text = REPLY, extra = { telegramId: owner }, phone = PHONE_A) => fixtureRoute(extra, phone, text), observed }
}
function exactQuery(o, owner) {
  assert.deepEqual(o.tables, ['users'])
  assert.deepEqual(o.predicates, [['telegram_id', String(owner)]], 'lookup must bind exact signed persisted owner')
  assert.equal(o.queries, 1, 'one bounded identity row read')
}

async function main() {
  let checks = 0
  {
    const t = exercise()
    assert.equal(await t.run(), 'fixture Gmail handled')
    exactQuery(t.observed, OWNER_A)
    assert.equal(t.observed.calls.length, 1)
    assert.deepEqual(t.observed.calls[0].actor, {
      userId: UUID_A, legacyTelegramId: OWNER_A, whatsappId: PHONE_A, name: 'Fixture',
    }, 'Gmail actor UUID MUST be the saved user.id, not numeric telegram_id')
    checks++
  }
  {
    const owner = -(2 ** 51 + 123)
    assert.ok(Number.isSafeInteger(owner))
    const t = exercise({ owner, returned: { id: UUID_B, telegram_id: String(owner), whatsapp_id: PHONE_A, name: 'Negative owner' } })
    assert.equal(await t.run(), 'fixture Gmail handled')
    exactQuery(t.observed, owner)
    assert.equal(t.observed.calls[0].actor.legacyTelegramId, owner)
    assert.equal(t.observed.calls[0].actor.userId, UUID_B)
    checks++
  }
  {
    const t = exercise({ returned: { id: UUID_B, telegram_id: 456, whatsapp_id: PHONE_A } })
    assert.match(await t.run(), /could not verify the account/i)
    exactQuery(t.observed, OWNER_A)
    assert.equal(t.observed.calls.length, 0, 'a wrong-tenant UUID must not reach Gmail')
    checks++
  }
  for (const input of [Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1), 123.5, Infinity]) {
    const t = exercise({ owner: input })
    assert.match(await t.run(), /could not verify the account/i)
    assert.equal(t.observed.queries, 0, 'unsafe numeric owner must fail before privileged lookup')
    assert.equal(t.observed.calls.length, 0)
    checks++
  }
  for (const returned of [null, { id: null, telegram_id: OWNER_A }, { id: '', telegram_id: OWNER_A }]) {
    const t = exercise({ returned })
    assert.match(await t.run(), /could not verify the account/i)
    assert.equal(t.observed.calls.length, 0)
    checks++
  }
  {
    const t = exercise({ error: { message: 'fixture-db-outage' } })
    assert.match(await t.run(), /could not verify the account/i)
    assert.equal(t.observed.calls.length, 0)
    checks++
  }
  {
    const t = exercise()
    assert.equal(await t.run('Show my reminders'), null)
    assert.equal(await t.run(REPLY, undefined), 'fixture Gmail handled') // default accepts a valid owner
    checks++
  }
  {
    const t = exercise({ gmailText: '' })
    assert.equal(await t.run(), null, 'specialist decline preserves legacy fallback')
    assert.equal(t.observed.calls.length, 1)
    checks++
  }
  console.log('Legacy Gmail reply UUID owner: ' + checks + ' original-source inert controls passed (no providers or mutation)')
}
main().catch(err => { console.error(err); process.exitCode = 1 })
