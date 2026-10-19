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
    gte(c: string, v: any) { gteCalls.push(`${name}.${c}`); filters.push((r) => String(field(r, c) ?? '') >= String(v)); return q },
    like(c: string, v: string) {
      likeCalls.push(`${name}.${c}:${v}`)
      const re = new RegExp('^' + v.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.')).join('.*') + '$', 's')
      filters.push((r) => re.test(String(field(r, c) ?? ''))); return q
    },
    order(c: string, o?: { ascending?: boolean }) { orderCol = c; asc = o?.ascending !== false; return q },
    limit(n: number) { lim = n; return q },
    async maybeSingle() { const r = run(); return { data: (r.data as Row[])[0] ?? null, error: null } },
    async single() { const r = run(); const d = (r.data as Row[])[0]; return d ? { data: d, error: null } : { data: null, error: { message: 'no rows' } } },
    then(res: any, rej: any) { return Promise.resolve(run()).then(res, rej) },
  }
  return q
}
const fromCalls: string[] = []
const likeCalls: string[] = []
const gteCalls: string[] = []
;(supabaseAdmin as any).from = (name: string) => { fromCalls.push(name); return builder(name) }
const reset = () => { for (const k of Object.keys(tables)) delete tables[k]; fromCalls.length = 0; likeCalls.length = 0; gteCalls.length = 0 }

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
// Callers persist each turn (user, then assistant) exactly as the webhook / dashboard do.
const turn = (tg: number, role: 'user' | 'assistant', content: string) => tbl('conversations').push({ id: nextId++, telegram_id: tg, role, content, created_at: new Date().toISOString() })
const tick = (ms = 1000) => { NOW += ms }
async function resolve(actor: typeof actorA, text: string, surface: 'whatsapp' | 'web' = 'whatsapp') {
  const res = await resolver.tryResolvePendingQuestion({ user: { telegramId: actor.legacyTelegramId }, text, surface, actor })
  if (res) { turn(actor.legacyTelegramId, 'user', text); turn(actor.legacyTelegramId, 'assistant', res.text); tick() }
  return res
}
/** The user asks for a reservation and Gogo's reply (a clarification) is saved as the latest turn. */
async function ask(actor: typeof actorA, text: string) {
  const res = await rr.queueRestaurantReservationResearch({ actor, text })
  turn(actor.legacyTelegramId, 'user', text)
  turn(actor.legacyTelegramId, 'assistant', String(res?.text || ''))
  tick()
  return res
}

await check('Toit flow: time clarification opens a question; "This Saturday 8pm" resumes the reservation, no reminder', async () => {
  const asked = await ask(actorA, 'Book a table for 2 at Toit Indiranagar this Saturday at 8')
  assert.equal(asked?.status, 'paused')
  assert.match(String(asked?.text), /^What time should I book Toit Indiranagar for\? \(e\.g\. 8 pm\)/)
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
  await ask(actorA, 'Book a table for 4 this Saturday at 8pm')
  let open = await pq.listOpenPendingQuestions(A)
  assert.deepEqual(open[0].expects.slice(0, 1), ['restaurant'])
  assert.equal(open[0].exactOnly, false)
  assert.equal(await resolve(actorA, 'thanks'), null, 'chit-chat is never a restaurant name')
  const r1 = await resolve(actorA, 'Toit Indiranagar')
  assert.equal(r1?.handledBy, 'restaurant-reservation-background')
  assert.equal(runs()[0].metadata_json.restaurant, 'Toit Indiranagar')
  assert.equal(runs()[0].metadata_json.party_size, 4)

  reset()
  await ask(actorA, 'Book a table at Toit this Saturday at 8pm')
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
  await ask(actorA, 'Book a table at Toit this Saturday at 8')
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
  await ask(actorA, 'Book a table for 2 at Toit this Saturday at 8')
  const res = await resolve(actorA, '8pm')
  assert.equal(res?.handledBy, 'pending-question-ambiguous')
  assert.match(String(res?.text), /1\. Table at Toit \(time\)/)
  assert.match(String(res?.text), /2\. Reminder: pay rent/)
  assert.equal(runs().length, 0)
})

