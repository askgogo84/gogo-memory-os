// Inert regression exercising the original exported handlers, never real providers.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'ci-fixture'

import { OFFER_EVENT } from '../lib/services/image-note-reader'
const { supabaseAdmin } = await import('../lib/supabase-admin')
const { saveImageOffer, takeImageOffer } = await import('../lib/agent/image-offer')

type Row = Record<string, any>
const activity: Row[] = []
const conversations: Row[] = []
let nextId = 1
let eventReadError = false
let conversationReadError = false
let claimFailure: 'none' | 'before' | 'after' = 'none'
let successfulClaims = 0

function query(table: string) {
  assert.ok(['agent_activity', 'conversations'].includes(table), 'no other tables are accessed')
  const values = table === 'agent_activity' ? activity : conversations
  const predicates: ((row: Row) => boolean)[] = []
  let update: Row | null = null
  let insert: Row | null = null
  let descending: string | null = null
  let maxRows = Infinity
  const q: any = {
    select(_cols: string) { return q },
    eq(key: string, val: unknown) {
      assert.equal(typeof val, 'string', 'all owner and UUID binds must be exact strings')
      predicates.push(r => String(r[key]) === val)
      return q
    },
    in(key: string, vals: string[]) { predicates.push(r => vals.includes(String(r[key]))); return q },
    gte(key: string, val: string) { predicates.push(r => String(r[key]) >= val); return q },
    order(key: string, o: { ascending?: boolean }) { assert.equal(o.ascending, false); descending = key; return q },
    limit(n: number) { maxRows = n; return q },
    update(patch: Row) { update = patch; return q },
    insert(row: Row) { insert = row; return q },
    async maybeSingle() { return execute(true) },
    then(ok: any, bad?: any) { return Promise.resolve(execute(false)).then(ok, bad) },
  }
  function execute(single: boolean) {
    if (insert) {
      values.push({ ...insert,
        id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
        created_at: new Date(Date.now() + nextId * 100).toISOString() })
      return { data: null, error: null }
    }
    if (!update && ((table === 'agent_activity' && eventReadError) ||
      (table === 'conversations' && conversationReadError)))
      return { data: null, error: { message: 'inert read failure' } }
    const found = values.filter(row => predicates.every(fn => fn(row)))
    if (descending) found.sort((a, b) => String(b[descending!]).localeCompare(String(a[descending!])))
    const chosen = found.slice(0, maxRows)
    if (update) {
      assert.equal(table, 'agent_activity')
      assert.equal(predicates.length, 3, 'CAS must bind event UUID, exact owner and unconsumed type')
      if (claimFailure === 'before') return { data: null, error: { message: 'write denied' } }
      // Mimics an atomic PostgreSQL UPDATE ... WHERE event_type = 'image_offer' RETURNING id.
      if (chosen.length === 1) {
        Object.assign(chosen[0], update)
        successfulClaims++
      }
      if (claimFailure === 'after') return { data: null, error: { message: 'unknown commit result' } }
      return { data: chosen.length === 1 ? { id: chosen[0].id } : null, error: null }
    }
    const result = structuredClone(chosen)
    return { data: single ? result[0] || null : result, error: null }
  }
  return q
}
;(supabaseAdmin as any).from = query

const ownerA = '9007199254740992'
const ownerB = '9007199254740993'
const offerA = { question: 'Want me to remind you on 3 Dec at 10 am to use a voucher?', instruction: 'remind me on 3 December 2026 at 10am to use a voucher' }
const offerB = { question: 'Want me to add an event tomorrow?', instruction: 'add my private appointment tomorrow at 3pm to calendar' }
function assistant(owner: string, question: string) {
  conversations.push({ telegram_id: owner, role: 'assistant', content: `Useful explanation.\n\n${question}`,
    created_at: new Date(Date.now() + nextId++ * 100).toISOString() })
}
await saveImageOffer(ownerA, offerA)
assistant(ownerA, offerA.question)
const both = await Promise.all([
  takeImageOffer(ownerA, 'Yes'),
  takeImageOffer(ownerA, 'Yes'),
])
assert.equal(both.filter(x => x === offerA.instruction).length, 1, 'simultaneous yes deliveries must execute at most once')
assert.equal(both.filter(x => x === null).length, 1)
assert.equal(successfulClaims, 1)
assert.equal(await takeImageOffer(ownerA, 'Yes'), null, 'a used offer cannot be repeated')
assert.equal(activity.filter(x => x.telegram_id === ownerA && x.event_type === OFFER_EVENT + '_used').length, 1)

