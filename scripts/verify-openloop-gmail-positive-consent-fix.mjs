// DRAFT-only Gmail affirmative-consent regression against original source.
// Run the actual private readGmailAttention function in a sealed synthetic VM.
// NO real Google, OAuth, Supabase, WhatsApp, credentials, network or customer data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const sourceFile = 'lib/agent/open-loops.ts'
const source = readFileSync(sourceFile, 'utf8')
const ast = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'readGmailAttention')
assert.ok(fn?.body, 'the original Gmail attention function is missing; fail rather than skip')
const compiled = ts.transpileModule(fn.getText(ast), {
  fileName: sourceFile,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

// JavaScript Number loses the least significant digit of ODD.
const EVEN = '9007199254740992'
const ODD = '9007199254740993'
const users = new Map([
  ['42', { telegram_id: '42', gmail_connected: true, gmail_email: 'safe42@example.test', gmail_refresh_token: 'fake-refresh-42', gmail_access_token: 'fake-access-42' }],
  ['43', { telegram_id: '43', gmail_connected: false, gmail_email: '', gmail_refresh_token: null, gmail_access_token: null }],
  ['44', { telegram_id: '44', gmail_connected: true, gmail_email: 'disabled44@example.test', gmail_refresh_token: 'fake-refresh-44', gmail_access_token: null }],
  [EVEN, { telegram_id: EVEN, gmail_connected: true, gmail_email: 'even@example.test', gmail_refresh_token: 'fake-refresh-even', gmail_access_token: null }],
  [ODD, { telegram_id: ODD, gmail_connected: true, gmail_email: 'odd@example.test', gmail_refresh_token: 'fake-refresh-odd', gmail_access_token: null }],
])
const consents = new Map([
  ['42', { telegram_id: '42', gmail_enabled: true }],
  ['43', { telegram_id: '43', gmail_enabled: true }],
  ['44', { telegram_id: '44', gmail_enabled: false }],
  [EVEN, { telegram_id: EVEN, gmail_enabled: true }],
  [ODD, { telegram_id: ODD, gmail_enabled: true }],
])

function harness({ userError = false, consentError = false, oddConsentDisabled = false, overrideUser = null, overrideConsent = undefined } = {}) {
  const queries = [], refreshes = [], reads = []
  const fakeDb = {
    from(table) {
      assert.ok(table === 'users' || table === 'user_consent_settings', 'unexpected table/side effect')
      return { select(columns) {
        assert.ok(
          table === 'users'
            ? columns.includes('gmail_refresh_token') && columns.includes('gmail_access_token')
            : columns.includes('gmail_enabled'),
          'original Gmail/consent projection missing; inspect changed trust boundary',
        )
        return { eq(field, value) {
          assert.equal(field, 'telegram_id')
          queries.push({ table, field, value })
          return { async maybeSingle() {
            if (table === 'users' && userError) return { data: null, error: { message: 'fixture_user_db_down' } }
            if (table === 'user_consent_settings' && consentError) return { data: null, error: { message: 'fixture_consent_db_down' } }
            const owner = String(value)
            const data = table === 'users'
              ? (overrideUser ?? users.get(owner) ?? null)
              : (overrideConsent !== undefined ? overrideConsent : oddConsentDisabled && owner === ODD ? { telegram_id: ODD, gmail_enabled: false } : consents.get(owner) ?? null)
            return { data, error: null }
          } }
        } }
      } }
    },
  }
  const read = vm.runInNewContext(compiled + '\nreadGmailAttention', {
    supabaseAdmin: fakeDb,
    decryptGoogleToken: value => String(value || ''),
    refreshGmailAccessToken: async token => {
      refreshes.push(String(token))
      return 'temporary-access-for:' + String(token)
    },
    fetchGmailAttentionThreads: async (token, limit) => {
      assert.equal(limit, 12)
      reads.push(String(token))
      return [{ id: 'fixture-thread:' + String(token), messages: [] }]
    },
    Number, String, Error, Promise,
  }, { filename: sourceFile, timeout: 2500 })
  return { read, queries, refreshes, reads }
}

async function outcome(owner, options) {
  const h = harness(options)
  try {
    const result = await h.read(owner)
    return { result, error: null, queries: h.queries, refreshes: h.refreshes, reads: h.reads }
  } catch (e) {
    return { result: null, error: String(e?.message || e), queries: h.queries, refreshes: h.refreshes, reads: h.reads }
  }
}

let controlsPass = 0, controlsFail = 0, safetyPass = 0, safetyFail = 0
async function check(kind, label, run) {
  try {
    await run()
    kind === 'control' ? controlsPass++ : safetyPass++
    console.log('PASS ' + kind + ': ' + label)
  } catch (e) {
    kind === 'control' ? controlsFail++ : safetyFail++
    console.error('FAIL ' + kind + ': ' + label + ' — ' + String(e?.message || e).slice(0, 240))
  }
}

// Benign, positive controls: prove this is the original function, not broken fixtures.
await check('control', 'safe authenticated tenant returns only its own fake Gmail context', async () => {
  const r = await outcome('42')
  assert.equal(r.error, null)
  assert.equal(r.result?.ownEmail, 'safe42@example.test')
  assert.equal(r.result?.threads?.[0]?.id, 'fixture-thread:temporary-access-for:fake-refresh-42')
  assert.deepEqual(r.refreshes, ['fake-refresh-42'])
})
await check('control', 'disconnected Gmail is not read', async () => {
  const r = await outcome('43')
  assert.equal(r.result?.reason, 'disconnected')
  assert.equal(r.refreshes.length, 0)
  assert.equal(r.reads.length, 0)
})
await check('control', 'explicitly disabled Gmail consent blocks reads', async () => {
  const r = await outcome('44')
  assert.equal(r.result?.reason, 'disabled')
  assert.equal(r.refreshes.length, 0)
  assert.equal(r.reads.length, 0)
})
await check('control', 'unknown tenant cannot yield a Gmail token', async () => {
  const r = await outcome('999')
  assert.equal(r.result?.reason, 'disconnected')
  assert.equal(r.refreshes.length, 0)
})
await check('control', 'user lookup failure fails closed without fetching Gmail', async () => {
  const r = await outcome('42', { userError: true })
  assert.match(r.error, /open_loop_gmail_user_failed/)
  assert.equal(r.reads.length, 0)
})
await check('control', 'consent lookup failure fails closed without fetching Gmail', async () => {
  const r = await outcome('42', { consentError: true })
  assert.match(r.error, /open_loop_gmail_consent_failed/)
  assert.equal(r.reads.length, 0)
})
await check('control', 'existing user-request and open-loop sync source paths reach Gmail attention', async () => {
  assert.match(source, /export async function handleInboxReplyRead\(/)
  assert.match(source, /readGmailAttention\(String\(params\.actor\.legacyTelegramId\)\)/)
  assert.match(source, /export async function syncOpenLoopsForUser\(/)
  assert.match(source, /gmailPromise\?\?=readGmailAttention\(tg\)/)
  assert.match(source, /syncGmailAttention\(tg,current,gmailOnce\)/)
})

// Mandatory negative tests. On original code these must FAIL and keep the PR blocked.
await check('mandatory', 'distinct 64-bit owners cannot share one Gmail token/thread identity', async () => {
  const a = await outcome(EVEN), b = await outcome(ODD)
  if (!a.reads.length || !b.reads.length) return // A safe fail-closed fix is valid.
  assert.notEqual(a.reads[0], b.reads[0], 'distinct tenants selected the same Gmail OAuth account')
})
await check('mandatory', 'odd 64-bit owner may only use its own Gmail OAuth token, or fail closed', async () => {
  const r = await outcome(ODD)
  if (!r.reads.length) return
  assert.equal(r.refreshes[0], 'fake-refresh-odd', 'another tenant\'s refresh token used')
  assert.equal(r.result?.ownEmail, 'odd@example.test', 'another tenant\'s mailbox identity selected')
})
await check('mandatory', 'privileged users lookup never receives an unsafe rounded Number owner', async () => {
  const r = await outcome(ODD)
  const q = r.queries.filter(q => q.table === 'users')
  assert.ok(q.every(({ value }) => typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))),
    'users table lookup received an imprecise JS Number owner')
})
await check('mandatory', 'Gmail consent lookup never receives an unsafe rounded Number owner', async () => {
  const r = await outcome(ODD)
  const q = r.queries.filter(q => q.table === 'user_consent_settings')
  assert.ok(q.every(({ value }) => typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))),
    'consent table lookup received an imprecise JS Number owner')
})
await check('mandatory', 'disabled odd owner cannot inherit enabled even owner consent', async () => {
  const r = await outcome(ODD, { oddConsentDisabled: true })
  assert.equal(r.refreshes.length, 0, 'wrong owner\'s enabled consent permitted OAuth refresh')
  assert.equal(r.reads.length, 0, 'wrong owner\'s enabled consent permitted Gmail read')
  assert.ok(r.result?.reason === 'disabled' || r.error, 'did not deny owner-disabled Gmail read')
})
await check('mandatory', 'already-rounded unsafe numeric input fails closed before any privileged read', async () => {
  const r = await outcome(Number(ODD))
  assert.equal(r.queries.length, 0, 'already-rounded owner reached privileged DB')
  assert.equal(r.refreshes.length, 0, 'already-rounded owner reached OAuth')
  assert.equal(r.reads.length, 0, 'already-rounded owner reached Gmail')
})
await check('mandatory', 'returned wrong-owner token row fails owner binding before OAuth read', async () => {
  const r = await outcome('42', { overrideUser: {
    telegram_id: '999', gmail_connected: true, gmail_email: 'other@example.test',
    gmail_refresh_token: 'fake-refresh-other', gmail_access_token: null,
  } })
  assert.equal(r.refreshes.length, 0, 'nonmatching owner row authorized OAuth refresh')
  assert.equal(r.reads.length, 0, 'nonmatching owner row authorized Gmail read')
})


