import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import {
  fullInternationalDigits, paymentOwnerLookupClauses, uniquePaymentOwner,
} from '../lib/services/razorpay-owner-binding'
import * as binding from '../lib/services/razorpay-owner-binding'

// Synthetic only: absolutely no real provider call, account, DB or message.
const FULL_91 = '+919876543210'
const FULL_44 = '+449876543210' // identical trailing ten digits, different owner
const row91 = () => ({ id: 'owner91', phone: FULL_91, whatsapp_id: 'whatsapp:' + FULL_91, telegram_id: null as string | null, razorpay_subscription_id: null as string | null })
const row44 = () => ({ id: 'owner44', phone: FULL_44, whatsapp_id: 'whatsapp:' + FULL_44, telegram_id: null as string | null, razorpay_subscription_id: null as string | null })

assert.equal(fullInternationalDigits('whatsapp:' + FULL_91), '919876543210')
assert.equal(fullInternationalDigits('9876543210'), null, 'domestic-only suffix cannot bind an owner')
assert.equal(fullInternationalDigits('whatsapp:unverified'), null)
assert.equal(fullInternationalDigits('garbage ' + FULL_91), null)
const lookup = paymentOwnerLookupClauses({ phone: FULL_91 })
assert.ok(lookup.includes('phone.eq.' + FULL_91))
assert.ok(!lookup.some((x) => /ilike|\*|9876543210$/.test(x) && !x.includes('919876543210')),
  'no last-ten wildcard lookup')
assert.ok(!lookup.some((x) => x.includes(FULL_44) || x.includes('449876543210')),
  'cross-country same-suffix owners must not be inferred')
assert.equal(paymentOwnerLookupClauses({phone:'9876543210'}).length, 0)
assert.equal(paymentOwnerLookupClauses({telegramId:-876543210}).length, 0, 'legacy negative fallback is not owner evidence')
assert.equal(paymentOwnerLookupClauses({telegramId:9007199254740993}).length, 0, 'rounded numeric BIGINT cannot bind owner')
assert.equal(paymentOwnerLookupClauses({userId:'a,b;id.eq.owner44'}).length, 0, 'untrusted PostgREST OR syntax is rejected')
assert.deepEqual(uniquePaymentOwner([row91(), row44()], {phone:FULL_91}), null, 'multiple candidate rows deny')
assert.deepEqual(uniquePaymentOwner([row44()], {phone:FULL_91}), null, 'another country must not match')
assert.deepEqual(uniquePaymentOwner([row91()], {phone:FULL_91, whatsappId:FULL_44}), null, 'contradictory paid-contact and notes deny')
assert.deepEqual(uniquePaymentOwner([{...row91(),id:9007199254740993}],{phone:FULL_91}), null, 'unsafe DB number denies')
assert.equal(uniquePaymentOwner([row91()], {phone:FULL_91})?.id, 'owner91')