await saveImageOffer(ownerB, offerB)
assistant(ownerB, offerB.question)
assert.equal(await takeImageOffer(ownerB, 'yes'), offerB.instruction)
assert.equal(await takeImageOffer(ownerA, 'Yes'), null, 'another exact BIGINT owner never reopens an offer')
assert.equal(await takeImageOffer(Number(ownerB), 'yes'), null, 'unsafe numeric owners fail closed')
assert.equal(await takeImageOffer(ownerB, 'yes'), null)
assert.equal(successfulClaims, 2)

const ownerC = '1234567890'
await saveImageOffer(ownerC, offerA)
assistant(ownerC, offerA.question)
eventReadError = true
assert.equal(await takeImageOffer(ownerC, 'Yes'), null, 'read error cannot authorize an instruction')
eventReadError = false
conversationReadError = true
assert.equal(await takeImageOffer(ownerC, 'Yes'), null, 'conversation read error cannot authorize an instruction')
conversationReadError = false
claimFailure = 'before'
assert.equal(await takeImageOffer(ownerC, 'Yes'), null, 'denied CAS cannot authorize an instruction')
assert.equal(successfulClaims, 2)
claimFailure = 'after'
assert.equal(await takeImageOffer(ownerC, 'Yes'), null, 'ambiguous commit returns no instruction')
claimFailure = 'none'
assert.equal(await takeImageOffer(ownerC, 'Yes'), null, 'unknown outcome is not retried')
assert.equal(successfulClaims, 3, 'the unknown-outcome update applied only once')

// Newest Gogo reply must still match the offer's exact question; no stale yes.
// Another owner's or a badly parsed offered owner must never claim any row.
const ownerD = '-123456789'
await saveImageOffer(ownerD, offerA)
assistant(ownerD, offerA.question)
assistant(ownerD, 'Something unrelated has superseded the question.')
assert.equal(await takeImageOffer(ownerD, 'Yes'), null)
assert.equal(await takeImageOffer('not-an-owner', 'Yes'), null)
assert.equal(await takeImageOffer('0', 'Yes'), null)
assert.equal(await takeImageOffer(ownerD, 'yes but next week'), null)
assert.equal(activity.filter(x => x.telegram_id === ownerD && x.event_type === OFFER_EVENT).length, 1)
console.log('image-offer atomic owner claim: concurrent yes, DB failures, unknown outcome, exact 64-bit owners PASS')

