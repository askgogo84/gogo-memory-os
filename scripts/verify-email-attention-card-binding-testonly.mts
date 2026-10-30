// Independent TEST-ONLY, EXPECTED RED: numbered mail actions must bind to
// the most recent owner-visible card, not merely the newest "shown" DB event.
// Transpiles the actual shipped attention handler. All records, senders, and
// provider/data transports are synthetic; no production tables or network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as attention from '../lib/email/attention.ts'
import * as commands from '../lib/email/attention-commands.ts'

const owner = 7717
const foreignOwner = 8828
const now = Date.now()
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString()

function fixtureFor(name: string, address: string, id: string) {
  const email = {
    id, threadId: id, messageId: id,
    from: name + ' <' + address + '>', to: 'owner@example.test',
    subject: 'Please approve the vendor report',
    snippet: 'Could you review and approve the report by Friday? I need your sign-off.',
    internalDate: now - 10 * 60_000, isUnread: true, source: 'gmail' as const,
  }
  const score = attention.scoreEmail(email, {now})
  assert.equal(score.category, 'person', 'fixture must be an actionable person email')
  assert.equal(score.picked, true, 'fixture should display an actionable email')
  const card = attention.formatAttentionCard({picked: [score], skipped: [], checked: 1}, {now})
  assert.match(card, /^📬 1 email needs you/)
  const item = {
    index: 1, id, threadId: id, messageId: id, from: email.from,
    subject: email.subject, snippet: email.snippet,
    category: score.category, senderEmail: score.senderEmail,
    senderName: score.senderName, why: score.why, ask: score.ask,
    source: 'gmail', score: score.score,
  }
  return {item, card}
}
const ada = fixtureFor('Ada Example', 'ada@example.test', 'a1b2c3d4')
const bea = fixtureFor('Bea Example', 'bea@example.test', 'f1e2d3c4')

type Stored = Record<string, any>
const events: Stored[] = []
const conversations: Stored[] = []
const unexpectedImports: string[] = []
const db = {
  from(table: string) {
    assert.ok(['email_attention_events', 'conversations', 'email_attention_rules'].includes(table),
      'synthetic handler attempted unexpected private table: ' + table)
    const predicates: Array<(row: Stored) => boolean> = []
    let sortColumn: string | null = null
    let ascending = true
    let max = Infinity
    const query: any = {
      select: () => query,
      eq: (key: string, value: unknown) => {
        predicates.push((row: Stored) => row[key] === value)
        return query
      },
      in: (key: string, values: unknown[]) => {
        predicates.push((row: Stored) => values.includes(row[key]))
        return query
      },
      gte: (key: string, value: unknown) => {
        predicates.push((row: Stored) => String(row[key]) >= String(value))
        return query
      },
      order: (key: string, opts: {ascending?: boolean}) => {
        sortColumn = key
        ascending = opts?.ascending !== false
        return query
      },
      limit: (value: number) => { max = value; return query },
      insert: async (row: Stored) => {
        assert.equal(table, 'email_attention_events', 'no real rules, email, or delivery writes')
        events.push({...row, created_at: new Date().toISOString()})
        return {data: null, error: null}
      },
      then: (resolve: (value: unknown) => unknown, reject: (err: unknown) => unknown) => {
        const collection = table === 'email_attention_events' ? events
          : table === 'conversations' ? conversations : []
        const matches = collection.filter(row => predicates.every(predicate => predicate(row)))
        if (sortColumn) matches.sort((a, b) => {
          const sign = String(a[sortColumn!]).localeCompare(String(b[sortColumn!]))
          return ascending ? sign : -sign
        })
        return Promise.resolve({data: matches.slice(0, max), error: null}).then(resolve, reject)
      },
    }
    return query
  },
}

const source = readFileSync('lib/email/attention-store.ts', 'utf8')
const compiled = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
}}).outputText
const shipped: any = {}
runInNewContext(compiled, {
  exports: shipped,
  require: (id: string) => {
    if (id === '@/lib/supabase-admin') return {supabaseAdmin: db}
    if (id === './attention') return attention
    if (id === './attention-commands') return commands
    if (id === '@anthropic-ai/sdk') return {default: class DisabledSyntheticAnthropic {}}
    if (id === '@/lib/security/google-token-crypto') return {decryptGoogleToken: () => ''}
    if (id === '@/lib/services/google-gmail') return {
      fetchGmailAttentionThreads: () => { throw Error('network fixture forbidden') },
      refreshGmailAccessToken: () => { throw Error('network fixture forbidden') },
    }
    unexpectedImports.push(id)
    throw Error('Unmocked private/network import in synthetic test: ' + id)
  },
  console: {log() {}, error() {}, warn() {}},
  Date, Intl, Buffer, URL, process: {env: {}},
}, {filename: 'shipped-email-attention-store.js', timeout: 2000})

