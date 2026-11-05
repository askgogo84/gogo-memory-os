// Today feed phase 1 (approved mockup + docs, 5 Nov): ranked cards from stored data, owner-scoped, no Gmail call,
// Not now / Fewer like this, a failed source drops only its own cards, and actions never send on their own.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const f = await import('../lib/dashboard/today-feed')

const NOW = new Date('2026-11-05T06:30:00Z') // 12:00 IST, Thursday
const A = '918884501501', B = '919999999999'
const iso = (minsAgo: number) => new Date(NOW.getTime() - minsAgo * 60_000).toISOString()
const tables: Record<string, any[]> = {
  agent_activity: [
    { id: 'a1', telegram_id: A, event_type: 'watcher_triggered', message: 'Background Gogo found a high-signal web update: iPhone 17 256GB below ₹70,000', metadata_json: { type: 'web_search', watcher_id: 'w1', source_url: 'https://www.amazon.in/dp/X' }, created_at: iso(30) },
    { id: 'a2', telegram_id: A, event_type: 'watcher_triggered', message: 'Background Gogo found a high-signal web update: Product manager Bangalore', metadata_json: { type: 'web_search', watcher_id: 'w2', source_url: 'https://boards.greenhouse.io/x/jobs/1' }, created_at: iso(60) },
    { id: 'a3', telegram_id: A, event_type: 'watcher_triggered', message: 'Merged duplicate watch: iPhone', metadata_json: { watcher_id: 'w1', reason: 'duplicate' }, created_at: iso(10) },
    { id: 'a4', telegram_id: A, event_type: 'watcher_triggered', message: 'old', metadata_json: { type: 'web_search', watcher_id: 'w9' }, created_at: iso(60 * 30) },
    { id: 'a5', telegram_id: A, event_type: 'watcher_triggered', message: 'Background Gogo found a high-signal web update: iPhone again', metadata_json: { type: 'web_search', watcher_id: 'w1', source_url: 'javascript:alert(1)' }, created_at: iso(90) },
    { id: 'b1', telegram_id: B, event_type: 'watcher_triggered', message: 'Background Gogo found a high-signal web update: B secret', metadata_json: { type: 'web_search', watcher_id: 'wb' }, created_at: iso(5) },
  ],
  agent_watchers: [{ id: 'w1', telegram_id: A, condition_json: { query: 'iPhone 17 256GB price' } }, { id: 'w2', telegram_id: A, condition_json: { query: 'product manager jobs in Bangalore' } }],
  agent_open_loops: [
    { id: 'l1', telegram_id: A, status: 'active', kind: 'commitment', source_type: 'gmail_service_notice', title: 'Airtel postpaid ₹799 due Friday', summary: 'Bill email on 1 Nov.', updated_at: iso(120), last_seen_at: iso(120) },
    { id: 'l2', telegram_id: A, status: 'active', kind: 'followup', source_type: 'gmail_thread', title: 'Nithin has not replied about the Q4 invoice', summary: 'Two days with no reply.', updated_at: iso(200) },
    { id: 'l1b', telegram_id: A, status: 'active', kind: 'commitment', source_type: 'gmail_service_notice', title: 'Airtel postpaid ₹799 due Friday', summary: 'Bill email on 1 Nov.', updated_at: iso(130), last_seen_at: iso(130) },
    { id: 'l4', telegram_id: A, status: 'active', kind: 'waiting_on', source_type: 'approval', title: 'Waiting on my approval', updated_at: iso(20) },
    { id: 'l5', telegram_id: A, status: 'active', kind: 'waiting_on', source_type: 'conversation', title: 'Waiting on: Alert me once it lands', updated_at: iso(25) },
    { id: 'l3', telegram_id: B, status: 'active', kind: 'commitment', source_type: 'gmail_service_notice', title: 'B bill', updated_at: iso(10) },
  ],
  travel_tickets: [
    { id: 't1', telegram_id: A, type: 'flight', flight_no: 'EK 569', from_city: 'Bengaluru', to_city: 'Dubai', depart_at: new Date(NOW.getTime() + 16 * 3600_000).toISOString() },
    { id: 't2', telegram_id: A, type: 'flight', flight_no: 'AI 1', depart_at: new Date(NOW.getTime() + 72 * 3600_000).toISOString() },
  ],
  taste_facts: [{ telegram_id: A, domain: 'food', kind: 'diet_stated', value: 'Veg', forgotten_at: null }, { telegram_id: A, domain: 'food', kind: 'budget', value: 'Lunch under ₹350', forgotten_at: null }],
  reminders: [{ id: 'r1', telegram_id: A, sent: true, sent_at: iso(100) }, { id: 'r2', telegram_id: A, sent: true, sent_at: iso(60 * 20) }],
  documents: [{ id: 'd1', telegram_id: A, doc_type: 'receipt', created_at: iso(50) }],
}
const reads: string[] = []
let failTable: string | null = null
const db = { from(t: string) { const flt: Array<(r: any) => boolean> = []; let head = false; const b: any = {
  select(_c: string, o?: any) { head = !!o?.head; return b },
  eq(k: string, v: any) { if (k === 'telegram_id') { assert.equal(typeof v, 'string', `${t} owner filter is a string`); reads.push(t) } flt.push(r => String(r[k]) === String(v)); return b },
  in(k: string, vs: any[]) { flt.push(r => vs.includes(r[k])); return b }, gte(k: string, v: any) { flt.push(r => String(r[k] ?? '') >= v); return b },
  is(k: string, v: any) { flt.push(r => (r[k] ?? null) === v); return b }, order() { return b }, limit() { return b },
  then(res: any, rej: any) { if (failTable === t) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej); const data = (tables[t] || []).filter(r => flt.every(fn => fn(r))); return Promise.resolve(head ? { count: data.length, error: null } : { data, error: null }).then(res, rej) } }
  return b } }

