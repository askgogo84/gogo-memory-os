// Pending-question registry (understand-first router, PR 1).
// 19 Oct live: Gogo asked a restaurant clarification, the user replied "This Saturday 8pm", and a
// reminder titled "This" was created. A short reply must resume the question Gogo just asked.
// Run: npx tsx scripts/verify-pending-question-registry.mts
//
// Inert DB: supabaseAdmin.from is replaced with an in-memory store, so no network call is made.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only'
process.env.OPENAI_API_KEY ||= 'fixture-only'
process.env.ANTHROPIC_API_KEY ||= 'fixture-only'

const RealDate = Date
let NOW = RealDate.parse('2026-10-19T06:10:00Z') // Mon 19 Oct, 11:40 IST
class FixedDate extends RealDate {
  constructor(...a: any[]) { super(...(a.length ? a : [NOW]) as []) }
  static now() { return NOW }
}
;(globalThis as any).Date = FixedDate

const { supabaseAdmin } = await import('../lib/supabase-admin')

// ── In-memory Supabase ─────────────────────────────────────────────────────────
type Row = Record<string, any>
const tables: Record<string, Row[]> = {}
let nextId = 1
const tbl = (name: string) => (tables[name] ||= [])
function field(row: Row, col: string) {
  const m = col.match(/^(\w+)->>(\w+)$/)
  return m ? row[m[1]]?.[m[2]] : row[col]
}
function builder(name: string) {
  let op: 'select' | 'insert' | 'delete' = 'select'
  let pending: Row[] = []
  const filters: Array<(r: Row) => boolean> = []
  let orderCol: string | null = null, asc = true, lim: number | null = null
  const run = () => {
    if (op === 'insert') return { data: pending, error: null }
    let rows = tbl(name).filter((r) => filters.every((f) => f(r)))
    if (op === 'delete') { tables[name] = tbl(name).filter((r) => !rows.includes(r)); return { data: rows, error: null } }
    if (orderCol) {
      const c = orderCol
      // Stable newest-first: equal timestamps fall back to insertion order.
      rows = rows.map((r, i) => [r, i] as const).sort((a, b) => {
        const x = String(a[0][c] ?? ''), y = String(b[0][c] ?? '')
        return x === y ? (asc ? a[1] - b[1] : b[1] - a[1]) : (x < y ? (asc ? -1 : 1) : (asc ? 1 : -1))
      }).map(([r]) => r)
    }
    if (lim !== null) rows = rows.slice(0, lim)
    return { data: rows, error: null }
  }
  const q: any = {
    select() { return q },
    insert(v: Row | Row[]) {
      op = 'insert'
      pending = (Array.isArray(v) ? v : [v]).map((r) => ({ id: nextId++, created_at: new Date().toISOString(), ...r }))
      tbl(name).push(...pending)
      return q
    },
    delete() { op = 'delete'; return q },
    eq(c: string, v: any) { filters.push((r) => field(r, c) === v); return q },
    in(c: string, v: any[]) { filters.push((r) => v.includes(field(r, c))); return q },
    like(c: string, v: string) { const p = v.replace(/%$/, ''); filters.push((r) => String(field(r, c) ?? '').startsWith(p)); return q },
    order(c: string, o?: { ascending?: boolean }) { orderCol = c; asc = o?.ascending !== false; return q },
    limit(n: number) { lim = n; return q },
    async maybeSingle() { const r = run(); return { data: (r.data as Row[])[0] ?? null, error: null } },
    async single() { const r = run(); const d = (r.data as Row[])[0]; return d ? { data: d, error: null } : { data: null, error: { message: 'no rows' } } },
    then(res: any, rej: any) { return Promise.resolve(run()).then(res, rej) },
  }
  return q
}
;(supabaseAdmin as any).from = (name: string) => builder(name)
const reset = () => { for (const k of Object.keys(tables)) delete tables[k] }

