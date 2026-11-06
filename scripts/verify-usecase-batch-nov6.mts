// 6 Nov overnight run of Muse / Wajo / Duet / Instinct use cases on the live dashboard: routing and formatting
// misses fixed in one batch. Each case is the live message that failed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { flightBookingRequest } = await import('../lib/agent/flight-booking')
const { isTicketRetrievalAsk } = await import('../lib/services/asset-memory')
const { nearbyRewrite, placeAsk } = await import('../lib/agent/places-search')
const { parseProductAsk, pickProducts } = await import('../lib/agent/product-discovery')
const { redactSecretShapedText } = await import('../lib/bot/memory-redaction')

// W1: "Book a dentist for Thursday afternoon" went to flight booking ("the afternoon flight").
assert.equal(flightBookingRequest('Book a dentist for Thursday afternoon'), null)
assert.equal(flightBookingRequest('book me a flight for tomorrow'), null, 'a new search, not a pick')
assert.deepEqual(flightBookingRequest('Book the evening one'), { kind: 'time', window: 'evening' }, 'real picks still work')
assert.deepEqual(flightBookingRequest('book the cheapest'), { kind: 'cheapest' })
assert.deepEqual(flightBookingRequest('book #2'), { kind: 'number', n: 2 })
console.log('✓ "book a <something> for <when>" is never a flight pick')

// M9: "Watch for Coldplay concert tickets … alert me when they open" showed an old flight ticket.
assert.equal(isTicketRetrievalAsk('Watch for Coldplay concert tickets in Mumbai and alert me when they open'), false)
assert.equal(isTicketRetrievalAsk('tell me when IPL tickets go on sale'), false)
assert.equal(isTicketRetrievalAsk('show my movie tickets'), true, 'retrieval still works')
assert.equal(isTicketRetrievalAsk('open my boarding pass'), true)
console.log('✓ watching for tickets is not retrieving a saved ticket')

// W2: "Find a barber open on Sunday near me" got a Delhi web answer. Services are local places too.
assert.deepEqual(nearbyRewrite('Find a barber open on Sunday near me', 'Rajajinagar'), { text: 'Find a barber open on Sunday in Rajajinagar' })
assert.ok(placeAsk('Find a barber open on Sunday in Rajajinagar'))
for (const t of ['find a dentist near me', 'find a plumber nearby', 'suggest a good car service centre near me', 'any vets near me']) assert.ok(nearbyRewrite(t, 'Rajajinagar') && !('needArea' in nearbyRewrite(t, 'Rajajinagar')!), t)
for (const p of ['app/api/dashboard/chat/route.ts', 'app/api/webhooks/whatsapp/route.ts']) assert.match(readFileSync(p, 'utf8'), /\|barber\|dentist\|dental\|doctor\|/, `${p} local-places gate knows services`)
console.log('✓ barbers, dentists, plumbers, mechanics, vets: local places in the saved home area')

// M2: "a standing desk under ₹25,000 with good reviews" searched for "good reviews" in titles.
const desk = parseProductAsk('Find me a standing desk under ₹25,000 with good reviews')!
assert.equal(desk.query, 'standing desk'); assert.equal(desk.maxPrice, 25000); assert.equal(desk.rated, true)
const items = [
  { title: 'Standing Desk Electric Height Adjustable', source: 'Amazon', link: 'https://a.in/1', price: 21000, priceText: '₹21,000', rating: 3.6, ratingCount: 40 },
  { title: 'Ergonomic Standing Desk Dual Motor', source: 'Flipkart', link: 'https://f.in/2', price: 24000, priceText: '₹24,000', rating: 4.5, ratingCount: 900 },
  { title: 'Standing Desk Pro', source: 'Croma', link: 'https://c.in/3', price: 30000, priceText: '₹30,000', rating: 4.8, ratingCount: 2000 },
]
const picked = pickProducts(desk, items as any).picked
assert.equal(picked.length, 2, 'over-budget dropped'); assert.equal(picked[0].source, 'Flipkart', 'well-reviewed first')
assert.equal(parseProductAsk('find a navy linen shirt under 2000')!.rated, undefined)
console.log('✓ "with good reviews" ranks by rating instead of filtering titles')

// M3b / D6: business numbers and harmless card words were withheld.
assert.equal(redactSecretShapedText('Book at 9902012345 or via the site'), 'Book at 9902012345 or via the site')
assert.equal(redactSecretShapedText('(reservations 9845012345)'), '(reservations 9845012345)')
assert.equal(redactSecretShapedText('Review your bank/credit card statements for recurring charges'), 'Review your bank/credit card statements for recurring charges')
assert.match(redactSecretShapedText('my card number is 4111 1111 1111 1111'), /withheld/, 'a real card number stays hidden')
assert.match(redactSecretShapedText('password: hunter2'), /withheld/, 'passwords always hidden')
assert.match(redactSecretShapedText('send it to 123456789012 please'), /withheld/, 'unlabelled long digit runs stay hidden')
assert.equal(redactSecretShapedText('Payment order successful - 6856147904'), 'Payment order successful - 6856147904', 'an order number is shown (6 Nov live)')
assert.equal(redactSecretShapedText('Order ID: OD123456789012345 shipped'), 'Order ID: OD123456789012345 shipped')
assert.match(redactSecretShapedText('account number 123456789012'), /withheld/, 'account numbers still hidden')
console.log('✓ business phone numbers shown; card, password and unlabelled ids still withheld')