// Additional mandatory safeguards for the ACTUAL serving positive-consent hole.
// NULL/missing consent is not affirmative permission to refresh/read a mailbox.
await check('mandatory', 'missing consent row prohibits refresh and private Gmail read', async () => {
  const r = await outcome('42', { overrideConsent: null })
  assert.equal(r.result?.reason, 'disabled')
  assert.equal(r.refreshes.length, 0)
  assert.equal(r.reads.length, 0)
})
await check('mandatory', 'NULL gmail_enabled is NOT opt-in', async () => {
  const r = await outcome('42', { overrideConsent: { telegram_id: '42', gmail_enabled: null } })
  assert.equal(r.result?.reason, 'disabled')
  assert.equal(r.refreshes.length, 0)
  assert.equal(r.reads.length, 0)
})
await check('mandatory', 'unproven consent owner cannot authorize Gmail', async () => {
  const r = await outcome('42', { overrideConsent: { gmail_enabled: true } })
  assert.equal(r.result?.reason, 'disabled')
  assert.equal(r.refreshes.length, 0)
  assert.equal(r.reads.length, 0)
})
await check('mandatory', 'wrong tenant consent even when enabled must not authorize own OAuth tokens', async () => {
  const r = await outcome('42', { overrideConsent: { telegram_id: '43', gmail_enabled: true } })
  assert.equal(r.result?.reason, 'disabled')
  assert.equal(r.refreshes.length, 0)
  assert.equal(r.reads.length, 0)
})
await check('mandatory', 'already-rounded returned consent owner must not authorize adjacent bigint tenant', async () => {
  const r = await outcome(ODD, { overrideConsent: { telegram_id: Number(ODD), gmail_enabled: true } })
  assert.equal(r.result?.reason, 'disabled')
  assert.equal(r.refreshes.length, 0)
  assert.equal(r.reads.length, 0)
})
await check('mandatory', 'missing returned token-row owner must not authorize OAuth refresh', async () => {
  const r = await outcome('42', { overrideUser: {
    gmail_connected: true, gmail_email: 'not-proven@example.test',
    gmail_refresh_token: 'fake-secret-no-owner', gmail_access_token: null,
  } })
  assert.equal(r.result?.reason, 'disconnected')
  assert.equal(r.refreshes.length, 0)
  assert.equal(r.reads.length, 0)
})
await check('mandatory', 'truthy string consent is not affirmative BOOLEAN grant', async () => {
  const r = await outcome('42', { overrideConsent: { telegram_id: '42', gmail_enabled: 'true' } })
  assert.equal(r.result?.reason, 'disabled')
  assert.equal(r.refreshes.length, 0)
  assert.equal(r.reads.length, 0)
})

console.log('RESULT controls_pass=' + controlsPass + '/7 controls_fail=' + controlsFail +
  ' mandatory_pass=' + safetyPass + '/14 mandatory_fail=' + safetyFail)
if (controlsFail) process.exit(2)
if (safetyFail) process.exit(1)