type Row = ReturnType<typeof row91>
type Write = { id: string; patch: Record<string, unknown> }
function harness(people: Row[], opts: { lookupError?: boolean } = {}) {
  const writes: Write[] = []
  const records: any[] = []
  const sends: { phone: string; message: string }[] = []
  const client = {
    from(table: string) {
      let patch: Record<string, unknown> | null = null
      let target: { key: string; value: string } | null = null
      let orFilter = ''
      const builder: any = {
        select() {
          if (!patch) return builder
          const updated = people.filter((row) => String((row as any)[target?.key || 'id']) === target?.value)
          for (const row of updated) {
            writes.push({ id: String(row.id), patch: patch! })
            Object.assign(row, patch)
          }
          return Promise.resolve({ data: updated.map((r) => ({ id: r.id })), error: null })
        },
        or(text: string) { orFilter = text; return builder },
        limit(n: number) {
          if (opts.lookupError) return Promise.resolve({ data: null, error: { code: 'fixture_outage' } })
          const matched = people.filter((row) => orFilter.split(',').some((clause) => {
            const sep = clause.indexOf('.eq.')
            if (sep < 0) throw new Error('unexpected unsafe query: ' + clause)
            const column = clause.slice(0, sep)
            const expected = clause.slice(sep + 4)
            return String((row as any)[column] ?? '') === expected
          }))
          return Promise.resolve({ data: matched.slice(0, n).map((r) => ({ ...r })), error: null })
        },
        update(value: Record<string, unknown>) { patch = value; return builder },
        eq(key: string, value: unknown) { target = { key, value: String(value) }; return builder },
        upsert(value: unknown) { records.push(value); return Promise.resolve({ error: null }) },
        insert(value: unknown) { records.push(value); return Promise.resolve({ error: null }) },
      }
      if (!['users', 'payment_records'].includes(table)) throw new Error('unexpected table: ' + table)
      return builder
    },
  }
  const mocks: Record<string, any> = {
    'next/server': { NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status || 200 }) } },
    '@/lib/razorpay': {
      verifyWebhookSignature: () => true,
      ASKGOGO_PLANS: { pro: true },
      getPlan: () => ({ key: 'pro', name: 'Gogo Pro', amountInPaise: 99900, amountInRupees: 999, validityDays: 30 }),
    },
    '@supabase/supabase-js': { createClient: () => client },
    '@/lib/whatsapp': { sendWhatsApp: async (phone: string, message: string) => { sends.push({ phone, message }) } },
    '@/lib/services/razorpay-owner-binding': binding,
  }
  const source = readFileSync(new URL('../app/api/payments/webhook/route.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod: { exports: Record<string, any> } = { exports: {} }
  runInNewContext(compiled, {
    module: mod, exports: mod.exports,
    require: (name: string) => {
      if (!Object.hasOwn(mocks, name)) throw new Error('unexpected import: ' + name)
      return mocks[name]
    },
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' } },
    console: { log() {}, warn() {}, error() {} },
    Buffer, Date, URL, JSON,
  })
  async function event(name: string, payload: any): Promise<any> {
    const response = await mod.exports.POST({
      text: async () => JSON.stringify({ event: name, payload }),
      headers: { get: () => 'synthetic-signature' },
    })
    return response.body
  }
  const paid = (contact: string, whatsappId: string) => ({
    payment_link: { entity: { id: 'plink_fixture', customer: { contact }, notes: { plan: 'pro', whatsapp_id: whatsappId } } },
    payment: { entity: { id: 'pay_fixture' } },
  })
  return { event, paid, writes, records, sends, people }
}

// Exercise actual production webhook handler with inert provider, database and WhatsApp.
{
  const h = harness([row91(), row44()])
  const res = await h.event('payment_link.paid', h.paid(FULL_91, 'whatsapp:' + FULL_91))
  assert.equal(res.ok, true)
  assert.deepEqual(h.writes.map((x) => x.id), ['owner91'], 'only the exact owner can be upgraded')
  assert.equal(h.people[1].razorpay_subscription_id, null)
  assert.deepEqual(h.sends.map((x) => x.phone), [FULL_91], 'confirmation goes to DB-bound owner, not unverified notes')
  assert.equal(h.records.length, 1, 'provider payment provenance remains recorded')
}
{
  const h = harness([row91(), row44()])
  const result = await h.event('payment_link.paid', h.paid(FULL_44, 'whatsapp:' + FULL_91))
  assert.equal(result.ignored, 'owner_unbound', 'conflicting paid-contact and notes fail closed')
  assert.equal(h.writes.length, 0)
  assert.equal(h.sends.length, 0)
  assert.equal(h.records.length, 1, 'unbound money remains recorded for manual reconciliation')
}
{
  const h = harness([row91(), { ...row91(), id: 'different-owner' }])
  const result = await h.event('payment_link.paid', h.paid(FULL_91, FULL_91))
  assert.equal(result.ignored, 'owner_unbound')
  assert.equal(h.writes.length, 0, 'duplicate exact phone rows do not receive bulk entitlement')
  assert.equal(h.sends.length, 0)
}
{
  const h = harness([row91(), row44()])
  const result = await h.event('payment_link.paid', h.paid('9876543210', '9876543210'))
  assert.equal(result.ignored, 'owner_unbound', 'domestic contact alone is not cross-channel proof')
  assert.equal(h.writes.length, 0)
  assert.equal(h.sends.length, 0)
}
{
  const h = harness([row91(), row44()], { lookupError: true })
  const result = await h.event('payment_link.paid', h.paid(FULL_91, FULL_91))
  assert.equal(result.ignored, 'owner_unbound', 'DB outage must never become a bulk update')
  assert.equal(h.writes.length, 0)
  assert.equal(h.sends.length, 0)
}
{
  const a = { ...row91(), razorpay_subscription_id: 'sub_fixtureOwner91' }
  const b = { ...row44(), razorpay_subscription_id: 'sub_fixtureOwner44' }
  const h = harness([a, b])
  const result = await h.event('subscription.halted', { subscription: { entity: { id: 'sub_fixtureOwner91', status: 'halted', notes: { whatsapp_id: FULL_44 } } } })
  assert.equal(result.ok, true)
  assert.deepEqual(h.writes.map((x) => x.id), ['owner91'], 'halt revokes only persisted exact subscription ID')
  assert.deepEqual(h.sends.map((x) => x.phone), [FULL_91], 'halt notice must not trust webhook notes phone')
}
{
  const h = harness([row91(), row44()])
  await h.event('subscription.halted', { subscription: { entity: { id: 'sub_fixtureOwner91', status: 'halted', notes: { whatsapp_id: FULL_91 } } } })
  assert.equal(h.writes.length, 0, 'unpersisted subscription cannot revoke a phone-suffix owner')
  assert.equal(h.sends.length, 0)
}
console.log('PASS: exact owner Razorpay webhook activation/revocation, conflicting cross-country suffix, ambiguous/legacy/DB-error no-send containment')