await check('two open registry questions: only the one Gogo asked last binds', async () => {
  const resumed: string[] = []
  resolver.RESUMERS.test_slot = async ({ question, answer }) => { resumed.push(`${question.kind}:${answer.raw}`); return { text: 'test resumed', handledBy: 'test-slot' } }
  try {
    await ask(actorA, 'Book a table for 2 at Toit this Saturday at 8')
    const q = 'What time is the test for?'
    await pq.openPendingQuestion({ telegramId: A, kind: 'test_slot', capability: 'test', expects: ['time'], context: { label: 'Test question' }, askedText: q })
    turn(A, 'user', 'start a test'); turn(A, 'assistant', q); tick()
    const res = await resolve(actorA, '8pm')
    assert.equal(res?.handledBy, 'test-slot')
    assert.deepEqual(resumed, ['test_slot:8pm'])
    assert.equal(runs().length, 0, 'the older Toit question did not claim the reply')
    assert.equal((await pq.listOpenPendingQuestions(A)).length, 0, 'the superseded Toit question was closed')
  } finally { delete resolver.RESUMERS.test_slot }
})

await check('"which one?": the numbered reply resumes the chosen registry question', async () => {
  await saveFollowupState(A, 'pending_reminder', { task: 'pay rent', created_at: new Date().toISOString() })
  tick()
  await ask(actorA, 'Book a table for 2 at Toit this Saturday at 8')
  const which = await resolve(actorA, '8pm')
  assert.equal(which?.handledBy, 'pending-question-ambiguous')
  const picked = await resolve(actorA, '1')
  assert.equal(picked?.handledBy, 'restaurant-reservation-background')
  assert.equal(runs()[0].metadata_json.preferred_start, '20:00')
})

