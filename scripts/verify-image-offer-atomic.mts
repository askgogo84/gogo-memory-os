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