const feed = await f.getTodayFeed(A, NOW, 'Asia/Kolkata', db)
const keys = (cs: any[]) => cs.map(c => c.key)
assert.deepEqual(keys(feed.needs), ['flight:t1', 'watch:a1', 'bill:l1'], 'Needs you: flight, then watch hit, then bill')
assert.ok(keys(feed.noticed).includes('jobs:a2') && keys(feed.noticed).includes('reply:l2') && keys(feed.noticed).includes('food:2026-11-05'))
assert.ok(!JSON.stringify(feed).includes('B secret') && !JSON.stringify(feed).includes('B bill'), "another person's data never shows")
assert.ok(!keys(feed.needs).includes('watch:a3'), 'a merged/stopped watch notice is not a hit')
assert.equal(feed.needs.filter(c => c.kind === 'watch').length, 1, 'one card per watch')
assert.ok(!keys(feed.needs).includes('flight:t2'), 'flights beyond 36 hours wait')
const watch = feed.needs.find(c => c.kind === 'watch')!
assert.equal(watch.title, 'iPhone 17 256GB below ₹70,000'); assert.equal(watch.action.href, 'https://www.amazon.in/dp/X')
assert.match(feed.needs.find(c => c.kind === 'flight')!.title, /^EK 569, Bengaluru to Dubai, /)
assert.equal(feed.needs.find(c => c.kind === 'bill')!.action.message, 'Remind me tomorrow at 10am about: Airtel postpaid ₹799 due Friday')
assert.match(feed.noticed.find(c => c.kind === 'food')!.title, /Veg · Lunch under ₹350/)
assert.deepEqual(feed.done, { remindersSent: 1, watchHits: 3, receiptsFiled: 1 }, 'done counts are today only (3 hits today, the 30-hour-old one excluded)')
assert.deepEqual(feed.failed, [])
assert.ok(!reads.some(t => /gmail|inbound_emails|email_attention/.test(t)), 'no Gmail or email store is read')
assert.equal(feed.needs.filter(c => c.kind === 'bill').length, 1, 'the same notice in two threads shows once')
assert.ok(!keys(feed.noticed).includes('reply:l4') && !keys(feed.noticed).includes('reply:l5'), 'approvals and chat lines are not replies')
console.log('✓ ranked cards from stored data; owner-scoped; one card per watch; stopped-watch notices and far flights left out')

// Unsafe links never become hrefs.
assert.equal(f.buildWatchCards([{ id: 'x', message: 'm', metadata_json: { type: 'web_search', source_url: 'javascript:alert(1)' }, created_at: iso(1) }], [], iso(100)).at(0)?.action.href, undefined)
// Food: weekdays 11:00-13:59 only.
assert.equal(f.buildFoodCard([{ kind: 'diet_stated', value: 'Veg' }], { hour: 19, weekday: 'Thu', day: 'd' }).length, 0)
assert.equal(f.buildFoodCard([{ kind: 'diet_stated', value: 'Veg' }], { hour: 12, weekday: 'Sat', day: 'd' }).length, 0)
assert.equal(f.buildFoodCard(null, { hour: 12, weekday: 'Thu', day: 'd' }).length, 0)

