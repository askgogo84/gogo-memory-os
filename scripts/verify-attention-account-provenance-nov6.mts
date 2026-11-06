// Two connected Gmail mailboxes: prove source mailbox survives into the ORIGINAL attention store's
// shown/open path and own-sent secondary mail never becomes a false incoming task.
// Inert DB + Gmail mocks only; no user records, live Google APIs, sends, or external side effects.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as attention from '../lib/email/attention.ts'
import * as commands from '../lib/email/attention-commands.ts'

const owner = 123456789
const primary = 'first@example.test'
const work = 'second@work.example.test'
const now = Date.now()
const messages = {
  'tok-primary': [
    { id: '111aaa', threadId: 'abcdef', from: 'Alex <alex@example.test>', to: primary,
      subject: 'Approve the first vendor invoice', snippet: 'Could you approve the first invoice by tomorrow?',
      internalDate: now, isUnread: true },
  ],
  'tok-work': [
    { id: '222bbb', threadId: 'abcdef', from: 'Blair <blair@example.test>', to: work,
      subject: 'Approve the work vendor contract', snippet: 'Please approve the work vendor contract by tomorrow.',
      internalDate: now, isUnread: true },
    { id: '333ccc', threadId: 'abc123', from: 'Me <SECOND@WORK.EXAMPLE.TEST>', to: 'sam@example.test',
      subject: 'Please approve my proposal', snippet: 'Can you sign off on my proposal by Friday?',
      internalDate: now, isUnread: true },
  ],
}
const inserted: Array<{ kind: string; payload: any }> = []
let cardText = ''
const tables: Record<string, any> = {
  users: { gmail_connected: true, gmail_email: primary, gmail_access_token: 'tok-primary', gmail_refresh_token: '' },
  user_consent_settings: { gmail_enabled: true },
  email_aliases: null,
}
const db = {
  from(table: string) {
    const filters: Record<string, any> = {}
    const q: any = {
      select() { return q },
      eq(k: string, v: any) { filters[k] = v; return q },
      gte() { return q },
      order() { return q },
      limit() { return q },
      insert(row: any) {
        assert.equal(table, 'email_attention_events')
        assert.equal(row.telegram_id, owner)
        inserted.push({ kind: row.kind, payload: row.payload })
        return Promise.resolve({ error: null })
      },
      async maybeSingle() { return { data: tables[table] ?? null, error: null } },
      then(resolve: any, reject: any) {
        assert.equal(filters.telegram_id, owner, 'all service reads must stay owner scoped')
        let data: any[] = []
        if (table === 'email_attention_events') {
          const kind = filters.kind
          data = inserted.filter(e => !kind || e.kind === kind).map(e => ({ payload: e.payload, created_at: new Date(now).toISOString() })).reverse()
        } else if (table === 'conversations') {
          data = [{ content: cardText, created_at: new Date(now).toISOString() }]
        } else if (table === 'email_attention_rules') {
          data = []
        } else if (table === 'inbound_emails') {
          data = []
        } else {
          throw Error('unmocked table read: ' + table)
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject)
      },
    }
    return q
  },
}

const deps: Record<string, any> = {
  '@anthropic-ai/sdk': { default: class {} },
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/security/google-token-crypto': { decryptGoogleToken: (x: any) => String(x || '') },
  '@/lib/services/google-gmail': {
    refreshGmailAccessToken: async () => { throw Error('unexpected real refresh') },
    fetchGmailAttentionThreads: async (token: keyof typeof messages) => {
      assert.ok(token in messages, 'only synthetic local mailbox tokens may be used')
      return messages[token].map(m => ({ id: m.threadId, messages: [m] }))
    },
  },
  '@/lib/agent/gmail-accounts': {
    listExtraGmailAccounts: async (id: number) => {
      assert.equal(id, owner)
      return [{ id: 'work-fixture', email: work, accessToken: 'tok-work', refreshToken: '' }]
    },
  },
  './attention': attention,
  './attention-commands': commands,
}
const code = ts.transpileModule(readFileSync('lib/email/attention-store.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const exported: Record<string, any> = {}
runInNewContext(code, {
  exports: exported, module: { exports: exported },
  require(name: string) {
    if (name in deps) return deps[name]
    throw Error('unexpected dependency: ' + name)
  },
  process, console, Date, String, Set, Map, Number, RegExp, Promise, URL, URLSearchParams,
  setTimeout, clearTimeout,
})

// The ORIGINAL production read must retain source identity despite colliding Gmail-local thread IDs.
const read = await exported.readAttentionSources(owner)
assert.equal(read.connected, true)
assert.equal(read.emails.length, 2, 'outgoing secondary work mail is NOT a new incoming task')
assert.deepEqual(read.emails.map((e: any) => [e.id, e.gmailAccount]).sort(), [
  ['111aaa', primary], ['222bbb', work],
])
assert.equal(read.repliedSenders.has('sam@example.test'), true, 'outgoing work email still boosts replied sender')
const picked = attention.pickAttention(read.emails, { ownEmail: read.ownEmail })
assert.equal(picked.picked.length, 2, 'different accounts with same thread ID remain separate')
console.log('PASS original multi-account read: isolated sources, self-authored secondary mail excluded')

// Verify the actual shown-card persistence and the original numbered OPEN command.
const actor = { legacyTelegramId: owner, timezone: 'Asia/Kolkata' } as any
const shown = await exported.buildAttentionCard(actor, { polish: null })
assert.equal(shown.connected, true)
cardText = shown.text
const event = inserted.find(e => e.kind === 'shown')
assert.ok(event)
assert.equal(event!.payload.items.length, 2)
assert.deepEqual(new Set(event!.payload.items.map((i: any) => i.gmailAccount)), new Set([primary, work]))
assert.equal(event!.payload.gmailEmail, primary, 'legacy outer primary field remains untouched')
for (const item of event!.payload.items) {
  const response = await exported.handleEmailAttentionCommand({ actor, text: 'open ' + item.index })
  assert.ok(response && 'text' in response)
  const account = encodeURIComponent(item.gmailAccount)
  assert.match(response.text, new RegExp('authuser=' + account + '#all/abcdef'))
  assert.doesNotMatch(response.text, /authuser=undefined|authuser=null/)
}
console.log('PASS original shown/open: each email link uses its OWN connected mailbox')

// Older cards from before source provenance must omit a possibly wrong deep link.
const item = event!.payload.items[0]
delete item.gmailAccount
const legacy = await exported.handleEmailAttentionCommand({ actor, text: 'open ' + item.index })
assert.ok(legacy && 'text' in legacy)
assert.doesNotMatch(legacy.text, /mail\.google\.com|authuser=/, 'legacy card must fail closed, not guess first mailbox')
console.log('PASS legacy card: no unsafe guessed mailbox link')
console.log('Attention account provenance regressions passed')
