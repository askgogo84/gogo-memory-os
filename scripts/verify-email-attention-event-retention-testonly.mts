// Synthetic privacy-retention regression: execute the shipped email-attention persistence path.
// No real users, credentials, network, database, email provider, notifications or destructive I/O.
// EXPECTED RED until private shown-event copies are minimized or independently expired.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const failures: string[] = []
let passed = 0
async function check(name: string, fn: () => unknown) {
  try { await fn(); passed++; console.log('PASS:', name) }
  catch (err) { const msg = String((err as Error)?.message || err); failures.push(name + ': ' + msg); console.error('EXPECTED RED:', name, msg) }
}

const storeSrc = readFileSync('lib/email/attention-store.ts', 'utf8')
const inboundSrc = readFileSync('lib/email/inbound.ts', 'utf8')
const NOW = Date.now()
const DAY = 86400000
const owner = 17
const fakeEmail = {
  id: 'fixture-msg', message_id: '<fixture@example.invalid>', thread_key: 'fixture-thread',
  from_addr: 'Synthetic Person <sender@example.invalid>', to_addr: 'recipient@example.invalid',
  subject: 'Synthetic sensitive project request', snippet: 'Private synthetic example: approve sample budget before Friday.',
  received_at: new Date(NOW - DAY).toISOString(), list_id: null, list_unsubscribe: null,
  auto_submitted: null,
}
type EventRow = { telegram_id: number; kind: string; payload: any; created_at: string }
const storedEvents: EventRow[] = []
const queryEvidence: Array<{ table: string; filters: Array<[string, unknown]> }> = []
const fakeDb = {
  from(table: string) {
    const filters: Array<[string, unknown]> = []
    queryEvidence.push({ table, filters })
    let minDate = ''
    let limit = Infinity
    let orderKey = ''
    let descending = false
    const rows = () => {
      let data: any[] = []
      if (table === 'users') data = [{ telegram_id: owner, gmail_connected: false, gmail_email: null }]
      else if (table === 'user_consent_settings') data = [{ telegram_id: owner, gmail_enabled: false }]
      else if (table === 'inbound_emails') data = [{ ...fakeEmail, telegram_id: owner }]
      else if (table === 'email_aliases') data = [{ telegram_id: owner, alias: 'fixture-01a2b3' }]
      else if (table === 'email_attention_rules') data = []
      else if (table === 'email_attention_events') data = storedEvents.slice()
      else throw new Error('unexpected fake database table: ' + table)
      data = data.filter(row => filters.every(([key, value]) => String(row[key]) === String(value)))
      if (minDate) data = data.filter(row => Date.parse(String(row[orderKey || 'created_at'] || row.received_at || '')) >= Date.parse(minDate))
      if (orderKey) data = [...data].sort((a,b) => (descending ? -1 : 1) * String(a[orderKey]).localeCompare(String(b[orderKey])))
      return data.slice(0, limit)
    }
    const q: any = {
      select: () => q,
      eq: (key: string, value: unknown) => { filters.push([key,value]); return q },
      gte: (key: string, value: string) => { orderKey = key; minDate = value; return q },
      order: (key: string, opts?: { ascending?: boolean }) => { orderKey = key; descending = opts?.ascending === false; return q },
      limit: (n: number) => { limit = n; return q },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      insert: async (row: any) => {
        assert.equal(table, 'email_attention_events', 'only event writes allowed in synthetic run')
        storedEvents.push({ ...row, created_at: new Date(NOW).toISOString() })
        return { error: null }
      },
      then: (resolve: any, reject: any) => Promise.resolve({ data: rows(), error: null }).then(resolve,reject),
    }
    return q
  },
}