// M10 and W9 wiring.
const uf = readFileSync('lib/agent/understand-first.ts', 'utf8')
assert.match(uf, /move\|moving\|shift\(\?:ing\)\?\|relocat/, 'a move is a project, not a leisure plan question')
const food = readFileSync('lib/agent/food-comparison.ts', 'utf8')
assert.match(food, /savedPlaces\(owner\)[\s\S]{0,200}home\.pincode/, 'food comparison uses the saved home pincode')
console.log('✓ a move gets a checklist, not a leisure question; food offers use the saved home pincode')

// D3: "Prep me for my next meeting" got a generic menu. Calendar + emails, read-only.
const mp = await import('../lib/agent/meeting-prep-ask')
for (const t of ['Prep me for my next meeting', 'prepare me for my 3pm meeting', 'brief me on my next call', "what's my next meeting about?", 'meeting prep']) assert.ok(mp.isMeetingPrepAsk(t), t)
for (const t of ['prepare a presentation for the meeting tomorrow', 'remind me to prep for the meeting at 5', 'book a meeting room']) assert.equal(mp.isMeetingPrepAsk(t), false, t)
const now = Date.parse('2026-11-06T09:00:00+05:30')
const events = [
  { summary: 'All day offsite', start: '2026-11-06', label: 'All day' },
  { summary: 'Done standup', start: '2026-11-06T08:00:00+05:30', label: '8:00–8:15 am' },
  { summary: 'Tipplr x ONDC sync', start: '2026-11-06T11:00:00+05:30', label: '11:00–11:30 am', meetLink: 'https://meet.google.com/abc-defg-hij',
    attendees: [{ email: 'me@x.in', self: true }, { email: 'nithin@tipplr.in', displayName: 'Nithin', responseStatus: 'accepted' }, { email: 'room@x.in', resource: true }, { email: 'rishi@ondc.org', responseStatus: 'needsAction' }] },
  { summary: 'Later', start: '2026-11-06T15:00:00+05:30', label: '3:00 pm' },
]
const next = mp.nextMeeting(events as any, now)!
assert.equal(next.summary, 'Tipplr x ONDC sync', 'skips all-day and finished meetings')
const note = mp.formatPrep(next, [{ subject: 'Catalogue update', from: 'Rishi <rishi@ondc.org>', date: '', snippet: 'Sharing the latest sheet' }], now)
assert.match(note, /^🗓️ \*Tipplr x ONDC sync\*\n11:00–11:30 am · in about 2 h\nJoin: https:\/\/meet\.google\.com\/abc-defg-hij/)
assert.match(note, /Who's coming \(2\)\*\n• Nithin · ✓\n• rishi · no reply yet/)
assert.match(note, /• Catalogue update · Rishi\n  Sharing the latest sheet/)
assert.match(note, /I will show it to you before anything is sent/)
assert.match(mp.formatPrep(next, null, now), /Connect Gmail and I can add your latest emails/)
for (const p of ['app/api/dashboard/chat/route.ts', 'app/api/webhooks/whatsapp/route.ts']) assert.match(readFileSync(p, 'utf8'), /lib\/agent\/meeting-prep-ask/, `${p} wired`)
console.log('✓ meeting prep: next timed meeting, guests with replies, call link, latest emails; nothing sent')

// M4: "Monitor prices for a Bengaluru to Delhi flight…" searched "Prices For A Bengaluru" to "Delhi Flight" (no code).
const tr = await import('../lib/agent/travel-research')
const at = new Date('2026-11-06T03:00:00+05:30')
const route = (t: string) => { const b = tr.parseFlightBriefText(t, at); return `${b.originCode}-${b.destinationCode} ${b.departDate}${b.watchAsked ? ' watch' : ''}` }
assert.equal(route('Bengaluru to Delhi flight on 20 Dec'), 'BLR-DEL 2026-12-20', '"flight" after the city is not part of its name')
assert.equal(route('book a Bengaluru to Delhi flight on 20 Dec'), 'BLR-DEL 2026-12-20', '"book a" is not the origin')
assert.equal(route('Monitor prices for a Bengaluru to Delhi flight on 20 Dec and tell me when it drops'), 'BLR-DEL 2026-12-20 watch')
assert.equal(route('Alert me when Bengaluru to Delhi flight fares on 20 Dec drop below ₹5,000'), 'BLR-DEL 2026-12-20 watch')
assert.equal(route('flight from Delhi to Bengaluru tomorrow'), 'DEL-BLR 2026-11-07')
const started = tr.flightSearchStartedText(tr.parseFlightBriefText('Alert me when Bengaluru to Delhi flight fares on 20 Dec drop below ₹5,000', at))
assert.match(started, /^Searching Bengaluru to Delhi, 20 Dec 2026: 1 adult, economy, one-way\./)
assert.match(started, /I can't keep watching flight fares on my own yet, so this is today's price/, 'honest about the missing fare watch')
assert.doesNotMatch(tr.flightSearchStartedText(tr.parseFlightBriefText('flights BLR to DEL 20 Dec', at)), /keep watching/)
console.log('✓ flight routes ignore "flight", "book a" and watch wording; a fare-watch ask is told plainly it is a one-time check')
console.log('Use-case batch (6 Nov) checks passed')