assert.equal(typeof shipped.handleEmailAttentionCommand, 'function')
const act = (text: string) => shipped.handleEmailAttentionCommand({
  actor: {legacyTelegramId: owner, timezone: 'Asia/Kolkata'},
  text, polish: async () => 'Thank you for the request. I will review it and get back to you shortly.',
})

function reset() {
  events.length = 0
  conversations.length = 0
}
function shown(telegram_id: number, fixture: typeof ada, minutesAgo: number) {
  events.push({telegram_id, kind: 'shown', created_at: at(minutesAgo),
    payload: {sources: ['gmail'], items: [fixture.item], gmailEmail: 'owner@example.test'}})
}
function visible(fixture: typeof ada, minutesAgo: number) {
  conversations.push({telegram_id: owner, role: 'assistant', created_at: at(minutesAgo), content: fixture.card})
}
function genericAssistant(content: string, minutesAgo: number) {
  conversations.push({telegram_id: owner, role: 'assistant', created_at: at(minutesAgo), content})
}

let positiveControls = 0
let safetyPasses = 0
const safetyFailures: string[] = []
async function control(label: string, fn: () => Promise<void>) {
  await fn()
  positiveControls++
  console.log('PASS positive:', label)
}
async function safety(label: string, fn: () => Promise<void>) {
  try {
    await fn()
    safetyPasses++
    console.log('PASS safety:', label)
  } catch (error: any) {
    safetyFailures.push(label + ': ' + String(error?.message || error))
    console.error('EXPECTED RED safety:', label, String(error?.message || error))
  }
}
function noInvisibleTarget(result: unknown, kind: string) {
  assert.doesNotMatch(JSON.stringify(result ?? null), /bea@example\.test|Bea Example/i,
    'numbered action silently targeted a newer email that the owner never saw')
  assert.equal(events.some(ev => ev.kind === kind && ev.payload?.senderKey === bea.item.senderEmail), false,
    'an event recorded the invisible sender as the numbered action target')
}

await control('real displayed email card binds a normal numbered draft to its visible sender', async () => {
  reset()
  shown(owner, ada, 3)
  visible(ada, 2)
  const result = await act('draft 1')
  assert.match(String(result?.rewrite || ''), /ada@example\.test/)
  assert.doesNotMatch(String(result?.rewrite || ''), /bea@example\.test/)
})
await control('foreign owner newest shown event cannot replace this owner visible email', async () => {
  reset()
  shown(owner, ada, 3)
  visible(ada, 2)
  shown(foreignOwner, bea, 1)
  const result = await act('draft 1')
  assert.match(String(result?.rewrite || ''), /ada@example\.test/)
  assert.equal(events.filter(ev => ev.telegram_id === foreignOwner && ev.kind === 'draft').length, 0)
})

await safety('a newer undelivered shown-event cannot hijack draft 1 from a visible card', async () => {
  reset()
  shown(owner, ada, 3)
  visible(ada, 2)
  // In inbound.ts, a shown event is persisted BEFORE a separately gated send.
  // The newer event can exist without an assistant conversation/card.
  shown(owner, bea, 1)
  const result = await act('draft 1')
  noInvisibleTarget(result, 'draft')
})
await safety('a newer invisible forwarded-mail event cannot hijack remind 1', async () => {
  reset()
  shown(owner, ada, 3)
  visible(ada, 2)
  shown(owner, bea, 1)
  const result = await act('remind 1 tomorrow')
  noInvisibleTarget(result, 'remind')
})
await safety('a failed newest email scan cannot authorize draft 1 against an older card', async () => {
  reset()
  shown(owner, ada, 5)
  genericAssistant("📬 I couldn't read your email just now. I didn't guess. Please try again in a minute.", 1)
  const result = await act('draft 1')
  assert.equal(Boolean(result && typeof result.rewrite === 'string'), false,
    'an email-read failure is not consent to target an older numbered sender')
  assert.equal(events.some(ev => ev.kind === 'draft'), false,
    'failed scan should not create a draft action against an old list')
})
await safety('a latest email-rules view cannot silently revive an older draft 1 card', async () => {
  reset()
  shown(owner, ada, 5)
  genericAssistant('📬 What I flag for you\n\nAlways\n• Mail you said matters', 1)
  const result = await act('draft 1')
  assert.equal(Boolean(result && typeof result.rewrite === 'string'), false,
    'prefix-only assistant gating revived old indexed email without a current card')
  assert.equal(events.some(ev => ev.kind === 'draft'), false)
})

assert.equal(unexpectedImports.length, 0, 'no other provider, database, or network module may be imported')
console.log('Email attention card-binding controls:', positiveControls,
  'safety passes:', safetyPasses, 'safety failures:', safetyFailures.length)
if (safetyFailures.length) {
  console.error(safetyFailures.join('\n'))
  process.exitCode = 1
}
