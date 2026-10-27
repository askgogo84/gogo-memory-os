// Inert actual-function regression for forwarded-mail push accounting.
// A durable delivery ledger status is not equivalent to a verified send.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const file = new URL('../lib/email/inbound.ts', import.meta.url)
const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const OWNER = 7002
const NOW = Date.parse('2026-10-25T08:00:00Z')
const ACCEPTED = 'provider_accepted'

type Counters = {
  alertUpdates: number
  unverifiedCards: number
  deliverCalls: number
  providerSends: number
  updateOwners: Array<string | number>
}

async function runOne(outcome: string | 'throw', hasPhone = true) {
  const count: Counters = { alertUpdates: 0, unverifiedCards: 0, deliverCalls: 0, providerSends: 0, updateOwners: [] }
  const supabaseAdmin = {
    from(table: string) {
      let op = 'read'
      let selected = ''
      let payload: any
      const filters: Array<[string, unknown]> = []
      const result = () => {
        if (table === 'inbound_emails' && op === 'update' && payload?.notified_at) {
          count.alertUpdates++
          count.updateOwners.push(filters.find(([k]) => k === 'telegram_id')?.[1] as any)
        }
        if (table === 'conversations' && op === 'insert') count.unverifiedCards++
        return {
          data: table === 'inbound_emails' && op === 'upsert' ? [{ id: 'fixture-mail-id' }] : [],
          error: null,
          count: 0,
        }
      }
      const q: any = {
        select: (fields: string) => { selected = fields; return q },
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q },
        gte: () => q,
        lt: () => q,
        upsert: (data: unknown) => { op = 'upsert'; payload = data; return q },
        update: (data: unknown) => { op = 'update'; payload = data; return q },
        insert: (data: unknown) => { op = 'insert'; payload = data; return q },
        delete: () => { op = 'delete'; return q },
        maybeSingle: async () => {
          if (table === 'users' && selected.includes('whatsapp_id')) return { data: { whatsapp_id: hasPhone ? 'whatsapp:+919999999999' : null }, error: null }
          if (table === 'users' && selected.includes('timezone')) return { data: { timezone: 'Asia/Kolkata' }, error: null }
          return { data: null, error: null }
        },
        then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
      }
      return q
    },
  }
  const mail = {
    messageId: '<fixture-msg-1@source.invalid>',
    references: '', inReplyTo: '', from: 'Sender <sender@example.org>',
    to: 'owner-abc123@in.askgogo.in', subject: 'Please approve today',
    text: 'Can you approve this today?', headers: {}, listId: '',
    listUnsubscribe: '', autoSubmitted: '', precedence: '',
  }
  const exportsObj: Record<string, any> = {}
  const mocks: Record<string, any> = {
    'node:crypto': { createHash },
    '@/lib/supabase-admin': { supabaseAdmin },
    '@/lib/whatsapp': { sendWhatsApp: async () => { count.providerSends++; throw Error('provider network forbidden') } },
    '@/lib/services/notification-delivery': {
      deliverNotification: async () => {
        count.deliverCalls++
        if (outcome === 'throw') throw new Error('inert-delivery-error')
        return outcome
      },
    },
    './aliases': {
      aliasFromAddress: (address: string) => address.includes('@in.askgogo.in') ? 'owner-abc123' : null,
      ownerOfAlias: async () => ({ telegramId: OWNER, confirmedAt: '2026-10-22T00:00:00Z' }),
    },
    './mime': {
      parseMail: () => mail,
      previewText: (value: string) => value,
      gmailForwardingConfirmation: () => null,
    },
    './attention': {
      scoreEmail: () => ({ category: 'person', score: 0.98, picked: true }),
      formatAttentionCard: () => 'Fixture alert card',
    },
    './attention-store': { loadRules: async () => [] },
  }
  runInNewContext(compiled, {
    exports: exportsObj,
    require: (name: string) => {
      if (!(name in mocks)) throw new Error('Unexpected import in fixture: ' + name)
      return mocks[name]
    },
    console: { log: () => {}, error: () => {} },
    process: { env: {} }, Date, Intl, Math, JSON, Promise, String, Number, Buffer,
  })
  const response = await exportsObj.processInboundEmail({
    to: 'owner-abc123@in.askgogo.in', raw: 'fixture (not real mail)', now: NOW,
  })
  assert.equal(response.status, 'stored')
  assert.equal(response.telegramId, OWNER)
  assert.equal(response.pushed, outcome === ACCEPTED && hasPhone, 'pushed means provider handoff accepted, not unknown/skipped')
  assert.equal(count.deliverCalls, hasPhone ? 1 : 0, 'single ledger call; never retry unknown outcome')
  assert.equal(count.providerSends, 0, 'no real provider call is permitted in fixture')
  assert.equal(count.alertUpdates, outcome === ACCEPTED && hasPhone ? 1 : 0, 'notified_at only advances on provider acceptance')
  assert.equal(count.unverifiedCards, outcome === ACCEPTED && hasPhone ? 1 : 0, 'no phantom WhatsApp card for nonaccepted outcome')
  if (count.alertUpdates) assert.deepEqual(count.updateOwners, [OWNER], 'notified flag remains bound to exact mail owner')
}

for (const outcome of ['skipped', 'deferred', 'suppressed', 'persistence_failed', 'outcome_unknown', 'failed', 'throw']) {
  await runOne(outcome)
}
await runOne(ACCEPTED)
await runOne(ACCEPTED, false)
console.log('Inbound email notification: nonaccepted/unknown states do not imply push; accepted is owner-bound (offline)')