await check('an expired or unreadable question is never bound', async () => {
  await ask(actorA, 'Book a table for 2 at Toit this Saturday at 8')
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
  await ask(actorA, 'Book a table for 2 at Toit this Saturday at 8')
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

// ── 19 Oct review round 3 ──────────────────────────────────────────────────────

await check('HIGH: a flight question asked after the Toit question owns "2 adults" / "Saturday" / "2"', async () => {
  const asked = await ask(actorA, 'Book a table at Toit this Saturday at 8pm')
  assert.match(String(asked?.text), /How many people should I book at Toit for\?/)
  // The user moves on to a flight; Gogo asks a flight clarification (saved as the latest turn).
  const flightQ = 'How many travellers, and which cabin?'
  // Only the conversation turn marks it: no follow-up state is written, so the latest-turn rule alone decides.
  turn(A, 'user', 'find flights from Bangalore to Delhi'); turn(A, 'assistant', flightQ)
  tick()
  for (const t of ['2 adults', 'Saturday', '2', 'for 2']) assert.equal(await resolve(actorA, t), null, t)
  assert.equal(runs().length, 0, 'Toit was not resumed')
  assert.equal((await pq.listOpenPendingQuestions(A)).length, 0, 'the stale Toit question was closed')
})

await check('HIGH: a newer flight/calendar follow-up supersedes the registry question even if its turn was not saved', async () => {
  await ask(actorA, 'Book a table at Toit this Saturday at 8pm')
  // Flight state written after the question, but the conversation save failed (latest turn is still Toit).
  tbl('agent_activity').push({ id: nextId++, telegram_id: String(A), event_type: 'flight_booking_details', metadata_json: { reply: 'Send traveller names', at: new Date().toISOString() }, created_at: new Date().toISOString() })
  assert.equal(await resolve(actorA, '2'), null)
  assert.equal(runs().length, 0)
  reset()
  await ask(actorA, 'Book a table at Toit this Saturday at 8pm')
  await saveFollowupState(A, 'calendar_mutation', { action: 'move', text: 'move standup', created_at: new Date().toISOString(), candidates: [{ eventId: 'e1', summary: 'Standup' }, { eventId: 'e2', summary: 'Review' }] })
  assert.equal(await resolve(actorA, '2'), null, 'the newer calendar pick owns the digit')
  assert.equal(runs().length, 0)
})

await check('MED: an older live calendar pick competes with a party question (asks which)', async () => {
  await saveFollowupState(A, 'calendar_mutation', { action: 'delete', text: 'delete standup', created_at: new Date().toISOString(), candidates: [{ eventId: 'e1', summary: 'Standup' }, { eventId: 'e2', summary: 'Review' }] })
  tick()
  await ask(actorA, 'Book a table at Toit this Saturday at 8pm')
  const res = await resolve(actorA, '2')
  assert.equal(res?.handledBy, 'pending-question-ambiguous')
  assert.match(String(res?.text), /2\. Calendar: pick the event to delete/)
  const picked = await resolve(actorA, '2')
  assert.match(String(picked?.text), /Send the event number once more/)
  assert.equal(runs().length, 0)
})

await check('MED-HIGH: free text binds a restaurant question only when it reads like a venue name', async () => {
  await ask(actorA, 'Book a table for 4 this Saturday at 8pm')
  for (const t of ['not now', 'maybe later', 'never mind', 'actually never mind', 'sounds good', "I'm busy", 'call mom', 'Mom', 'Gym', 'milk eggs bread', 'Bangalore', 'Koramangala', 'Swiggy', 'Done thanks', 'ok sure', 'no', 'cancel', 'stop', 'thanks', 'Pizza', 'buy Milk', 'Toit, Farzi', 'Show My Lists', 'good morning', 'Thanks a lot', 'my reminders'])
    assert.equal(await resolve(actorA, t), null, t)
  assert.equal(runs().length, 0)
  assert.equal(resolver.looksLikeVenueName('The Fatty Bao'), true)
  assert.equal(resolver.looksLikeVenueName('toit brewpub'), true)
  assert.equal(resolver.looksLikeVenueName('Toit Indiranagar'), true)
  // Only within 10 minutes of the question.
  NOW += 11 * 60_000
  assert.equal(await resolve(actorA, 'Toit Indiranagar'), null, 'a name 11 minutes later is not bound')
  reset()
  await ask(actorA, 'Book a table for 4 this Saturday at 8pm')
  assert.equal((await resolve(actorA, 'Toit Indiranagar'))?.handledBy, 'restaurant-reservation-background')
})

await check('MED: a digit after an unrelated later message is not bound to the old "which one?"', async () => {
  await saveFollowupState(A, 'pending_reminder', { task: 'pay rent', created_at: new Date().toISOString() })
  tick()
  await ask(actorA, 'Book a table for 2 at Toit this Saturday at 8')
  const which = await resolve(actorA, '8pm')
  assert.equal(which?.handledBy, 'pending-question-ambiguous')
  turn(A, 'user', 'show my lists'); turn(A, 'assistant', 'Your lists:\n1. Groceries\n2. Packing'); tick()
  assert.equal(await resolve(actorA, '1'), null)
  assert.equal(runs().length, 0)
  assert.equal(tbl('memories').filter((r) => String(r.content).includes('"kind":"pending_question_choice"')).length, 0, 'stale choice cleared')
})

await check('MED: merge strips exactly what the classifier accepts (month-first, weekend, number words)', () => {
  const c = resolver.classifyDetailAnswer
  const m1 = resolver.mergeReservationAnswer('Book a table for 4 at Toit on Oct 25 at 8', c('Oct 26 8pm')!, 'time', rr.parseRestaurantReservationIntent)
  assert.doesNotMatch(m1, /Oct 25/, m1)
  const p1 = rr.parseRestaurantReservationIntent(m1)!
  assert.equal(p1.requestedDate, '2026-10-26', m1)
  assert.equal(p1.preferredStart, '20:00', m1)
  const m2 = resolver.mergeReservationAnswer('Book a table at Toit for 4 people this weekend at 8', c('Sunday 8pm')!, 'time', rr.parseRestaurantReservationIntent)
  assert.doesNotMatch(m2, /weekend/, m2)
  assert.equal(rr.parseRestaurantReservationIntent(m2)!.requestedDate, '2026-10-25', m2)
  const m3 = resolver.mergeReservationAnswer('Book a table for four at Toit tomorrow at 8pm', c('for 6')!, 'party', rr.parseRestaurantReservationIntent)
  assert.doesNotMatch(m3, /\bfour\b/, m3)
  const p3 = rr.parseRestaurantReservationIntent(m3)!
  assert.equal(p3.partySize, 6, m3)
  assert.equal(p3.restaurant, 'Toit', m3)
  const m4 = resolver.mergeReservationAnswer('Book a table at Toit for 4 people tomorrow at 8pm', c('party of twelve')!, 'party', rr.parseRestaurantReservationIntent)
  assert.equal(rr.parseRestaurantReservationIntent(m4)!.partySize, 12, m4)
  // "for 8 pm" is a time, never a party of 8.
  assert.equal(c('for 8 pm')?.party ?? null, null)
})

await check('LOW-MED: resolver runs once per turn, filters in SQL, and costs zero reads for a non-answer', async () => {
  fromCalls.length = 0
  for (const t of ["what's the weather like in Delhi", 'add milk to groceries', 'remind me to call mom at 5', 'tomorrow?', 'not now'])
    assert.equal(await resolve(actorA, t), null, t)
  assert.deepEqual(fromCalls, [], 'no database read for a message that cannot be an answer')
  assert.equal(resolver.mayAnswerPendingQuestion('8pm'), true)
  assert.equal(resolver.mayAnswerPendingQuestion('show my lists'), false)
  // A detail answer with nothing open: exactly one filtered memories read.
  assert.equal(await resolve(actorA, '8pm'), null)
  assert.deepEqual(fromCalls, ['memories'])
  assert.ok(likeCalls.some((l) => l === 'memories.content:%"kind":"pending_question"%'), likeCalls.join(','))
  // Shared path skips when the caller already resolved this turn.
  const pim = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
  assert.match(pim, /if \(!params\.pendingQuestionChecked && resolvedUser\.id && resolvedUser\.whatsappId\) \{\s*const pendingAnswer = await tryResolvePendingQuestion/)
  const hook = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
  assert.match(hook, /pendingQuestionCheckedFor = text\s*const pendingAnswer = await tryResolvePendingQuestion/)
  assert.match(hook, /pendingQuestionChecked: pendingQuestionCheckedFor === text, semantic: brainObservation\?\.jev \}\)/)
  const dash = readFileSync(new URL('../app/api/dashboard/chat/route.ts', import.meta.url), 'utf8')
  assert.equal((dash.match(/pendingQuestionChecked\}\)|pendingQuestionChecked,\s*\}\)|,pendingQuestionChecked\}\)/g) || []).length, 3, 'all three full-text dashboard calls pass the flag')
  assert.ok(dash.indexOf('const pendingQuestionChecked = true') < dash.indexOf('tryResolvePendingQuestion({'))
})

