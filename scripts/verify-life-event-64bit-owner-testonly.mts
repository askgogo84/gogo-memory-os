// Independent source-executed owner-binding safety checks (expected RED on 2026-10-30).
// Runs only against synthetic 64-bit identifiers and stubbed database/mail/browser clients.
// Nothing imports production clients at runtime: the actual shipped TypeScript source is
// transpiled inside an isolated VM and ALL imports are explicit mocked dependencies.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const OWNER_A = '9007199254740992'
const OWNER_B = '9007199254740993'
assert.equal(Number(OWNER_A), Number(OWNER_B), 'synthetic ids must demonstrate the IEEE-754 alias')
const safeName = '123456789'
let positives = 0
let safetyPassed = 0
let safetyFailed = 0

async function positive(name: string, run: () => Promise<void>) {
  await run()
  positives++
  console.log('PASS CONTROL: ' + name)
}
async function safety(name: string, run: () => Promise<void>) {
  try {
    await run()
    safetyPassed++
    console.log('PASS SAFETY: ' + name)
  } catch (error: any) {
    safetyFailed++
    console.error('FAIL SAFETY (expected until repaired): ' + name + ': ' + (error?.message || error))
  }
}

function fakeDb(users: Map<string, any>) {
  const lookups: any[] = []
  let writeCount = 0
  const supabaseAdmin = {
    from(table: string) {
      if (table === 'users') {
        let lookup: unknown = null
        return {
          select(_columns: string) { return this },
          eq(column: string, value: unknown) {
            assert.equal(column, 'telegram_id', 'actor lookup must be by telegram_id')
            lookup = value
            lookups.push({ table, column, value, type: typeof value })
            return this
          },
          async maybeSingle() {
            return { data: users.get(String(lookup)) || null, error: null }
          },
        }
      }
      if (table === 'life_event_actions') {
        return {
          update(_changes: unknown) { writeCount++; return this },
          eq(_column: string, _value: unknown) { return this },
          then(resolve: (arg: unknown) => void, reject: (err: unknown) => void) {
            return Promise.resolve({ error: null }).then(resolve, reject)
          },
        }
      }
      throw new Error('Unexpected table access: ' + table)
    },
  }
  return { supabaseAdmin, lookups, get writeCount() { return writeCount } }
}

function loadShippedModule(file: string, expose: string[], mocks: Record<string, any>) {
  const source = readFileSync(file, 'utf8') + '\nexport { ' + expose.join(', ') + ' };\n'
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: file,
    reportDiagnostics: true,
  })
  const errors = (compiled.diagnostics || []).filter((d: any) => d.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, 'shipped module must transpile cleanly')
  const module = { exports: {} as Record<string, any> }
  const sandbox = {
    module, exports: module.exports, process: { env: {} }, console, Date, URL, Buffer,
    require(name: string) {
      if (!Object.prototype.hasOwnProperty.call(mocks, name)) throw new Error('UNMOCKED IMPORT ' + name)
      return mocks[name]
    },
  }
  runInNewContext(compiled.outputText, sandbox, { filename: file, timeout: 1500 })
  for (const name of expose) assert.equal(typeof module.exports[name], 'function', 'missing function ' + name)
  return module.exports
}