const pq = await import('../lib/bot/pending-questions')
const resolver = await import('../lib/bot/pending-question-resolver')
const rr = await import('../lib/agent/restaurant-reservation')
const { detectIntent } = await import('../lib/bot/detect-intent')
const { resolvePendingReminder, looksLikeNewCommand } = await import('../lib/bot/pending-followup')
const { saveFollowupState } = await import('../lib/bot/handlers/followup-state')

const A = 9101, B = 9202
const actorA = { userId: 'user-a', legacyTelegramId: A, whatsappId: '919100000001', name: 'A' }
const actorB = { userId: 'user-b', legacyTelegramId: B, whatsappId: '919200000002', name: 'B' }
const failures: string[] = []
async function check(label: string, fn: () => Promise<void> | void) {
  reset(); NOW = RealDate.parse('2026-10-19T06:10:00Z')
  try { await fn(); console.log('PASS ' + label) } catch (e: any) { failures.push(label + ': ' + (e?.stack || e?.message)) }
}
const runs = () => tbl('agent_runs')
const reminders = () => tbl('reminders')
const resolve = (actor: typeof actorA, text: string, surface: 'whatsapp' | 'web' = 'whatsapp') =>
  resolver.tryResolvePendingQuestion({ user: { telegramId: actor.legacyTelegramId }, text, surface, actor })

await check('Toit flow: time clarification opens a question; "This Saturday 8pm" resumes the reservation, no reminder', async () => {
  const ask = await rr.queueRestaurantReservationResearch({ actor: actorA, text: 'Book a table for 2 at Toit Indiranagar this Saturday at 8' })
  assert.equal(ask?.status, 'paused')
  assert.match(String(ask?.text), /^What time should I book Toit Indiranagar for\? \(e\.g\. 8 pm\)/)
  const open = await pq.listOpenPendingQuestions(A)
  assert.equal(open.length, 1)
  assert.equal(open[0].kind, 'reservation_slot')
  assert.equal(open[0].expects[0], 'time')
  assert.equal(runs().length, 0, 'nothing queued while the time is unclear')

  const res = await resolve(actorA, 'This Saturday 8pm')
  assert.equal(res?.handledBy, 'restaurant-reservation-background')
  assert.equal(runs().length, 1)
  const meta = runs()[0].metadata_json
  assert.equal(meta.restaurant, 'Toit Indiranagar')
  assert.equal(meta.party_size, 2)
  assert.equal(meta.preferred_start, '20:00')
  assert.equal(meta.requested_date, '2026-10-24')
  assert.match(meta.request_text, /Toit Indiranagar/)
  assert.equal((await pq.listOpenPendingQuestions(A)).length, 0, 'question closed')
  assert.equal(reminders().length, 0, 'no reminder row')
  assert.equal(detectIntent('This Saturday 8pm').type, 'bare_time')
})

await check('missing restaurant and missing party questions resume with the answer merged in', async () => {
  await rr.queueRestaurantReservationResearch({ actor: actorA, text: 'Book a table for 4 this Saturday at 8pm' })
  let open = await pq.listOpenPendingQuestions(A)
  assert.deepEqual(open[0].expects.slice(0, 1), ['restaurant'])
  assert.equal(open[0].exactOnly, false)
  assert.equal(await resolve(actorA, 'thanks'), null, 'chit-chat is never a restaurant name')
  const r1 = await resolve(actorA, 'Toit Indiranagar')
  assert.equal(r1?.handledBy, 'restaurant-reservation-background')
  assert.equal(runs()[0].metadata_json.restaurant, 'Toit Indiranagar')
  assert.equal(runs()[0].metadata_json.party_size, 4)

  reset()
  await rr.queueRestaurantReservationResearch({ actor: actorA, text: 'Book a table at Toit this Saturday at 8pm' })
  open = await pq.listOpenPendingQuestions(A)
  assert.equal(open[0].expects[0], 'party')
  assert.equal(await resolve(actorA, 'Toit'), null, 'a name does not answer a party question')
  const r2 = await resolve(actorA, '4')
  assert.equal(r2?.handledBy, 'restaurant-reservation-background')
  assert.equal(runs()[0].metadata_json.party_size, 4)
  assert.equal(runs()[0].metadata_json.preferred_start, '20:00')
  assert.equal(runs()[0].metadata_json.restaurant, 'Toit')
})

