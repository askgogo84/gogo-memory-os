// 27 Oct 13:53 live: "flights … 19 Nov" then "Book the cheapest" before results arrived booked the 18 Nov result.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const { supabaseAdmin } = await import('../lib/supabase-admin.ts')
const b = await import('../lib/agent/flight-booking.ts')
let rows: any[] = []; const seen: any = {}
const originalFrom = (supabaseAdmin as any).from
;(supabaseAdmin as any).from = (table: string) => { const q: any = { select() { return q }, eq(k: string, v: any) { seen[k] = v; return q }, in(k: string, v: any) { seen[k] = v; return q }, gte(k: string, v: any) { seen.gte = v; return q }, order() { return q }, limit() { return Promise.resolve({ data: rows, error: null }) } }; return q }
const actor: any = { legacyTelegramId: '918884501501' }
const now = Date.now(), iso = (m: number) => new Date(now - m * 60_000).toISOString()
rows = [{ id: 'r2', started_at: iso(1), metadata_json: { context: { startDate: '2026-11-19', origin: { code: 'BLR' }, destination: { code: 'MAA' } } } }]
assert.deepEqual(await b.newerFlightSearchPending(actor, iso(40)), { date: '2026-11-19', route: 'BLR → MAA' })
assert.deepEqual(seen.status, ['queued', 'running', 'failed', 'completed']); assert.equal(seen.telegram_id, '918884501501'); assert.equal(seen.type, 'travel_research')
rows = [{ id: 'r3', status: 'failed', started_at: iso(2), metadata_json: { context: { startDate: '2026-11-20', origin: { code: 'BLR' }, destination: { code: 'MAA' } } } }]
assert.deepEqual(await b.newerFlightSearchPending(actor, iso(40)), { date: '2026-11-20', route: 'BLR → MAA', failed: true }, '27 Oct 15:56: a newer failed search blocks booking the older date')
rows = [{ id: 'r1', started_at: iso(50), metadata_json: {} }]
assert.equal(await b.newerFlightSearchPending(actor, iso(40)), null, 'an older running search does not block booking the newer result')
rows = []
assert.equal(await b.newerFlightSearchPending(actor, iso(40)), null)
const src = (await import('node:fs')).readFileSync(new URL('../lib/agent/flight-booking.ts', import.meta.url), 'utf8')
assert.ok(src.indexOf('newerFlightSearchPending(actor, last?.startedAt') < src.indexOf('const option = pickFlight(last.options, pick)'), 'checked before picking a flight')
;(supabaseAdmin as any).from = originalFrom
// 27 Oct 13:57 (owner): "why does it keep asking the same details" — the last booking's details are offered again.
const fb = { contact_mobile: '8310441698', profile: { travellers: [{ name: 'Goverdhan MD', title: 'Mr', gender: 'Male' }], email: 'goverdhan.md@gmail.com', seat: 'free' } }
;(supabaseAdmin as any).from = () => { const q: any = { select() { return q }, eq() { return q }, not() { return q }, gte() { return q }, order() { return q }, limit() { return Promise.resolve({ data: rows, error: null }) } }; return q }
rows = [{ metadata_json: { flight_booking: { ...fb, pii_purged: true } } }, { metadata_json: { flight_booking: fb } }]
assert.deepEqual(await b.loadSavedBookingProfile(actor, 1), { travellers: fb.profile.travellers, contact: { email: 'goverdhan.md@gmail.com', mobile: '8310441698' }, seat: 'free' }, 'purged rows are skipped')
assert.equal(await b.loadSavedBookingProfile(actor, 2), null, 'a different traveller count asks again')
rows = [{ metadata_json: { flight_booking: { ...fb, contact_mobile: null } } }]
assert.equal(await b.loadSavedBookingProfile(actor, 1), null)
;(supabaseAdmin as any).from = originalFrom
assert.deepEqual(b.flightBookingRequest('Book'), { kind: 'cheapest' }, 'bare "book" = Gogo\'s pick (#1)')
assert.deepEqual(b.flightBookingRequest('book 2'), { kind: 'number', n: 2 })
assert.equal(b.flightBookingRequest('book a table for 2'), null)
assert.ok(src.includes("profile: { travellers, email: contact.email, seat }") && src.includes("profile: null, pii_purged: true"), 'profile saved with the booking and purged with it')
// 27 Oct 15:57: a missing title is asked for alone and merged with the details already sent.
assert.equal(b.withTitle('Goverdhan MD\ngoverdhan.md@gmail.com\n8310441698\nFree seat', 'Mr'), 'Mr Goverdhan MD\ngoverdhan.md@gmail.com\n8310441698\nFree seat')
const merged = b.parseBookingDetails(b.withTitle('Goverdhan MD\ngoverdhan.md@gmail.com\n8310441698\nFree seat', 'Mr'), 1, { domestic: true })
assert.deepEqual(merged.problems, []); assert.equal(merged.travellers[0].title, 'Mr'); assert.equal(merged.seat, 'free')
const noTitle = b.parseBookingDetails('Goverdhan MD\ngoverdhan.md@gmail.com\n8310441698\nFree seat', 1, { domestic: true })
assert.ok(noTitle.problems.length === 1 && /Mr, Ms or Mrs/.test(noTitle.problems[0]) && noTitle.contact && noTitle.seat, 'only the title is missing')
const src2 = (await import('node:fs')).readFileSync(new URL('../lib/agent/flight-booking.ts', import.meta.url), 'utf8')
assert.ok(src2.includes('Almost done. Is that Mr, Ms or Mrs?') && src2.includes("I've kept the rest."))
assert.ok(src2.includes('older && last?.context?.startDate === older[1] ? null'), '"book from the <date> results" books the named older search')
console.log('BOOK_LATEST_SEARCH_OK')