function emailHarness(users: Map<string, any>) {
  const db = fakeDb(users)
  const mailboxReads: Array<{ userId: string, legacyTelegramId: number, query: string }> = []
  const mod = loadShippedModule('lib/agent/life-event-email-worker.ts',
    ['resolveActor', 'processBoardingPassWatch'], {
      '@/lib/supabase-admin': { supabaseAdmin: db.supabaseAdmin },
      './google-workspace-read': {
        async searchWorkspaceEmails(actor: any, query: string) {
          mailboxReads.push({ userId: String(actor.userId), legacyTelegramId: actor.legacyTelegramId, query })
          return { messages: [] }
        },
        async readWorkspaceEmailBrief() { throw new Error('No synthetic messages were provided') },
      },
      './push': { async sendAgentPush() { throw new Error('Unexpected push') } },
    })
  return { db, mod, mailboxReads }
}
function bookingHarness(users: Map<string, any>) {
  const db = fakeDb(users)
  class FakeAnthropic {
    messages = { async create() { throw new Error('Unexpected external model call') } }
  }
  const mod = loadShippedModule('lib/agent/booking-change-worker.ts', ['actorUserId'], {
    '@anthropic-ai/sdk': { __esModule: true, default: FakeAnthropic },
    '@/lib/supabase-admin': { supabaseAdmin: db.supabaseAdmin },
    './secure-ticket-reader': { async readProviderTicketPage() { throw new Error('Unexpected external browser call') } },
    './push': { async sendAgentPush() { throw new Error('Unexpected push') } },
  })
  return { db, mod }
}
function user(id: string, telegramId: string, gmailConnected = true) {
  return { id, telegram_id: telegramId, whatsapp_id: 'whatsapp:+15550000000', name: 'Fixture', gmail_connected: gmailConnected }
}
function actionAndEvent(telegramId: string) {
  const action = { id: 'synthetic-action', life_event_id: 'synthetic-event', telegram_id: telegramId,
    action_key: 'watch-boarding-pass-email', payload_json: { scheduleRevision: 'rev1', confirmationRef: 'SYNTHETIC', flightNo: 'ZZ123' } }
  const event = { id: 'synthetic-event', telegram_id: telegramId, event_type: 'travel', subtype: 'flight',
    start_at: '2030-10-30T10:00:00Z', provider: 'FakeAir', confirmation_ref: 'SYNTHETIC',
    metadata_json: { ticketScheduleRevision: 'rev1' } }
  return { action, event }
}
async function permittedOutcome(call: () => Promise<any>, expectedId: string) {
  try {
    const actor = await call()
    // Only the exact actor is permitted. Fail-closed rejection is also safe.
    assert.ok(actor && String(actor.userId || actor) === expectedId,
      'wrong account actor returned instead of exact owner or fail-closed rejection')
  } catch (err: any) {
    if (/^(life_event_email_actor_missing|invalid_owner_identity|unsafe_owner_identity|owner_not_found)/.test(String(err?.message || ''))) return
    throw err
  }
}

await positive('safe integer Gmail owner is selected exactly', async () => {
  const h = emailHarness(new Map([[safeName, user('safe-user', safeName)]]))
  const actor = await h.mod.resolveActor(safeName)
  assert.equal(actor.userId, 'safe-user')
  assert.equal(h.db.lookups[0].value, Number(safeName))
})
await positive('safe integer mailbox search uses the verified actor and defers no-match', async () => {
  const h = emailHarness(new Map([[safeName, user('safe-user', safeName)]]))
  const { action, event } = actionAndEvent(safeName)
  const result = await h.mod.processBoardingPassWatch(action, event, safeName)
  assert.equal(result.status, 'deferred')
  assert.ok(h.mailboxReads.length > 0)
  assert.ok(h.mailboxReads.every(row => row.userId === 'safe-user'))
})
await positive('disconnected Gmail actor is blocked before a mailbox read', async () => {
  const h = emailHarness(new Map([[safeName, user('safe-user', safeName, false)]]))
  await assert.rejects(() => h.mod.resolveActor(safeName), /workspace_not_connected/)
  assert.equal(h.mailboxReads.length, 0)
})
await positive('safe integer booking browser actor is selected exactly', async () => {
  const h = bookingHarness(new Map([[safeName, user('safe-user', safeName)]]))
  assert.equal(await h.mod.actorUserId(safeName), 'safe-user')
})
await positive('missing booking owner gives no browser credential identity', async () => {
  const h = bookingHarness(new Map())
  assert.equal(await h.mod.actorUserId(safeName), null)
})

const owners = () => new Map([
  [OWNER_A, user('different-person-A', OWNER_A)],
  [OWNER_B, user('intended-person-B', OWNER_B)],
])
await safety('P1: bigint Gmail identity lookup must never return adjacent account', async () => {
  const h = emailHarness(owners())
  await permittedOutcome(() => h.mod.resolveActor(OWNER_B), 'intended-person-B')
})
await safety('P1: one owner boarding-pass watch must never read another owner Gmail', async () => {
  const h = emailHarness(owners())
  const { action, event } = actionAndEvent(OWNER_B)
  try { await h.mod.processBoardingPassWatch(action, event, OWNER_B) }
  catch (err: any) {
    assert.match(String(err?.message || err), /(unsafe_owner_identity|invalid_owner_identity|life_event_email_actor_missing|owner_not_found)/)
  }
  assert.ok(h.mailboxReads.every(row => row.userId === 'intended-person-B'),
    'a source-bound watch used credentials for the wrong user: ' + JSON.stringify(h.mailboxReads.map(x => x.userId)))
})
await safety('P1: booking page credential selector must never alias adjacent bigint owner', async () => {
  const h = bookingHarness(owners())
  const id = await h.mod.actorUserId(OWNER_B)
  assert.ok(id === null || id === 'intended-person-B', 'provider-ticket reader would receive another account userId')
})

console.log('CONTROLS=' + positives + ' SAFETY_PASS=' + safetyPassed + ' SAFETY_FAIL=' + safetyFailed)
if (safetyFailed) process.exitCode = 1
