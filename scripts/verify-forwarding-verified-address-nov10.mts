// red #1119 companion: forwarding turns "on" only against the address recorded from Gmail's confirmation email, and
// stays "not confirmed" (never active) when the forwarding_verified_address migration has not been applied.
// Runs the real lib/email/inbound.ts, lib/email/aliases.ts and lib/email/mime.ts against an in-memory fake DB.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import * as nodeCrypto from 'node:crypto'
import ts from 'typescript'
import * as mime from '../lib/email/mime'

process.env.EMAIL_INBOUND_DOMAIN = 'in.askgogo.in'
const ALIAS = 'divya-k7q2mx'
const ADDR = `${ALIAS}@in.askgogo.in`
const OWNER = 7001

function load(path: string, deps: Record<string, any>) {
  const module: any = { exports: {} }
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  runInNewContext(code, { module, exports: module.exports, console: { ...console, error: () => {} }, process, Date, Intl, Promise, JSON, String, Number, Boolean, Error, Buffer, BigInt, Object, Array, RegExp,
    require: (n: string) => { if (!(n in deps)) throw new Error(`unexpected require ${n}`); return deps[n] } })
  return module.exports
}

function makeDb(opts: { migrated: boolean; row: Record<string, any> }) {
  const row = { alias: ALIAS, telegram_id: String(OWNER), last_received_at: null, forwarding_confirmed_at: null, ...(opts.migrated ? { forwarding_verified_address: null } : {}), ...opts.row }
  const log: any[] = []
  const missing = { code: '42703', message: 'column email_aliases.forwarding_verified_address does not exist' }
  const db = {
    log, row,
    rpc: async () => ({ data: null, error: null }),
    from(table: string) {
      const q: any = { _cols: '', _op: 'select', _payload: null }
      const result = async () => {
        if (table === 'email_aliases') {
          const wantsNew = /forwarding_verified_address/.test(q._cols) || (q._payload && 'forwarding_verified_address' in q._payload)
          if (wantsNew && !opts.migrated) return { data: null, error: missing }
          if (q._op === 'update') { Object.assign(row, q._payload); log.push(['update', { ...q._payload }]); return { data: null, error: null } }
          const picked: any = {}
          for (const c of q._cols.split(',')) if (c in row) picked[c] = (row as any)[c]
          return { data: picked, error: null }
        }
        if (table === 'inbound_emails' && q._op === 'upsert') return { data: [{ id: 'e1' }], error: null }
        if (table === 'users') return { data: { whatsapp_id: '+919900000001', timezone: 'Asia/Kolkata' }, error: null }
        return { data: null, error: null, count: 0 }
      }
      Object.assign(q, {
        select: (c: string) => { if (q._op === 'select') q._cols = c; return q },
        eq: () => q, lt: () => q, gte: () => q, order: () => q, limit: () => q,
        update: (p: any) => { q._op = 'update'; q._payload = p; return q },
        upsert: () => { q._op = 'upsert'; return q },
        insert: () => { q._op = 'insert'; return Promise.resolve({ error: null }) },
        delete: () => { q._op = 'delete'; return q },
        maybeSingle: result, single: result,
        then: (a: any, b: any) => result().then(a, b),
      })
      return q
    },
  }
  return db
}

function modules(db: any) {
  const notices: string[] = []
  const aliases = load('lib/email/aliases.ts', { 'node:crypto': nodeCrypto, '@/lib/supabase-admin': { supabaseAdmin: db } })
  const inbound = load('lib/email/inbound.ts', {
    'node:crypto': nodeCrypto, '@/lib/supabase-admin': { supabaseAdmin: db }, '@/lib/whatsapp': { sendWhatsApp: async () => ({ sid: 'SM1' }) },
    '@/lib/services/notification-delivery': { deliverNotification: async (p: any) => { notices.push(p.key); return 'provider_accepted' } },
    './aliases': aliases, './mime': mime,
    './attention': { scoreEmail: () => ({ category: 'update', score: 0.05, picked: false }), formatAttentionCard: () => '' },
    './attention-store': { loadRules: async () => [] },
  })
  return { aliases, inbound, notices }
}

const confirmationRaw = (to = ADDR, subject = '(#482917365) Gmail Forwarding Confirmation - Receive Mail from divya.real@gmail.com') => [
  'From: Gmail Team <forwarding-noreply@google.com>', `To: ${to}`, `Subject: ${subject}`, 'Message-ID: <confirm-1@google.com>',
  'Content-Type: text/plain; charset=utf-8', '', 'divya.real@gmail.com has requested to automatically forward mail to your email address.',
].join('\r\n')
const forwardedRaw = (to: string, extra: string[] = [], id = 'fwd-1') => [
  'From: Nithin <nithin@example.test>', `To: ${to}`, 'Subject: Lunch', `Message-ID: <${id}@example.test>`, ...extra,
  'Content-Type: text/plain; charset=utf-8', '', 'See you at noon.',
].join('\r\n')
const now = Date.parse('2026-11-10T06:00:00Z')