// The 25 Nov handset report: a same-day image offer asks 4:45pm, the owner replies 4.15pm.
// Exercise the actual offer builder, persisted claim handler and real reminder parser with a fixed IST morning.
const { buildImageOffer } = await import('../lib/services/image-note-reader')
const { parseReminderIntent } = await import('../lib/bot/handlers/reminders')
const RealDate = Date
const fixed = Date.parse('2026-11-25T09:26:00+05:30')
globalThis.Date = new Proxy(RealDate, {
  construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [fixed], newTarget) },
  get(target, prop, receiver) { return prop === 'now' ? () => fixed : Reflect.get(target, prop, receiver) },
})
try {
  const meeting = buildImageOffer({ kind: 'calendar', date: '2026-11-25', time: '17:00', what: 'HDFC meeting at Starbucks' }, '2026-11-25', 9 * 60 + 26)!
  assert.ok(meeting?.at)
  assert.match(meeting.question, /4:45 pm/)
  const owner = '-9007199254740993'
  await saveImageOffer(owner, meeting)
  assistant(owner, meeting.question)
  const row = activity.find(x => x.telegram_id === owner)!
  assert.equal(row.metadata_json.at, meeting.at, 'persist the exact validated offer date/time')
  for (const t of ['4:15', '4.99pm', '0pm', '13pm', '4.15pm tomorrow', '4.15pm and send an email', '8am']) {
    assert.equal(await takeImageOffer(owner, t), null, t)
    assert.equal(row.event_type, OFFER_EVENT, 'invalid/ambiguous/past reply does not consume the offer')
  }
  assert.equal(await takeImageOffer('-9007199254740992', '4.15pm'), null, 'foreign adjacent BIGINT cannot claim')
  assert.equal(await takeImageOffer(Number(owner), '4.15pm'), null, 'unsafe numeric owner cannot claim')
  const rewritten = await takeImageOffer(owner, '4.15pm')
  assert.equal(rewritten, meeting.instruction.replace('4:45pm', '4:15pm'))
  const parsed = parseReminderIntent(rewritten!)
  const original = parseReminderIntent(meeting.instruction)
  assert.equal(parsed?.kind, 'one_time')
  assert.equal(parsed?.remindAtIso, '2026-11-25T10:45:00.000Z')
  assert.equal(parsed?.message, original?.message, 'change only the reminder clock, not its subject')
  assert.equal(await takeImageOffer(owner, '4:15 pm'), null, 'cannot repeat a consumed offer')

  // All variants must reach the same actual claim path; a yes and a time reply may race.
  for (const [i, clock] of ['4:15 pm', '16:15', '4pm'].entries()) {
    const o = String(-1000 - i)
    await saveImageOffer(o, meeting)
    assistant(o, meeting.question)
    const results = await Promise.all([takeImageOffer(o, clock), takeImageOffer(o, 'yes')])
    assert.equal(results.filter(Boolean).length, 1, 'only one claimant may dispatch')
  }

  const stale = '-1004'
  await saveImageOffer(stale, meeting)
  assistant(stale, meeting.question)
  assistant(stale, 'Another question entirely.')
  assert.equal(await takeImageOffer(stale, '4.15pm'), null)
  const expired = '-1005'
  await saveImageOffer(expired, meeting)
  assistant(expired, meeting.question)
  activity.find(x => x.telegram_id === expired)!.created_at = new Date(fixed - 31 * 60_000).toISOString()
  assert.equal(await takeImageOffer(expired, '4.15pm'), null)
  const calendar = '-1006'
  await saveImageOffer(calendar, offerB)
  assistant(calendar, offerB.question)
  assert.equal(await takeImageOffer(calendar, '4.15pm'), null, 'never convert a calendar offer into a reminder')
  assert.equal(await takeImageOffer(calendar, 'yes'), offerB.instruction)
  const due = buildImageOffer({ kind: 'reminder', date: '2026-12-03', what: 'use a voucher' }, '2026-11-25')!
  const future = '-1007'
  await saveImageOffer(future, due)
  assistant(future, due.question)
  const futureReply = await takeImageOffer(future, '4.15pm')
  assert.equal(parseReminderIntent(futureReply!)?.remindAtIso, '2026-11-30T10:45:00.000Z', 'keep original future date')
  assert.equal(parseReminderIntent(futureReply!)?.message, parseReminderIntent(due.instruction)?.message)
} finally {
  globalThis.Date = RealDate
}

// The WhatsApp ingress must not reject the exact short time before the actual resolver.
const { readFileSync } = await import('node:fs')
const webhook = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
assert.match(webhook, /isImageOfferReply\(text\)[\s\S]{0,180}takeImageOffer\(/)
console.log('image offer clock override: exact IST date/subject, stale/foreign/ambiguous/past refusal and atomic race PASS')
