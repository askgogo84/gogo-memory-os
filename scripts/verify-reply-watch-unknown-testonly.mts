/**
 * TEST ONLY, EXPECTED RED. Issue #274, unresolved #1096 P2 reply-watch review.
 *
 * Execute the REAL shipped latestEmailFrom() (transpiled in isolation) with
 * synthetic owner/consent/Gmail rows. Does NOT contact Gmail, Supabase, Claude,
 * Resend, WhatsApp, or the cron endpoint. Does NOT perform a real send.
 *
 * Objective: a 30-INBOX-only slice or unavailable Gmail cannot prove no reply.
 * The cron must not turn an inconclusive/null read into "hasn't replied".
 * No application files or npm test registration are changed by this draft.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

type FakeMail = { from: string; subject: string; internalDate: number; date: string }
const owner = 42
let connected = true
let consentEnabled = true
let inbox: FakeMail[] = []
let fetchThrows = false
let fetchCalls: number[] = []
let total = 0
let fails = 0

const supabaseAdmin = {
  from(table: string) {
    if (!['users', 'user_consent_settings'].includes(table)) {
      throw new Error('unexpected fake table')
    }
    const q = {
      select(_projection: string) { return q },
      eq(field: string, id: unknown) {
        if (field !== 'telegram_id' || String(id) !== String(owner)) {
          throw new Error('owner isolation violated in fake query')
        }
        return q
      },
      async maybeSingle() {
        if (table === 'user_consent_settings') {
          return { data: { gmail_enabled: consentEnabled }, error: null }
        }
        return { data: {
          gmail_connected: connected,
          gmail_email: 'owner@example.invalid',
          gmail_access_token: 'INERT_FAKE_TOKEN_NO_PROVIDER',
          gmail_refresh_token: '',
        }, error: null }
      },
    }
    return q
  },
}
const fakes: Record<string, unknown> = {
  '@/lib/supabase-admin': { supabaseAdmin },
  '@/lib/google-gmail': {
    buildGmailConnectUrl: () => { throw Error('unexpected connect URL') },
    refreshGmailAccessToken: async () => { throw Error('unexpected token refresh') },
    fetchUnreadEmails: async () => { throw Error('unexpected unread fetch') },
    fetchLatestEmails: async (accessToken: string, limit: number) => {
      if (accessToken !== 'INERT_FAKE_TOKEN_NO_PROVIDER') {
        throw Error('unexpected access token')
      }
      fetchCalls.push(limit)
      if (fetchThrows) throw Error('synthetic temporary Gmail read failure')
      return inbox.slice(0, limit)
    },
  },
  '@/lib/security/google-token-crypto': {
    decryptGoogleToken: (v: unknown) => String(v || ''),
  },
  '@/lib/agent/google-workspace-read': {
    formatEmailSnippet: (s: string) => s,
    redactEmailAuthSecrets: (s: string) => s,
  },
}
function fakeRequire(key: string) {
  if (!Object.hasOwn(fakes, key)) throw Error('unexpected module dependency: ' + key)
  return fakes[key]
}

const source = readFileSync(resolve(process.cwd(), 'lib/bot/handlers/gmail-read.ts'), 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
  fileName: 'lib/bot/handlers/gmail-read.ts',
}).outputText
const mod: { exports: Record<string, unknown> } = { exports: {} }
new Function('require', 'module', 'exports', transpiled)(fakeRequire, mod, mod.exports)
const shipped = mod.exports.latestEmailFrom as (
  ownerId: number, name: string, sinceIso: string
) => Promise<unknown>
if (typeof shipped !== 'function') throw Error('actual latestEmailFrom export missing')

const since = '2026-10-28T00:00:00.000Z'
const when = '2026-10-28T06:00:00.000Z'
const mail = (from: string, subject = 'Synthetic reply'): FakeMail => ({
  from, subject, internalDate: Date.parse(when), date: when,
})
const alice = mail('Alice <alice@example.invalid>')
const bob = mail('Bob <bob@example.invalid>', 'Unrelated')

function setup(rows: FakeMail[] = [], enabled = true, isConnected = true) {
  inbox = rows
  consentEnabled = enabled
  connected = isConnected
  fetchThrows = false
  fetchCalls = []
}
async function check(label: string, fn: () => Promise<void> | void) {
  total++
  try {
    await fn()
    console.log('PASS ' + label)
  } catch {
    fails++
    console.log('FAIL ' + label + ' (assertion not met; all values synthetic)')
  }
}

// Controls prove the real function and fake owner/Gmail boundary are exercised.
await check('control: visible qualifying reply yields source evidence', async () => {
  setup([bob, alice])
  const result = await shipped(owner, 'Alice', since) as { subject: string } | null
  assert.equal(result?.subject, 'Synthetic reply')
  assert.deepEqual(fetchCalls, [30])
})
await check('control: older-than-request reply does not count as a confirmed reply', async () => {
  setup([alice])
  const result = await shipped(owner, 'Alice', '2026-10-29T00:00:00.000Z')
  assert.equal(result, null)
})
await check('control: actual Gmail read error remains an error rather than no-reply', async () => {
  setup()
  fetchThrows = true
  await assert.rejects(shipped(owner, 'Alice', since))
})

// Expected RED: the reply exists in the synthetic mailbox but is omitted from
// the latest-30 INBOX view. The actual function returns null, and cron currently
// treats null as definite "hasn't replied". Safe behavior must be inconclusive.
await check('P2: reply at inbox position 31 must not be pronounced absent', async () => {
  setup([...Array.from({ length: 30 }, () => bob), alice])
  const result = await shipped(owner, 'Alice', since)
  assert.notEqual(result, null, 'bounded inbox view is not an exhaustive no-reply proof')
})
await check('P2: archived reply must not be pronounced absent', async () => {
  const allMail = [alice] // intentionally excluded from synthetic INBOX view
  setup([bob])
  assert.equal(allMail.length, 1)
  const result = await shipped(owner, 'Alice', since)
  assert.notEqual(result, null, 'archived reply not present in inbox slice')
})
await check('P2: disabled Gmail consent must not be labelled no-reply', async () => {
  setup([], false, true)
  const result = await shipped(owner, 'Alice', since)
  assert.notEqual(result, null, 'no authorized Gmail read is not negative evidence')
  assert.deepEqual(fetchCalls, [])
})
await check('P2: disconnected Gmail must not be labelled no-reply', async () => {
  setup([], true, false)
  const result = await shipped(owner, 'Alice', since)
  assert.notEqual(result, null, 'no connected Gmail account is not negative evidence')
  assert.deepEqual(fetchCalls, [])
})
await check('P2: cron must not infer a definitive absence from null', () => {
  const cron = readFileSync(resolve(process.cwd(), 'app/api/cron/reminders/route.ts'), 'utf8')
  assert.ok(cron.includes("else if (name && got === null)"), 'guard: cron source changed; inspect new flow')
  assert.ok(!cron.includes("hasn't replied to your last email yet"),
    'a null from a bounded Gmail read cannot justify a definitive no-reply claim')
})

console.log('Reply-watch evidence boundary: ' + (total - fails) + '/' + total +
  ' checks passed; ' + fails + ' intentional RED safety checks; fake-only')
if (fails) process.exitCode = 1
