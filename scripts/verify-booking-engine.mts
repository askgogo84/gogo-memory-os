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
assert.equal(be.isSiteConnected([{ siteId: 'zomato', status: 'active', via: 'vault' }], zomato), false, 'a saved phone number still needs a code each visit')
assert.equal(be.isSiteConnected([{ siteId: 'zomato', status: 'active', via: 'session' }], zomato), true)
console.log('PASS connection check is per site and ignores unfinished sign-ins')

const reply = be.connectFirstReply({ site: zomato, restaurant: 'District 6', date: '2026-10-24', time: '20:00', partySize: 2, providerUrl: 'https://www.zomato.com/x/book' })
assert.match(reply, /Zomato isn't signed in for me yet/)
assert.match(reply, /type the code yourself\. I never see or store the code/)
assert.match(reply, /section=connections&signin=zomato/, 'one-tap sign-in link for that site')
assert.match(reply, /dashboard\/settings\?section=connections/)
assert.match(reply, /table for 2, Sat, 24 Oct, 8 pm/)
assert.doesNotMatch(reply, /\bbooked\b/i, 'never claims a booking')
console.log('PASS connect-once reply (mock screen 2)')

assert.equal(be.confirmationRefFrom('Your table is confirmed. Booking ID: tsajkdx'), 'TSAJKDX')
assert.equal(be.confirmationRefFrom('Reservation No. 4471-AB confirmed'), '4471-AB')
assert.equal(be.confirmationRefFrom('See you soon!'), null)
console.log('PASS confirmation reference parsed from the provider page')

const rr = readFileSync(new URL('../lib/agent/restaurant-reservation.ts', import.meta.url), 'utf8')
const i = rr.indexOf('let signInSite=typeof bookingEngine?.signedInBookingSiteForUrl'), j = rr.indexOf('inspected=await runSecureBrowser({')
assert.ok(i > 0 && j > i, 'connection check runs before any browser time is spent')
assert.match(rr, /if\(inspected\.status==='blocked'\)\{\n\s+if\(!signInSite\)return unreadable\(\)/)
assert.match(rr, /status:'needs_reauth'\}\)/, 'a sign-in wall marks the saved connection for reconnect')
assert.match(rr, /if\(signInSite\)\{await markSignInForReconnect\(\);return connectFirst\(\)\}/, 'a timeout marks it too')
const worker = readFileSync(new URL('../lib/agent/restaurant-reservation-worker.ts', import.meta.url), 'utf8')
const vi = worker.indexOf("const verified=submitted&&confirmedText(result)"), ri = worker.indexOf('start_at:startAt')
assert.ok(vi > 0 && ri > vi, 'start_at is recorded only after the provider confirmation is verified')
assert.match(worker, /eq\('id',event\.id\)\.eq\('telegram_id',tg\)/)
const route = readFileSync(new URL('../app/api/dashboard/chat/route.ts', import.meta.url), 'utf8')
assert.match(route, /await queueRestaurantReservationResearch\(\{ actor, text, messageId: shadowEventId \}\)/)
assert.doesNotMatch(route, /tryRunRestaurantReservation\(/, 'the dashboard no longer waits on provider pages inline')
console.log('BOOKING_ENGINE_OK')

// ---- Compare across apps (20 Oct: "search dineout the best options and rank them by discount") ----
{
  assert.deepEqual(be.offerFrom('District 6 - Flat 20% off on total bill | Swiggy Dineout'), { percent: 20, amount: 0, label: 'flat 20% off' })
  assert.equal(be.offerFrom('Get up to 25% off with EazyDiner Prime')?.percent, 25)
  assert.equal(be.offerFrom('Book now and get ₹500 off')?.amount, 500)
  assert.equal(be.offerFrom('Book a table online at District 6'), null)
  assert.equal(be.offerFrom('Rated 4.3 by 95% of diners'), null, 'a rating percentage is not an offer')
  const results = [
    { url: 'https://www.zomato.com/bangalore/district-6-pub-brewery-kitchen-malleshwaram-bangalore/book', title: 'Book table at District 6 Pub Brewery & Kitchen', snippet: 'Quick, easy and free table reservation' },
    { url: 'https://www.swiggy.com/dineout/bangalore/district-6-pub-brewery-and-kitchen-malleshwaram', title: 'District 6: Pub Brewery And Kitchen', snippet: 'Flat 15% off on total bill' },
    { url: 'https://www.swiggy.com/restaurants/district-6-malleshwaram', title: 'Order food online', snippet: '20% off on delivery' },
    { url: 'https://www.eazydiner.com/bengaluru/district-6-pub-brewery-kitchen', title: 'District 6 - EazyDiner', snippet: 'Up to 25% off with Prime' },
  ]
  const opts = be.collectBookingOptions(results, ['zomato'])
  assert.deepEqual(opts.map(o => o.platform.id), ['zomato', 'swiggy_dineout', 'eazydiner'], 'Swiggy delivery pages are not table options')
  const ranked = be.rankBookingOptions(opts)
  assert.deepEqual(ranked.map(o => o.platform.id), ['eazydiner', 'swiggy_dineout', 'zomato'], 'biggest discount first')
  const tie = be.rankBookingOptions(be.collectBookingOptions([results[0], { ...results[3], snippet: 'Book a table' }], ['zomato']))
  assert.equal(tie[0].platform.id, 'zomato', 'no offers: the signed-in app wins')
  const card = be.bookingOptionsReply({ restaurant: 'District 6', date: '2026-10-24', time: '20:00', partySize: 2, ranked })
  assert.match(card, /⭐ EazyDiner: up to 25% off/)
  assert.match(card, /• Swiggy Dineout: flat 15% off/)
  assert.match(card, /• Zomato: no offer listed · signed in/)
  assert.match(card, /sign in to EazyDiner once \(you type the code; I never see it\)/)
  assert.match(card, /signin=eazydiner/)
  assert.doesNotMatch(card, /\bbooked\b/i)
  const signedBest = be.bookingOptionsReply({ restaurant: 'District 6', ranked: tie })
  assert.match(signedBest, /Checking live tables there now; I'll ask before booking/)
  const rr2 = readFileSync(new URL('../lib/agent/restaurant-reservation.ts', import.meta.url), 'utf8')
  assert.ok(rr2.indexOf('findBookingOptions(intent,connectedIds)') < rr2.indexOf('inspected=await runSecureBrowser({'), 'compare runs before any browser read')
  assert.match(rr2, /if\(!best\.connected\)return paused\(bookingEngine\.bookingOptionsReply/)
  console.log('PASS compare: offers parsed, ranked by discount, signed-in tiebreak, card text')
}
console.log('BOOKING_COMPARE_OK')

// ---- Offers from public listing pages (20 Oct live: 4 apps found, no offers in snippets) ----
{
  const html = '<html><head><script>var x="99% off"</script><style>.a{}</style></head><body><h1>District 6</h1><div class="offer">Flat&nbsp;20% off on total bill</div></body></html>'
  assert.equal(be.listingText(html).includes('99% off'), false, 'script text is ignored')
  assert.equal(be.offerFrom(be.listingText(html))?.percent, 20)
  const base = be.collectBookingOptions([
    { url: 'https://www.swiggy.com/dineout/bangalore/district-6', title: 'District 6', snippet: '' },
    { url: 'https://www.eazydiner.com/bengaluru/district-6', title: 'District 6', snippet: 'Up to 25% off' },
    { url: 'https://www.zomato.com/bangalore/district-6/book', title: 'District 6', snippet: '' },
  ], [])
  const calls: string[] = []
  const fakeFetch = (async (url: string) => { calls.push(url); if (url.includes('swiggy')) return new Response(html, { status: 200 }); if (url.includes('zomato')) return new Response('blocked', { status: 403 }); throw new Error('net') }) as any
  const enriched = await be.enrichOffersFromListings(base, fakeFetch)
  assert.equal(enriched.find(o => o.platform.id === 'swiggy_dineout')?.offer?.percent, 20, 'offer read from the public page')
  assert.equal(enriched.find(o => o.platform.id === 'eazydiner')?.offer?.percent, 25, 'snippet offer kept, page not fetched')
  assert.equal(enriched.find(o => o.platform.id === 'zomato')?.offer, null, 'a blocked page keeps no offer')
  assert.ok(!calls.some(u => u.includes('eazydiner')))
  console.log('PASS listing offers: public page read, scripts ignored, blocked pages tolerated')
}
console.log('BOOKING_LISTING_OFFERS_OK')

 // Security P1: reservation offers may contain untrusted search-result/redirect URLs.
 // Missing discount snippets must NOT cause application-server fetches to any host.
{
  const options = be.collectBookingOptions([
    { url: 'https://www.zomato.com/bangalore/example/book', title: 'Example venue', snippet: '' },
  ], [])
  assert.equal(options.length, 1)
  const originalFetch = globalThis.fetch
  const attempts: string[] = []
  globalThis.fetch = (async (url: any) => {
    attempts.push(String(url))
    throw new Error('production server fetch should never be called')
  }) as typeof fetch
  try {
    const inputs = [
      ...options,
      { ...options[0], url: 'https://169.254.169.254/latest/meta-data' },
      { ...options[0], url: 'https://public.example/redirect-to-private' },
      { ...options[0], url: 'https://127.0.0.1/internal' },
    ]
    const returned = await be.enrichOffersFromListings(inputs)
    assert.deepEqual(returned, inputs, 'production returns search-provider evidence untouched')
    assert.deepEqual(attempts, [], 'no server call even for permitted initial host or private redirect')
  } finally {
    globalThis.fetch = originalFetch
  }
  console.log('PASS booking listing SSRF: no default fetch, including metadata IP or redirect')
}

// The only allowed HTML fetching is by an explicitly injected inert fixture.
// It must use manual redirects and refuse the 302 response without following.
{
  const options = be.collectBookingOptions([
    { url: 'https://www.zomato.com/bangalore/example/book', title: 'Example venue', snippet: '' },
  ], [])
  const redirectPolicies: string[] = []
  const fakeRedirect = (async (_url: string, init: any) => {
    redirectPolicies.push(String(init.redirect))
    return Response.redirect('http://169.254.169.254/latest/meta-data', 302)
  }) as typeof fetch
  const out = await be.enrichOffersFromListings(options, fakeRedirect)
  assert.equal(out.length, 1)
  assert.equal(out[0].offer, null, 'synthetic redirect is not treated as offer evidence')
  assert.deepEqual(redirectPolicies, ['manual'], 'injected fixture forbids automatic redirect follow')
  console.log('PASS booking listing injected fixture rejects public-to-internal redirect')
}
{
  const next = '<script id="__NEXT_DATA__" type="application/json">{"props":{"offers":[{"title":"Flat 15% off on total bill"}],"track":"abc"}}</script><script>analytics("90% off")</script><div>District 6</div>'
  assert.equal(be.offerFrom(be.listingText(next))?.percent, 15, 'offer from embedded page data; other scripts ignored')
  console.log('PASS embedded page-data offers')
}
