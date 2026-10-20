// Booking engine phase 1 (approved mock, 20 Oct): signed-in booking apps ask to connect once instead of
// burning minutes on a login wall; provider-confirmed bookings land in "My bookings" with a reminder; the
// dashboard queues reservation research in the background like WhatsApp.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const be = await import('../lib/agent/booking-engine.ts')

assert.equal(be.signedInBookingSiteForUrl('https://www.zomato.com/bangalore/district-6-pub-brewery-kitchen-malleshwaram-bangalore/book')?.id, 'zomato')
assert.equal(be.signedInBookingSiteForUrl('https://www.district.in/restaurants/district-6')?.id, 'district')
assert.equal(be.signedInBookingSiteForUrl('https://www.eazydiner.com/bengaluru/toit')?.id, 'eazydiner')
assert.equal(be.signedInBookingSiteForUrl('https://toit.reservego.co/widget'), null, 'first-party / ReserveGo pages need no sign-in')
assert.equal(be.signedInBookingSiteForUrl('not a url'), null)
console.log('PASS signed-in booking sites recognised from the provider URL')

const zomato = be.signedInBookingSiteForUrl('https://www.zomato.com/x/book')!
assert.equal(be.isSiteConnected([], zomato), false)
assert.equal(be.isSiteConnected([{ siteId: 'zomato', status: 'active' }], zomato), true)
assert.equal(be.isSiteConnected([{ siteId: 'zomato', status: 'human_challenge' }], zomato), false, 'an unfinished sign-in is not connected')
assert.equal(be.isSiteConnected([{ siteId: 'district', status: 'active' }], zomato), false)
console.log('PASS connection check is per site and ignores unfinished sign-ins')

const reply = be.connectFirstReply({ site: zomato, restaurant: 'District 6', date: '2026-10-24', time: '20:00', partySize: 2, providerUrl: 'https://www.zomato.com/x/book' })
assert.match(reply, /Zomato isn't connected yet/)
assert.match(reply, /type the code yourself\. I never see or store the code/)
assert.match(reply, /dashboard\/settings\?section=connections/)
assert.match(reply, /table for 2, Sat, 24 Oct, 8 pm/)
assert.doesNotMatch(reply, /\bbooked\b/i, 'never claims a booking')
console.log('PASS connect-once reply (mock screen 2)')

assert.equal(be.confirmationRefFrom('Your table is confirmed. Booking ID: tsajkdx'), 'TSAJKDX')
assert.equal(be.confirmationRefFrom('Reservation No. 4471-AB confirmed'), '4471-AB')
assert.equal(be.confirmationRefFrom('See you soon!'), null)
console.log('PASS confirmation reference parsed from the provider page')

const rr = readFileSync(new URL('../lib/agent/restaurant-reservation.ts', import.meta.url), 'utf8')
const i = rr.indexOf('const signInSite=typeof bookingEngine?.signedInBookingSiteForUrl'), j = rr.indexOf('inspected=await runSecureBrowser({')
assert.ok(i > 0 && j > i, 'connection check runs before any browser time is spent')
assert.match(rr, /if\(inspected\.status==='blocked'\)return signInSite\?connectFirst\(\):unreadable\(\)/)
const worker = readFileSync(new URL('../lib/agent/restaurant-reservation-worker.ts', import.meta.url), 'utf8')
const vi = worker.indexOf("const verified=submitted&&confirmedText(result)"), ri = worker.indexOf('start_at:startAt')
assert.ok(vi > 0 && ri > vi, 'start_at is recorded only after the provider confirmation is verified')
assert.match(worker, /eq\('id',event\.id\)\.eq\('telegram_id',tg\)/)
const route = readFileSync(new URL('../app/api/dashboard/chat/route.ts', import.meta.url), 'utf8')
assert.match(route, /await queueRestaurantReservationResearch\(\{ actor, text, messageId: shadowEventId \}\)/)
assert.doesNotMatch(route, /tryRunRestaurantReservation\(/, 'the dashboard no longer waits on provider pages inline')
console.log('BOOKING_ENGINE_OK')