await check('questions ending in "?" are not bare_time; "8 pm today" stays a bare detail', async () => {
  for (const t of ['tomorrow?', '8pm?', 'sunday?', 'This Saturday 8pm?']) {
    assert.notEqual(detectIntent(t).type, 'bare_time', t)
    assert.equal(resolver.classifyDetailAnswer(t), null, t)
  }
  for (const t of ['8 pm today', 'today 8pm', 'tonight 9pm']) assert.equal(detectIntent(t).type, 'bare_time', t)
})

// ── 19 Oct hold comment on #668 + live failures ────────────────────────────────

const NAME_Q = "7pm tomorrow is available for 2 at Toit Indiranagar. What name should I book under? I'll use your WhatsApp number ending 0001."
const TIME_Q = "7pm tomorrow isn't available for 2 at Toit Indiranagar. Open times: 5:30pm, 6pm or 6:30pm. Which one should I book?"
/** The live-slot step as restaurant-reservation registers it (kind reservation_live_slot), with Gogo's reply as the latest turn. */
async function askLiveSlot(actor: typeof actorA, stage: 'guest_name' | 'time', askedText: string) {
  await pq.openPendingQuestion({ telegramId: actor.legacyTelegramId, kind: 'reservation_live_slot', capability: 'restaurant_reservation', expects: [stage], context: { label: `Table at Toit Indiranagar (${stage === 'guest_name' ? 'guest name' : 'time'})`, stage }, ttlMin: 30, exactOnly: true, askedText })
  turn(actor.legacyTelegramId, 'user', 'Book a table for 2 at Toit Indiranagar tomorrow at 7pm'); turn(actor.legacyTelegramId, 'assistant', askedText); tick()
}
async function withLiveSlotSpy(fn: (seen: Array<{ raw: string; guestName: string; expects: string }>) => Promise<void>) {
  const real = resolver.RESUMERS.reservation_live_slot
  const seen: Array<{ raw: string; guestName: string; expects: string }> = []
  resolver.RESUMERS.reservation_live_slot = async ({ question, answer }) => { seen.push({ raw: answer.raw, guestName: answer.guestName, expects: question.expects[0] }); return { text: 'Approval prepared (fixture)', handledBy: 'restaurant-reservation', status: 'waiting_approval' } }
  try { await fn(seen) } finally { resolver.RESUMERS.reservation_live_slot = real }
}