// A. Migrated: confirmation email records the address; genuine forward then activates once.
{
  const db = makeDb({ migrated: true, row: {} })
  const { inbound, notices } = modules(db)
  assert.equal((await inbound.processInboundEmail({ to: ADDR, raw: confirmationRaw(), now })).status, 'confirmation')
  assert.equal(db.row.forwarding_verified_address, 'divya.real@gmail.com', 'Gmail confirmation records the verified forwarder')
  assert.equal(db.row.forwarding_confirmed_at, null, 'confirmation alone is not "forwarding on"')
  // Spoofed: right envelope, but original recipient is someone else.
  await inbound.processInboundEmail({ to: ADDR, raw: forwardedRaw('someone@else.test', ['X-Forwarded-To: ' + ADDR], 'spoof-1'), now })
  assert.equal(db.row.forwarding_confirmed_at, null, 'unmatched original recipient never activates')
  // Envelope not the alias (alias only visible in To): no activation.
  await inbound.processInboundEmail({ to: 'other@in.askgogo.in', raw: forwardedRaw(`divya.real@gmail.com, ${ADDR}`, [], 'spoof-2'), now })
  assert.equal(db.row.forwarding_confirmed_at, null, 'envelope recipient must be the owner alias')
  assert.equal(notices.some(k => k.startsWith('email-forward-on/')), false)
  // Genuine Gmail forward: envelope = alias, original To = verified address, X-Forwarded-For names it.
  const r = await inbound.processInboundEmail({ to: ADDR, raw: forwardedRaw('Divya <divya.real@gmail.com>', [`X-Forwarded-For: divya.real@gmail.com ${ADDR}`, `X-Forwarded-To: ${ADDR}`], 'real-1'), now })
  assert.equal(r.status, 'stored')
  assert.equal(db.row.forwarding_confirmed_at, new Date(now).toISOString(), 'verified forward turns forwarding on')
  assert.equal(notices.filter(k => k === `email-forward-on/${OWNER}`).length, 1)
  const { aliases } = modules(db)
  const shown = await aliases.getOrCreateAlias(OWNER, 'Divya')
  assert.equal(shown.forwarding_confirmed_at, new Date(now).toISOString(), 'settings page sees forwarding on')
}

// B. Confirmation without a code, or not addressed to the alias, records nothing.
{
  const db = makeDb({ migrated: true, row: {} })
  const { inbound } = modules(db)
  await inbound.processInboundEmail({ to: ADDR, raw: confirmationRaw(ADDR, 'Gmail Forwarding Confirmation - Receive Mail from divya.real@gmail.com').replace('has requested', 'has requested https://mail-settings.google.com/mail/vf-abc'), now })
  assert.equal(db.row.forwarding_verified_address, null, 'no confirmation code, nothing recorded')
  await inbound.processInboundEmail({ to: ADDR, raw: confirmationRaw('victim@example.test'), now })
  assert.equal(db.row.forwarding_verified_address, null, 'confirmation not addressed to the alias records nothing')
  await inbound.processInboundEmail({ to: ADDR, raw: confirmationRaw(ADDR).replace('forwarding-noreply@google.com', 'forwarding-noreply@g00gle.com'), now })
  assert.equal(db.row.forwarding_verified_address, null, 'non-Google sender records nothing')
}

// C. Legacy row activated by headers (confirmed_at set, no verified address) is shown as NOT confirmed.
{
  const db = makeDb({ migrated: true, row: { forwarding_confirmed_at: '2026-10-01T00:00:00Z' } })
  const { aliases } = modules(db)
  assert.equal((await aliases.getOrCreateAlias(OWNER, 'Divya')).forwarding_confirmed_at, null)
  assert.equal((await aliases.ownerOfAlias(ALIAS)).confirmedAt, null)
}

// D. Migration NOT applied: inbound still works, nothing claims forwarding is active.
{
  const db = makeDb({ migrated: false, row: { forwarding_confirmed_at: '2026-10-01T00:00:00Z' } })
  const { inbound, aliases, notices } = modules(db)
  const owner = await aliases.ownerOfAlias(ALIAS)
  assert.equal(owner.telegramId, OWNER, 'lookup falls back instead of failing all inbound mail')
  assert.equal(owner.confirmedAt, null)
  assert.equal((await aliases.getOrCreateAlias(OWNER, 'Divya')).forwarding_confirmed_at, null, 'settings shows not confirmed')
  assert.equal((await inbound.processInboundEmail({ to: ADDR, raw: confirmationRaw(), now })).status, 'confirmation', 'confirmation still relayed')
  const r = await inbound.processInboundEmail({ to: ADDR, raw: forwardedRaw('divya.real@gmail.com', [`X-Forwarded-For: divya.real@gmail.com ${ADDR}`]), now })
  assert.equal(r.status, 'stored')
  assert.equal(db.log.some((l: any) => 'forwarding_confirmed_at' in l[1]), false, 'never marks forwarding active')
  assert.equal(notices.some(k => k.startsWith('email-forward-on/')), false, 'never claims forwarding is on')
}

console.log('verify-forwarding-verified-address-nov10: PASS')