await check('a re-ask reopens one question (no duplicate of the same kind)', async () => {
  await rr.queueRestaurantReservationResearch({ actor: actorA, text: 'Book a table at Toit this Saturday at 8' })
  const res = await resolve(actorA, 'for 3 people')
  // The time is still unclear, so the flow asks again and records a fresh question for the merged request.
  assert.match(String(res?.text), /What time should I book Toit for/)
  const open = await pq.listOpenPendingQuestions(A)
  assert.equal(open.length, 1)
  assert.match(String(open[0].context.originalText), /for 3 people/)
})

await check('"tomorrow 10am" with nothing pending is not a reminder: resolver null, intent bare_time', async () => {
  assert.equal(await resolve(actorA, 'tomorrow 10am'), null)
  assert.equal(detectIntent('tomorrow 10am').type, 'bare_time')
  const src = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
  assert.match(src, /intent\.type === 'bare_time' \|\| \(intent\.type === 'set_reminder' && isContentlessReminderRequest\(incomingText\)\)/)
  assert.match(src, /Did you mean that time for something we were just discussing\? I haven't set any reminder/)
  // The resolver runs before the legacy pending_reminder block in the shared path.
  assert.ok(src.indexOf('tryResolvePendingQuestion({') < src.indexOf("getLatestFollowupState(resolvedUser.telegramId, 'pending_reminder')"))
})

await check('a legacy pending_reminder follow-up still resolves (resolver yields to it)', async () => {
  await saveFollowupState(A, 'pending_reminder', { task: 'pay rent', created_at: new Date().toISOString() })
  assert.equal(await resolve(actorA, '8pm'), null)
  assert.equal(looksLikeNewCommand('8pm'), false)
  assert.equal(looksLikeNewCommand('tomorrow 10am'), false)
  const parsed = resolvePendingReminder({ task: 'pay rent' }, '8pm')
  assert.equal(parsed?.message.toLowerCase().includes('pay rent'), true)
})

await check('a registry question competing with a pending reminder asks which, never guesses', async () => {
  await saveFollowupState(A, 'pending_reminder', { task: 'pay rent', created_at: new Date().toISOString() })
  await rr.queueRestaurantReservationResearch({ actor: actorA, text: 'Book a table for 2 at Toit this Saturday at 8' })
  const res = await resolve(actorA, '8pm')
  assert.equal(res?.handledBy, 'pending-question-ambiguous')
  assert.match(String(res?.text), /1\. Table at Toit \(time\)/)
  assert.match(String(res?.text), /2\. Reminder: pay rent/)
  assert.equal(runs().length, 0)
})

await check('two open registry questions ask which; the numbered reply resumes the chosen one', async () => {
  const resumed: string[] = []
  resolver.RESUMERS.test_slot = async ({ question, answer }) => { resumed.push(`${question.kind}:${answer.raw}`); return { text: 'test resumed', handledBy: 'test-slot' } }
  try {
    await rr.queueRestaurantReservationResearch({ actor: actorA, text: 'Book a table for 2 at Toit this Saturday at 8' })
    NOW += 1000
    await pq.openPendingQuestion({ telegramId: A, kind: 'test_slot', capability: 'test', expects: ['time'], context: { label: 'Test question' } })
    const ask = await resolve(actorA, '8pm')
    assert.equal(ask?.handledBy, 'pending-question-ambiguous')
    assert.match(String(ask?.text), /1\. Test question\n2\. Table at Toit \(time\)/)
    const picked = await resolve(actorA, '2')
    assert.equal(picked?.handledBy, 'restaurant-reservation-background')
    assert.equal(runs()[0].metadata_json.preferred_start, '20:00')
    assert.deepEqual(resumed, [])
    const left = await pq.listOpenPendingQuestions(A)
    assert.deepEqual(left.map((q) => q.kind), ['test_slot'])
  } finally { delete resolver.RESUMERS.test_slot }
})

await check('an expired or unreadable question is never bound', async () => {
  await rr.queueRestaurantReservationResearch({ actor: actorA, text: 'Book a table for 2 at Toit this Saturday at 8' })
  NOW += 31 * 60_000
  assert.equal((await pq.listOpenPendingQuestions(A)).length, 0)
  assert.equal(await resolve(actorA, 'This Saturday 8pm'), null)
  assert.equal(runs().length, 0)
  reset()
  await saveFollowupState(A, 'pending_question', { id: 'bad', telegramId: A, kind: 'reservation_slot', capability: 'restaurant_reservation', expects: ['time'], context: { originalText: 'Book a table for 2 at Toit' }, createdAt: 'not-a-date', expiresAt: 'later' })
  assert.equal((await pq.listOpenPendingQuestions(A)).length, 0, 'fail closed on unreadable timestamps')
  assert.equal(await resolve(actorA, '8pm'), null)
})

await check("another user's question is never bound", async () => {
  await rr.queueRestaurantReservationResearch({ actor: actorA, text: 'Book a table for 2 at Toit this Saturday at 8' })
  assert.equal(await resolve(actorB, 'This Saturday 8pm'), null)
  assert.equal(runs().length, 0)
  // Session user and actor must match.
  assert.equal(await resolver.tryResolvePendingQuestion({ user: { telegramId: B }, text: '8pm', surface: 'whatsapp', actor: actorA }), null)
  // A row filed under B whose payload names A is ignored for both.
  const q = (await pq.listOpenPendingQuestions(A))[0]
  await saveFollowupState(B, 'pending_question', { ...q, telegramId: A })
  assert.equal((await pq.listOpenPendingQuestions(B)).length, 0)
  // Closing A's question as B is a no-op.
  await pq.closePendingQuestion(B, q.id)
  assert.equal((await pq.listOpenPendingQuestions(A)).length, 1)
})

await check('detail classifier and merge are conservative', () => {
  const c = resolver.classifyDetailAnswer
  assert.deepEqual([...c('This Saturday 8pm')!.details].sort(), ['date', 'time'])
  assert.deepEqual([...c('for 4')!.details], ['party'])
  assert.deepEqual([...c('4 people, Sunday 9pm')!.details].sort(), ['date', 'party', 'time'])
  assert.equal(c('4')!.bareNumber, 4)
  for (const t of ['call mom tomorrow 10am', 'remind me at 5', 'what time is it?', 'approve', 'ok', 'book Farzi for 2 tomorrow 8pm', 'please', 'add milk to groceries', 'show my calendar'])
    assert.equal(c(t), null, t)
  const merged = resolver.mergeReservationAnswer('Book a table for 2 at Toit Saturday, not 8pm', c('9pm')!, 'time')
  const intent = rr.parseRestaurantReservationIntent(merged)!
  assert.equal(intent.preferredStart, '21:00', merged)
})

await check("detect-intent: bare day/time is 'bare_time'; reminders with a subject or verb still set_reminder", () => {
  for (const t of ['8pm', 'at 7 am', 'tomorrow', 'tomorrow morning', 'This Saturday 8pm', 'next friday at 9pm', 'on 28th june', 'in 2 hours', 'Monday 7am'])
    assert.equal(detectIntent(t).type, 'bare_time', t)
  for (const t of ['gym on Monday 7am', 'call mom tomorrow 10am', 'remind me at 5', 'tomorrow at 9 dentist', '28 june dentist appointment', 'every Monday 10 AM'])
    assert.equal(detectIntent(t).type, 'set_reminder', t)
})

;(globalThis as any).Date = RealDate
if (failures.length) { console.error(failures.join('\n\n')); process.exitCode = 1 }
else console.log('Pending-question registry passed: Toit follow-up resumes the reservation, no contentless reminder, ambiguity asks, TTL and owner binding hold.')