// Not now hides one card today; Fewer like this hides the kind for 14 days (noticed only).
tables.agent_activity.push({ id: 's1', telegram_id: A, event_type: 'today_card_hidden', metadata_json: { card: 'bill:l1', day: '2026-11-05' }, created_at: iso(5) })
tables.agent_activity.push({ id: 's2', telegram_id: A, event_type: 'today_kind_fewer', metadata_json: { kind: 'food' }, created_at: iso(60 * 24 * 3) })
tables.agent_activity.push({ id: 's3', telegram_id: A, event_type: 'today_card_hidden', metadata_json: { card: 'flight:t1', day: '2026-11-04' }, created_at: iso(60 * 24) })
tables.agent_activity.push({ id: 's4', telegram_id: B, event_type: 'today_card_hidden', metadata_json: { card: 'watch:a1', day: '2026-11-05' }, created_at: iso(5) })
const f2 = await f.getTodayFeed(A, NOW, 'Asia/Kolkata', db)
assert.ok(!keys(f2.needs).includes('bill:l1'), 'Not now hides it today')
assert.ok(keys(f2.needs).includes('flight:t1'), "yesterday's Not now does not carry over")
assert.ok(keys(f2.needs).includes('watch:a1'), "another person's Not now never hides mine")
assert.ok(!keys(f2.noticed).includes('food:2026-11-05'), 'Fewer like this hides the kind')
assert.equal(f.applyCardState([{ key: 'food:x', kind: 'food', section: 'noticed' } as any], [{ event_type: 'today_kind_fewer', metadata_json: { kind: 'food' }, created_at: iso(60 * 24 * 20) }], '2026-11-05', NOW).length, 1, 'fewer expires after 14 days')
console.log('✓ Not now (today only), Fewer like this (14 days), never across owners')

// A failing source drops only its cards.
failTable = 'travel_tickets'
const f3 = await f.getTodayFeed(A, NOW, 'Asia/Kolkata', db)
assert.ok(!keys(f3.needs).includes('flight:t1') && keys(f3.needs).includes('watch:a1')); assert.deepEqual(f3.failed, ['flights'])
failTable = null
await assert.rejects(() => f.getTodayFeed('', NOW, 'Asia/Kolkata', db), /today_feed_owner_required/)
assert.equal(f.localDay(new Date('2026-11-05T19:00:00Z')).day, '2026-11-06', 'IST day rolls over at midnight IST')
assert.equal(f.localDay(NOW).startIso, '2026-11-04T18:30:00.000Z')
console.log('✓ a failed source drops only its cards; local day in IST')

// Wiring: owner-scoped same-origin API; page never fails on the feed; actions hand off to WhatsApp unsent.
const api = readFileSync('app/api/dashboard/today-feed/route.ts', 'utf8')
assert.match(api, /if \(!sameOrigin\(req\)\) return NextResponse\.json\(\{ error: 'forbidden' \}, \{ status: 403 \}\)/)
assert.match(api, /!CARD_KEY_RE\.test\(card\)/)
assert.match(api, /telegram_id: String\(session\.telegramId\)/)
for (const k of ['watch:a1', 'food:2026-11-05', 'bill:3f2a-9c1e']) assert.ok(f.CARD_KEY_RE.test(k), k)
for (const k of ['evil:1', 'watch:', 'watch:a b', "watch:'; drop"]) assert.ok(!f.CARD_KEY_RE.test(k), k)
const page = readFileSync('app/dashboard/(app)/today/page.tsx', 'utf8')
assert.match(page, /getTodayFeed\(session\.telegramId\)\.catch\(\(\) => null\)/)
const ui = readFileSync('components/dashboard/today-feed.tsx', 'utf8')
assert.match(ui, /waLink\(c\.action\.message\)/); assert.doesNotMatch(ui, /#[0-9a-fA-F]{6}/, 'theme tokens only')
assert.match(ui, /min-h-\[44px\]/)
assert.match(ui, /href="\/dashboard\/alerts"/, 'phase 2: the footer links to the existing per-topic settings (What you hear about)')
console.log('✓ API is same-origin and owner-scoped; page survives a feed failure; actions open WhatsApp unsent')
console.log('Today feed checks passed')