await check('LIVE 19 Oct: "Goverdhan" after "What name should I book under?" resumes the live-slot step through the registry', async () => {
  await withLiveSlotSpy(async (seen) => {
    await askLiveSlot(actorA, 'guest_name', NAME_Q)
    const res = await resolve(actorA, 'Goverdhan')
    assert.equal(res?.handledBy, 'restaurant-reservation')
    assert.deepEqual(seen, [{ raw: 'Goverdhan', guestName: 'Goverdhan', expects: 'guest_name' }])
    assert.equal(reminders().length, 0)
    reset()
    await askLiveSlot(actorA, 'guest_name', NAME_Q)
    assert.equal((await resolve(actorA, 'book under divya rao'))?.handledBy, 'restaurant-reservation')
    assert.equal(seen.at(-1)?.guestName, 'Divya Rao')
  })
  // The real resumer is registered for the kind and owns a missing/claimed step honestly (nothing booked).
  reset()
  await askLiveSlot(actorA, 'guest_name', NAME_Q)
  const expired = await resolve(actorA, 'Goverdhan')
  assert.match(String(expired?.text), /hold has expired, so nothing was booked/)
  const src = readFileSync(new URL('../lib/bot/pending-question-resolver.ts', import.meta.url), 'utf8')
  assert.match(src, /reservation_live_slot: resumeReservationLiveSlot/)
  assert.match(src, /rr\.continueRestaurantReservationGuestReply\(\{ actor, surface/)
})

await check('live slot: a picked time binds the time question; a name or a command never does', async () => {
  await withLiveSlotSpy(async (seen) => {
    await askLiveSlot(actorA, 'time', TIME_Q)
    for (const t of ['Goverdhan', 'add milk to groceries', '?', 'why?', 'which is best?']) assert.equal(await resolve(actorA, t), null, t)
    assert.equal((await resolve(actorA, '6:30pm'))?.handledBy, 'restaurant-reservation')
    assert.deepEqual(seen, [{ raw: '6:30pm', guestName: '', expects: 'time' }])
  })
  // Names: commands, list items, chatter and everyday words are not guest names.
  for (const t of ['add milk to groceries', 'call mom', 'Mom', 'ok', 'thanks gogo', 'not now', 'show my lists']) assert.equal(resolver.personNameFromReply(t), '', t)
  for (const [t, n] of [['Goverdhan', 'Goverdhan'], ['Divya Rao', 'Divya Rao'], ['book under divya', 'Divya'], ['my name is Nithin', 'Nithin']]) assert.equal(resolver.personNameFromReply(t), n, t)
})

await check('FINDING 1: a stale live-slot question never steals "Goverdhan" / "7pm" once Gogo has said something else', async () => {
  await withLiveSlotSpy(async (seen) => {
    await askLiveSlot(actorA, 'guest_name', NAME_Q)
    turn(A, 'user', 'who is the CEO of Infosys'); turn(A, 'assistant', 'Salil Parekh is the CEO of Infosys.'); tick()
    assert.equal(await resolve(actorA, 'Goverdhan'), null)
    assert.equal(seen.length, 0)
    assert.equal((await pq.listOpenPendingQuestions(A)).length, 0, 'the stale question was closed')
    reset()
    await askLiveSlot(actorA, 'time', TIME_Q)
    NOW += 31 * 60_000
    assert.equal(await resolve(actorA, '6:30pm'), null, 'expired question')
    reset()
    // A question whose asking reply was never saved as a turn (unreadable history) fails closed.
    await pq.openPendingQuestion({ telegramId: A, kind: 'reservation_live_slot', capability: 'restaurant_reservation', expects: ['guest_name'], context: {}, askedText: NAME_Q })
    assert.equal(await resolve(actorA, 'Goverdhan'), null)
    assert.equal(seen.length, 0)
  })
})

await check('FINDING 2: free text is a restaurant only when venue-shaped; "24k" / "22K" / a number is never a venue', async () => {
  for (const t of ['24k', '22K', '10%', '5kg', '2 adults']) assert.equal(resolver.looksLikeVenueName(t), false, t)
  await ask(actorA, 'Book a table for 4 this Saturday at 8pm')
  for (const t of ['24k', '22K', 'yes', 'add milk to groceries']) assert.equal(await resolve(actorA, t), null, t)
  assert.equal(runs().length, 0)
})

await check('FINDING 3: a bare "2" after the "which one?" was superseded does not pick from it', async () => {
  await saveFollowupState(A, 'pending_reminder', { task: 'pay rent', created_at: new Date().toISOString() })
  tick()
  await ask(actorA, 'Book a table for 2 at Toit this Saturday at 8')
  assert.equal((await resolve(actorA, '8pm'))?.handledBy, 'pending-question-ambiguous')
  turn(A, 'user', 'top 3 cafes near me'); turn(A, 'assistant', '1. Third Wave\n2. Blue Tokai\n3. Dyu'); tick()
  assert.equal(await resolve(actorA, '2'), null)
  assert.equal(runs().length, 0)
})

await check('FINDING 4: merge strips date and party forms fully (no "Saturday … Sunday", no "four … 6")', () => {
  const c = resolver.classifyDetailAnswer
  const m1 = resolver.mergeReservationAnswer('Book a table at Toit this Saturday for four people at 8pm', c('next Sunday')!, 'date', rr.parseRestaurantReservationIntent)
  assert.doesNotMatch(m1, /Saturday/i, m1)
  assert.equal(rr.parseRestaurantReservationIntent(m1)!.requestedDate, '2026-10-25', m1)
  const m2 = resolver.mergeReservationAnswer('Book a table at Toit tomorrow, we are 4', c('we are 6')!, 'party', rr.parseRestaurantReservationIntent)
  assert.doesNotMatch(m2, /we are 4/, m2)
  assert.equal(rr.parseRestaurantReservationIntent(m2)!.partySize, 6, m2)
  const m3 = resolver.mergeReservationAnswer('Book a table for 2 at Toit on 25th October at 8pm', c('26 Oct')!, 'date', rr.parseRestaurantReservationIntent)
  assert.doesNotMatch(m3, /25th/, m3)
  assert.equal(rr.parseRestaurantReservationIntent(m3)!.requestedDate, '2026-10-26', m3)
})

await check('FINDING 5: one resolver run per turn on every surface; owner + kind + horizon filtered in SQL', async () => {
  await ask(actorA, 'Book a table for 2 at Toit this Saturday at 8')
  fromCalls.length = 0; likeCalls.length = 0; gteCalls.length = 0
  await resolve(actorA, 'This Saturday 8pm')
  assert.ok(likeCalls.includes('memories.content:%"kind":"pending_question"%'), likeCalls.join(','))
  assert.ok(gteCalls.includes('memories.created_at'), 'rows older than the longest TTL are filtered in SQL')
  const run = readFileSync(new URL('../app/api/agent/run/route.ts', import.meta.url), 'utf8')
  assert.equal((run.match(/tryResolvePendingQuestion\(/g) || []).length, 1)
  const hook = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
  assert.equal((hook.match(/await tryResolvePendingQuestion\(/g) || []).length, 1)
  const rrSrc = readFileSync(new URL('../lib/agent/restaurant-reservation.ts', import.meta.url), 'utf8')
  assert.match(rrSrc, /if\(!intent\)return null/, 'tryRunRestaurantReservation no longer runs a second name-step path')
})

await check('FINDING 6: "?" or a question back to Gogo is never an answer (no bare_time, no binding)', async () => {
  await ask(actorA, 'Book a table for 2 at Toit this Saturday at 8')
  fromCalls.length = 0
  for (const t of ['?', '??', 'what?', 'why 8pm?', '8pm?', 'is 8pm ok?', 'what time?']) {
    assert.equal(await resolve(actorA, t), null, t)
    assert.notEqual(detectIntent(t).type, 'bare_time', t)
  }
  assert.deepEqual(fromCalls, [], 'questions are rejected before any read')
  assert.equal(runs().length, 0)
})

await check('LIVE 19 Oct: "24k" after "22K or 24K gold?" completes the gold request instead of keyword routing', async () => {
  turn(A, 'user', "what's the gold rate in bangalore"); turn(A, 'assistant', 'Sure — which purity do you want, 22K or 24K gold?'); tick()
  const res = await resolve(actorA, '24k')
  assert.equal(res?.handledBy, 'pending-question-offered-choice')
  assert.equal(res?.rewrite, "what's the gold rate in bangalore — 24K gold")
  assert.equal(detectIntent(res!.rewrite!).type, 'gold_live')
  reset()
  turn(A, 'user', 'gold rate today'); turn(A, 'assistant', '22K or 24K gold?'); tick()
  assert.equal((await resolve(actorA, '22k'))?.rewrite, 'gold rate today — 22K gold', 'the shared noun carries over')
  // Not bound: a reply that picks nothing, a later turn, an old question, an approval prompt.
  for (const t of ['18k', 'ok', 'not now', 'show my lists']) assert.equal((await resolve(actorA, t))?.rewrite ?? null, null, t)
  reset()
  turn(A, 'user', 'gold rate today'); turn(A, 'assistant', '22K or 24K gold?'); tick()
  turn(A, 'user', 'weather in delhi'); turn(A, 'assistant', 'Delhi: 31°C, clear.'); tick()
  assert.equal(await resolve(actorA, '24k'), null, 'a later turn means the gold question is no longer on the table')
  reset()
  turn(A, 'user', 'gold rate today'); turn(A, 'assistant', '22K or 24K gold?'); NOW += 11 * 60_000
  assert.equal(await resolve(actorA, '24k'), null, 'older than 10 minutes')
  reset()
  turn(A, 'user', 'book Toit'); turn(A, 'assistant', 'Reply APPROVE or REJECT?'); tick()
  assert.equal(await resolve(actorA, 'reject'), null, 'approvals keep their explicit binding')
  assert.equal(await resolve(actorA, 'approve'), null)
  // Callers route the completed request: the webhook and dashboard replace the text, the shared path recurses once.
  const hook = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
  assert.match(hook, /if \(pendingAnswer\?\.rewrite\) \{[\s\S]{0,200}text = pendingAnswer\.rewrite/)
  const dash = readFileSync(new URL('../app/api/dashboard/chat/route.ts', import.meta.url), 'utf8')
  assert.match(dash, /if\(pendingAnswer\?\.rewrite\)\{[\s\S]{0,200}text=pendingAnswer\.rewrite/)
  const pim = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
  assert.match(pim, /if \(pendingAnswer\?\.rewrite\) return processIncomingMessage\(\{ \.\.\.params, text: pendingAnswer\.rewrite, semantic: null, pendingQuestionChecked: true \}\)/)
})

await check('LIVE 19 Oct: "Move to 8pm" is the reminder button, never a reservation time answer', async () => {
  await ask(actorA, 'Book a table for 2 at Toit this Saturday at 8')
  assert.equal(await resolve(actorA, 'Move to 8pm'), null)
  assert.equal(runs().length, 0)
  const hook = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
  assert.match(hook, /String\(formData\.get\('ButtonPayload'\) \|\| ''\)\.trim\(\) \|\| reminderButtonPayloadFromTitle\(String\(formData\.get\('ButtonText'\) \|\| ''\)\)/)
  assert.match(hook, /'move to 8pm': 'move_8pm'/)
  assert.ok(hook.indexOf("buttonPayload === 'move_8pm'") < hook.indexOf('await tryResolvePendingQuestion('), 'the tap is handled before any text routing')
})

await check('the WhatsApp research worker records the reply it sends, so the name question is the latest turn', () => {
  const cron = readFileSync(new URL('../app/api/cron/autonomous-runs/route.ts', import.meta.url), 'utf8')
  assert.match(cron, /if\(reservationResearchSent\)\{[\s\S]{0,200}from\('conversations'\)\.insert\(\{telegram_id:actor\.legacyTelegramId,role:'assistant',content:result\.text\}\)/)
})

;(globalThis as any).Date = RealDate
if (failures.length) { console.error(failures.join('\n\n')); process.exitCode = 1 }
else console.log('Pending-question registry passed: Toit follow-up resumes the reservation, no contentless reminder, ambiguity asks, TTL and owner binding hold.')