const fakeAttention: any = {
  pickAttention: (emails: any[]) => ({
    checked: emails.length, skipped: [],
    picked: emails.map(email => ({
      email, category: 'person', senderEmail: 'sender@example.invalid',
      senderName: 'Synthetic Person', why: 'Needs a decision',
      ask: 'Approve example budget', score: 0.92,
    })),
  }),
  formatAttentionCard: () => '📬 1 synthetic email needs you',
}
const imports: Record<string, any> = {
  '@anthropic-ai/sdk': { default: class UnusedSyntheticAnthropic {} },
  '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
  '@/lib/security/google-token-crypto': { decryptGoogleToken: () => '' },
  '@/lib/services/google-gmail': { fetchGmailAttentionThreads: () => { throw new Error('no provider') }, refreshGmailAccessToken: () => { throw new Error('no provider') } },
  './attention': fakeAttention,
  './attention-commands': { parseAttentionCommand: () => null, isUndo: () => false },
  '@/lib/connectors/composio-gmail': {},
}
const exportsObject: Record<string, any> = {}
const compiled = ts.transpileModule(storeSrc + '\nexports.__testLastShown = lastShown;\n', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
runInNewContext(compiled, {
  exports: exportsObject,
  require: (name: string) => { if (!(name in imports)) throw new Error('non-mocked import: ' + name); return imports[name] },
  console: { error: () => {}, log: () => {} }, Date,
}, { filename: 'inert-email-attention-store.js', timeout: 2000 })

await check('actual shown-event path persists owner-bound synthetic email attention evidence', async () => {
  const result = await exportsObject.buildAttentionCard({ legacyTelegramId: owner, timezone: 'Asia/Kolkata' }, { polish: null })
  assert.equal(result.connected, true)
  assert.equal(storedEvents.length, 1)
  const e = storedEvents[0]
  assert.equal(e.telegram_id, owner)
  assert.equal(e.kind, 'shown')
  assert.equal(e.payload.items[0].subject, fakeEmail.subject)
  assert.equal(e.payload.items[0].snippet, fakeEmail.snippet)
  assert.equal(e.payload.items[0].senderEmail, 'sender@example.invalid')
  assert.equal(e.payload.sources[0], 'forwarded')
})

await check('24-hour numbered follow-up remains exact-owner scoped', async () => {
  const own = await exportsObject.__testLastShown(owner)
  const foreign = await exportsObject.__testLastShown(18)
  assert.equal(own[0].subject, fakeEmail.subject)
  assert.equal(foreign, null)
  const events = queryEvidence.filter(q => q.table === 'email_attention_events')
  assert.ok(events.some(q => q.filters.some(([key,val]) => key === 'telegram_id' && val === 18)))
  assert.ok(events.some(q => q.filters.some(([key,val]) => key === 'telegram_id' && val === owner)))
})

await check('fixture never reads credentials or sends mail/WhatsApp', () => {
  assert.ok(queryEvidence.every(q => ['users','user_consent_settings','inbound_emails','email_aliases','email_attention_rules','email_attention_events'].includes(q.table)))
  assert.ok(queryEvidence.filter(q => q.table === 'inbound_emails').every(q => q.filters.some(([key,val]) => key === 'telegram_id' && val === owner)))
  assert.equal(storedEvents.length, 1)
  assert.equal(storedEvents[0].payload.items[0].source, 'forwarded')
})

function sourceFiles(dir: string): string[] {
  const result: string[] = []
  for (const child of readdirSync(dir)) {
    const full = join(dir, child)
    if (statSync(full).isDirectory()) result.push(...sourceFiles(full))
    else if (/\.(?:ts|tsx|sql)$/.test(child) && !/rollback/i.test(child)) result.push(full)
  }
  return result
}

await check('30-day forwarded-mail retention includes independently expired rich email-attention event copies', () => {
  const rawSubjectsAndSnippets = storedEvents.some(e => e.kind === 'shown' && e.payload?.items?.some((i: any) => i.subject === fakeEmail.subject && i.snippet === fakeEmail.snippet))
  const inboundAlsoPersistsCopy = /from\('email_attention_events'\)\.insert/.test(inboundSrc) && /snippet:\s*email\.snippet/.test(inboundSrc)
  // A fix may choose data minimization at source instead of a periodic purge.
  if (!rawSubjectsAndSnippets && !inboundAlsoPersistsCopy) return
  const files = [...sourceFiles('app/api/cron'), ...sourceFiles('lib/email'), ...sourceFiles('supabase/migrations')]
  const candidates = files.filter(f => {
    const body = readFileSync(f, 'utf8')
    return /email_attention_events/.test(body) && (
      (/\.delete\(\)/.test(body) && /created_at/.test(body)) ||
      (/delete\s+from\s+(?:public\.)?email_attention_events/i.test(body) && /created_at/i.test(body))
    )
  })
  const crons = sourceFiles('app/api/cron').map(f => readFileSync(f, 'utf8')).join('\n')
  const independentlyScheduled = candidates.some(f =>
    f.startsWith('app/api/cron/') ||
    crons.includes(f.replace(/^lib\//,'@/lib/').replace(/\.ts$/,'')) ||
    (f.endsWith('.sql') && /cron\.schedule/i.test(readFileSync(f,'utf8')))
  )
  assert.equal(independentlyScheduled, true,
    'shown event contains private subject/snippet, including forwarded copies, but no independently scheduled expiry of email_attention_events is wired; dormant-owner content outlives the stated 30-day forwarded-mail period')
})

console.log('Controls passed:', passed, 'Intended safety failures:', failures.length)
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
}
