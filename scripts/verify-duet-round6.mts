// Duet parity round 6 (24 Oct live battery): research mode, page summaries, inbox digest card, Make for decks and
// sheets, WhatsApp headings, draft sign-offs, FX fallback.
import assert from 'node:assert/strict'
import * as DR from '../lib/agent/deep-research.ts'
import * as US from '../lib/agent/url-summary.ts'
import { hotelResearchEvidence, isHotelDiscoveryResearch } from '../lib/agent/hotel-research-evidence.ts'
import { isMakeDeliverableRequest } from '../lib/agent/make-request.ts'
import { markdownHeadingsToBold } from '../lib/bot/format-response.ts'

const failures: string[] = []
async function check(label: string, fn: () => unknown) { try { await fn(); console.log('PASS ' + label) } catch (e: any) { failures.push(`${label}: ${e.message}`) } }

await check('research asks are recognised; personal or plain questions are not', () => {
  assert.ok(DR.isDeepResearchRequest('Research the best electric scooters under 1.5 lakh in India with sources'))
  assert.ok(DR.isDeepResearchRequest('Do a deep research on air purifiers for Bengaluru'))
  assert.ok(DR.isDeepResearchRequest('Compare Ather 450X and Ola S1 Pro with sources'))
  assert.ok(!DR.isDeepResearchRequest('Research my emails from Nithin'))
  assert.ok(!DR.isDeepResearchRequest('What is the weather tomorrow?'))
  assert.ok(!DR.isDeepResearchRequest('Who is the CEO of Zomato?'))
})

await check('research runs several searches, dedupes sources, reads pages and cites only used sources', async () => {
  const calls: string[] = []
  const search = async (q: string) => { calls.push(q); return [
    { title: `Result A for ${q}`, url: 'https://example.com/a', content: 'Ather 450X ₹1.4 lakh, 111 km range' },
    { title: `Result ${calls.length}`, url: `https://example.com/${calls.length}?utm=x`, content: 'TVS iQube ₹1.1 lakh' },
  ] as any }
  const fetchImpl = (async () => new Response('<html><body><p>Ola S1 Pro costs ₹1.3 lakh and has 195 km range.</p></body></html>', { headers: { 'content-type': 'text/html' } })) as any
  const model = async (prompt: string, _n: number, m: string) => m.includes('haiku') ? 'ev scooters under 1.5 lakh 2026\nather 450x vs tvs iqube price\nola s1 pro range review' : 'TVS iQube is the value pick [2]. Ather 450X costs ₹1.4 lakh [1].'
  const out = await DR.runDeepResearch('Research the best electric scooters under 1.5 lakh in India with sources', { search, fetchImpl, model } as any)
  assert.equal(calls.length, 3)
  assert.match(out.text, /^🔎 TVS iQube/)
  assert.match(out.text, /Sources:\n\[1\] Result A/)
  assert.ok(out.sources.filter(s => s.url === 'https://example.com/a').length === 1, 'deduped')
  assert.doesNotMatch(out.text, /\[3\] /, 'uncited sources are not listed')
})

await check('research with no results says so instead of guessing', async () => {
  const out = await DR.runDeepResearch('Research quantum widgets with sources', { search: async () => [], model: async () => 'q1\nq2' } as any)
  assert.match(out.text, /couldn't find reliable sources/)
})

await check('page summary only for an explicit ask on a public page; bare links and private hosts are left alone', () => {
  assert.deepEqual(US.urlSummaryRequest('Summarise https://en.wikipedia.org/wiki/Bengaluru'), { url: 'https://en.wikipedia.org/wiki/Bengaluru', ask: 'Summarise' })
  assert.ok(US.urlSummaryRequest('tl;dr https://example.com/post.'))
  assert.equal(US.urlSummaryRequest('https://example.com/post'), null)
  // 24 Oct battery: the public site is summarised; the app is never fetched.
  assert.ok(US.urlSummaryRequest('Summarise https://www.askgogo.in/journal/memory-is-the-product/'))
  assert.equal(US.urlSummaryRequest('Summarise https://app.askgogo.in/dashboard/reports/x'), null)
  assert.equal(US.urlSummaryRequest('Save this link https://example.com/post'), null)
  assert.equal(US.urlSummaryRequest('Summarise http://localhost:3000/admin'), null)
  assert.equal(US.urlSummaryRequest('Summarise https://docs.google.com/document/d/x'), null)
})

await check('page summary fetches, extracts readable text and cites the page', async () => {
  const html = `<html><head><title>Bengaluru - Wikipedia</title><script>x()</script></head><body><nav>menu</nav><main><p>${'Bengaluru is the capital of Karnataka. '.repeat(20)}</p></main></body></html>`
  const fetchImpl = (async () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })) as any
  let seen = ''
  const out = await US.summariseUrl({ url: 'https://en.wikipedia.org/wiki/Bengaluru', ask: 'Summarise' }, { fetchImpl, model: async p => { seen = p; return 'Bengaluru is the capital of Karnataka.\n• Population 13 million' } })
  assert.match(out!, /^📄 Bengaluru - Wikipedia/); assert.match(out!, /Source: https:\/\/en\.wikipedia\.org\/wiki\/Bengaluru$/)
  assert.doesNotMatch(seen, /x\(\)|menu/)
  const empty = await US.summariseUrl({ url: 'https://x.com/a', ask: 'Summarise' }, { fetchImpl: (async () => new Response('<p>hi</p>', { headers: { 'content-type': 'text/html' } })) as any, model: async () => 'x' })
  assert.equal(empty, null)
})

await check('decks, budget sheets and itineraries are Make deliverables; reminders, lists and replies are not', () => {
  for (const t of ['Make a 5 slide pitch deck outline for AskGogo', 'Make a budget sheet for a 3 day Goa trip for 4 people', 'Create a 3 day itinerary for Coorg', 'Make a one-page brief comparing Ather 450X and Ola S1 Pro']) assert.ok(isMakeDeliverableRequest(t), t)
  for (const t of ['Make a reminder for 5pm', 'Make a list of groceries', 'Write a reply to Nithin', 'Make a plan for my day']) assert.ok(!isMakeDeliverableRequest(t), t)
})

await check('WhatsApp replies turn markdown headings into bold lines', () => {
  assert.equal(markdownHeadingsToBold('## *ACCOMMODATION* (2 nights)\n- Villa'), '*ACCOMMODATION (2 nights)*\n- Villa')
  assert.equal(markdownHeadingsToBold('# Title #'), '*Title*')
  assert.equal(markdownHeadingsToBold('Price #1 pick'), 'Price #1 pick')
})

const claude: any = await import('../lib/services/claude.ts').catch(() => null)
await check('a drafted email never signs off as Gogo', () => {
  if (!claude?.stripGogoSignoff) throw new Error('claude service failed to load')
  assert.equal(claude.stripGogoSignoff('Hi Nithin,\n\nCould you send the docs?\n\nThanks!\n\nBest,\nGogo\n\n---\nWant it shorter?'), 'Hi Nithin,\n\nCould you send the docs?\n\nThanks!\n\n\n---\nWant it shorter?')
  assert.equal(claude.stripGogoSignoff('Best,\nGoverdhan'), 'Best,\nGoverdhan')
})

const fx: any = await import('../lib/services/reference-fx.ts').catch(() => null)
await check('FX fallback reads the v1 reference format and refuses stale or malformed data', () => {
  if (!fx?.parseV1) throw new Error('fx failed to load')
  const today = new Date().toISOString().slice(0, 10)
  assert.equal(fx.parseV1({ base: 'USD', date: today, rates: { INR: 84.12 } }, 'USD', 'INR')?.rate, 84.12)
  assert.equal(fx.parseV1({ base: 'USD', date: '2020-01-01', rates: { INR: 70 } }, 'USD', 'INR'), null)
  assert.equal(fx.parseV1({ base: 'EUR', date: today, rates: { INR: 90 } }, 'USD', 'INR'), null)
})

const sb: any = await import('../lib/agent/same-brain.ts').catch(() => null)
await check('general inbox digests use the attention card; specific searches keep the list', () => {
  if (!sb?.isGeneralInboxDigest) throw new Error('same-brain failed to load')
  for (const t of ['Summarise my unread emails today', 'check my email', 'catch me up on my inbox', 'any important emails?']) assert.ok(sb.isGeneralInboxDigest(t), t)
  for (const t of ['Summarise emails from Nithin', 'latest email from Swiggy', 'summarise the email about the contract', 'summarise my promotions']) assert.ok(!sb.isGeneralInboxDigest(t), t)
})

const wc: any = await import('../lib/agent/watch-command.ts').catch(() => null)
await check('scheduled-task questions list the real background watches', () => {
  if (!wc?.isWatcherStatusQuery) throw new Error('watch-command failed to load')
  for (const t of ['What scheduled tasks do I have?', 'show my automations', 'list my scheduled tasks']) assert.ok(wc.isWatcherStatusQuery(t), t)
  assert.ok(!wc.isWatcherStatusQuery('schedule a task every monday'))
})

const slots: any = await import('../lib/bot/memory-slots.ts').catch(() => null)
await check('a new parking spot or locker replaces the old one (one current value per slot)', () => {
  if (!slots?.memorySlotOf) throw new Error('memory-slots failed to load')
  assert.equal(slots.memorySlotOf('my car parking is B2 slot 9'), 'car_parking')
  assert.equal(slots.memorySlotOf('CAR PARKED AT B3 SLOT 21'), 'car_parking')
  assert.equal(slots.memorySlotOf('my bike is parked near gate 2'), 'bike_parking')
  assert.equal(slots.memorySlotOf('gym locker: TEST-LOCKER-42'), 'gym_locker')
  assert.equal(slots.memorySlotOf('I prefer morning meetings'), null)
})

await check('P1: production URL summary never directly fetches arbitrary destinations', async () => {
  let modelCalls = 0
  const result = await US.summariseUrl(
    { url: 'http://172.16.0.1/admin', ask: 'Summarise for alex.r@example.com' },
    { model: async () => { modelCalls++; return 'unsafe' } },
  )
  assert.equal(result, null)
  assert.equal(modelCalls, 0)
})

await check('P1: privacy scanning is complete and request-local for both research paths', async () => {
  const { readFileSync } = await import('node:fs')
  const research = readFileSync('lib/agent/deep-research.ts', 'utf8')
  const summaries = readFileSync('lib/agent/url-summary.ts', 'utf8')
  assert.doesNotMatch(research, /currentQuestion/, 'no cross-request global identity')
  assert.match(research, /scanText:\s*prompt/, 'scan the full per-call research prompt')
  assert.match(summaries, /scanText:\s*prompt/, 'scan the full URL-summary prompt including email addresses')
  assert.ok(!summaries.includes("prompt.split('.')"), 'do not truncate on email dot')
  assert.ok(summaries.includes('if (!deps.fetchImpl) return null'), 'direct production fetch must fail closed')
})

await check('P1: research snippets never initiate direct server fetch to search-result or redirect URLs', async () => {
  const originalFetch = globalThis.fetch
  const attempted: string[] = []
  globalThis.fetch = (async (url: any) => {
    attempted.push(String(url))
    throw new Error('a production server fetch would have reached this destination')
  }) as typeof fetch
  try {
    const sources = await DR.gatherSources(['attacker-controlled page result'], {
      search: (async () => [
        { title: 'private metadata result', url: 'http://169.254.169.254/latest/meta-data', snippet: 'Search snippet only' },
        { title: 'public redirect result', url: 'https://attacker.example/redirect-to-private', snippet: 'May redirect internally' },
      ]) as any,
    })
    assert.equal(sources.length, 2)
    assert.deepEqual(attempted, [], 'untrusted result/redirect URLs must not leave the application server')
    assert.ok(sources.every(source => source.text === ''), 'no direct page evidence was retrieved')
    assert.match(sources[0].snippet, /Search snippet only/, 'safe search-provider snippets are preserved')
  } finally {
    globalThis.fetch = originalFetch
  }
})

await check('hotel travel exclusions cannot bypass grounded output', async () => {
  for (const exclusion of ['Do not include flights or itineraries.', 'No flights or trains.', 'Without airfares or flights.', 'Exclude flights, please.']) {
    const question = `Research only: list 3 hotels near Mumbai airport. ${exclusion} Do not book.`
    assert.ok(isHotelDiscoveryResearch(question), question)
    let calls = 0
    const out = await DR.runDeepResearch(question, {
      search: (async () => [{ title: 'Hotel Airport International', url: 'https://www.makemytrip.com/hotels/hotel_airport_international-details-mumbai.html', snippet: 'Unbound directory price ₹31,270' }]) as any,
      model: async (_p: string, _n: number, name: string) => { calls++; return name.includes('haiku') ? 'hotel property query' : '₹31,270 best rating [1]' },
    })
    assert.equal(calls, 1)
    assert.doesNotMatch(out.text, /₹|31,270|best rating/)
  }
})

await check('hotel research cannot assign an area price to a property or invent a ranked pick', async () => {
  let modelCalls = 0
  const question = 'Research only: list 3 hotels near Mumbai airport for one adult, 14–16 November 2026. Give public source links. Do not book.'
  const out = await DR.runDeepResearch(question, {
    search: (async () => [
      { title: 'Hotels in Mumbai Airport Area', url: 'https://www.makemytrip.com/hotels/hotels-in-airport-mumbai.html', snippet: 'Roswyn, A Morgans Originals Hotel ₹31,270 per night' },
      { title: 'Hotel Airport International BOOK Mumbai Hotel', url: 'https://www.makemytrip.com/hotels/hotel_airport_international-details-mumbai.html', snippet: 'Hotel property page; requested-date rates not supplied' },
      { title: 'Hotel Airport Metro Near Mumbai Airport', url: 'https://www.agoda.com/en-in/oyo-5352-hotel-airport-metro/hotel/mumbai-in.html', snippet: 'Hotel property page; availability not supplied' },
    ]) as any,
    model: async (_prompt: string, _n: number, name: string) => {
      modelCalls++
      return name.includes('haiku') ? 'Mumbai airport hotel property pages\nMumbai airport accommodation'
        : 'Hotel Airport International costs ₹31,270 per night [1][2]. My pick: it has the best rating.'
    },
  })
  assert.doesNotMatch(out.text, /₹|31,270|My pick|best rating/i)
  assert.match(out.text, /2 of 3/i, 'do not invent a third property from an area directory')
  assert.match(out.text, /rates and availability.*unverified/i)
  assert.match(out.text, /Hotel Airport International/)
  assert.match(out.text, /Hotel Airport Metro/)
  assert.doesNotMatch(out.text, /hotels-in-airport-mumbai/)
  assert.equal(modelCalls, 1, 'property output does not use model price synthesis')
  assert.equal(out.sources.length, 2)
  assert.ok(out.sources.every(source => source.snippet === '' && source.text === ''), 'unbound rates cannot survive in hotel output metadata')
})

await check('hotel source catalogue rejects directories, mismatched identities, credentials and price-bearing titles', () => {
  const source = (n: number, title: string, url: string) => ({ n, title, url, snippet: 'unbound ₹31,270', text: 'not a date-specific quote' })
  const out = hotelResearchEvidence('Research three hotels near Mumbai airport for 2 adults', [
    source(1, 'Hotel Airport International', 'https://www.makemytrip.com/hotels/roswyn-details-mumbai.html'),
    source(2, 'Hotels near Mumbai airport', 'https://www.skyscanner.co.in/hotels/india/mumbai-hotels/near-airport'),
    source(3, 'Hotel Airport International', 'https://user:secret@www.makemytrip.com/hotels/hotel_airport_international-details-mumbai.html'),
    source(4, 'Hotel Airport International', 'https://www.makemytrip.com.evil.test/hotels/hotel_airport_international-details-mumbai.html'),
    source(5, 'Hotel Airport International ₹31,270', 'https://www.makemytrip.com/hotels/hotel_airport_international-details-mumbai.html'),
    source(6, 'Hotel Airport International', 'https://www.makemytrip.com/hotels/hotel_airport_international-details-mumbai.html?token=SYNTHETIC_SECRET#private'),
    source(7, 'Hotel Airport International BOOK Mumbai Hotel', 'https://www.agoda.com/hotel-airport-international/hotel/mumbai-in.html'),
    source(8, 'Hotel Private PIN 1234', 'https://www.makemytrip.com/hotels/hotel_private_pin_1234-details-mumbai.html'),
  ])
  assert.equal(out.sources.length, 1, 'duplicate property names do not create a false result count')
  assert.match(out.text, /1 of 3/)
  assert.doesNotMatch(out.text, /₹|31,270|SYNTHETIC_SECRET|private|evil|token|roswyn/i)
  assert.equal(out.sources[0].url, 'https://www.makemytrip.com/hotels/hotel_airport_international-details-mumbai.html')
  const none = hotelResearchEvidence('Research 3 hotels in Mumbai', [source(1, 'Hotels in Mumbai', 'https://example.test/directory')])
  assert.equal(none.sources.length, 0)
  assert.match(none.text, /couldn.t verify property-specific/)
})

await check('hotel requests preserve venue count, report caps honestly and leave unrelated research alone', () => {
  assert.ok(isHotelDiscoveryResearch('Research only: list 3 hotels near Mumbai airport for one adult'))
  assert.ok(!isHotelDiscoveryResearch('Research hotel industry stocks in India'))
  assert.ok(!isHotelDiscoveryResearch('Research history of hotels in India'))
  assert.ok(!isHotelDiscoveryResearch('Research electric scooters in India'))
  const sources = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, title: `Hotel Example${i}`, url: `https://www.makemytrip.com/hotels/hotel_example${i}-details-mumbai.html`, snippet: '', text: '' }))
  assert.match(hotelResearchEvidence('Research ten hotels in Mumbai for 2 adults', sources).text, /5 of 10/)
  assert.equal(hotelResearchEvidence('Research two hotels in Mumbai for 3 adults', sources).sources.length, 2)
})

await check('hotel discovery leaves safety, history and mixed travel research on the general path', async () => {
  for (const question of ['Research fire safety regulations in hotels in India with sources',
    'Research the history of luxury hotels in India', 'Research hotel fire safety in Mumbai',
    'Research flights and hotels in Mumbai']) {
    assert.ok(!isHotelDiscoveryResearch(question), question)
    let calls = 0
    const out = await DR.runDeepResearch(question, {
      search: (async () => [{ title: 'Relevant research source', url: 'https://example.test/research', snippet: 'Synthetic informational source' }]) as any,
      model: async (_p: string, _n: number, model: string) => {
        calls++; return model.includes('haiku') ? 'query one\nquery two' : 'SYNTHETIC_INFORMATIONAL_ANSWER [1]'
      },
    })
    assert.match(out.text, /SYNTHETIC_INFORMATIONAL_ANSWER/)
    assert.equal(calls, 2)
  }
})

await check('hotel catalogue refuses raw or encoded path secrets and malformed directory URLs', () => {
  const sources = [
    { title: 'Hotel Airport International', url: 'https://www.makemytrip.com/hotels/hotel_airport_international-details-mumbai-security-code-1234.html' },
    { title: 'Hotel Airport International', url: 'https://www.makemytrip.com/hotels/hotel_airport_international-details-mumbai-account-number-AB1234567.html' },
    { title: 'Hotel Airport International', url: 'https://www.tripadvisor.com/Hotel_Review-g304554-d12345-Reviews-Hotel_Airport_International-security.code.1234.html' },
    { title: 'Hotel Airport International', url: 'https://www.makemytrip.com/hotels/hotel_airport_international-details-mumbai-pin-1234.html' },
    { title: 'Hotel Airport International', url: 'https://www.makemytrip.com/hotels/hotel_airport_international-details-mumbai-pin-1234-in-mumbai.html' },
    { title: 'Hotel Airport International', url: 'https://www.makemytrip.com/hotels/hotel_airport_international-details-mumbai-token-SYNTHETIC_PRIVATE_SECRET.html' },
    { title: 'Hotel Airport International', url: 'https://www.makemytrip.com/hotels/hotel_airport_international-password-SYNTHETIC_PRIVATE_SECRET-details-mumbai.html' },
    { title: 'Hotel Airport International', url: 'https://www.tripadvisor.com/Hotel_Review-g304554-d12345-Reviews-Hotel_Airport_International-p%69n-1234.html' },
    { title: 'Mumbai Airport Hotels', url: 'https://www.tripadvisor.com/Hotel_Review-Mumbai_Airport_Hotels' },
  ].map((source, i) => ({ ...source, n: i + 1, snippet: '', text: '' }))
  const out = hotelResearchEvidence('Research 3 hotels near Mumbai airport', sources)
  assert.equal(out.sources.length, 0)
  assert.doesNotMatch(out.text, /1234|SYNTHETIC_PRIVATE_SECRET|Hotel_Review/)
  for (const label of ['security-code', 'account-number', 'card-number', 'routing-number', 'ifsc', 'api-key', 'secret-key', 'passport', 'pin', 'otp', 'cvv', 'cvc', 'aadhaar', 'ssn']) {
    for (const separator of ['-', '_', '.']) {
      const tail = `${label.replace(/-/g, separator)}${separator}AB1234567`
      const result = hotelResearchEvidence('Research 3 hotels in Mumbai', [{ n: 1, title: 'Hotel Airport International', url: `https://www.booking.com/hotel/in/hotel-airport-international-${tail}.html`, snippet: '', text: '' }])
      assert.equal(result.sources.length, 0, `secret path label ${tail}`)
    }
  }
})

await check('hotel identity cannot be established from destination or structural URL segments', () => {
  for (const [title, url] of [
    ['Hotel Mumbai', 'https://www.makemytrip.com/hotels/hotel_airport_international-details-mumbai.html'],
    ['Hotel Mumbai', 'https://www.agoda.com/hotel-airport-international/hotel/mumbai-in.html'],
    ['Hotel India', 'https://www.booking.com/hotel/india/airport-international.html'],
    ['Hotel Mumbai', 'https://www.tripadvisor.com/Hotel_Review-g304554-d12345-Reviews-Hotel_Airport_International-Mumbai_Maharashtra.html'],
    ['Hotel Airport International', 'https://www.hotels.com/ho12345/hotel-airport-international-mumbai-india/'],
    ['Hotel Airport International', 'https://www.expedia.com/Mumbai-Hotels-Hotel-Airport-International.h12345.Hotel-Information'],
  ]) {
    const out = hotelResearchEvidence('Research 3 hotels in Mumbai', [{ n: 1, title, url, snippet: '', text: '' }])
    assert.equal(out.sources.length, 0, `${title} cannot borrow destination identity: ${url}`)
  }
})

await check('hotel modifiers and large counts remain exact, defaults are not attributed to the user, aliases dedupe', () => {
  const sources = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, title: `Hotel Example${i}`, url: `https://www.makemytrip.com/hotels/hotel_example${i}-details-mumbai.html`, snippet: '', text: '' }))
  assert.equal(hotelResearchEvidence('Research 2 budget hotels near Mumbai airport', sources).sources.length, 2)
  assert.ok(isHotelDiscoveryResearch('Research the best 2 budget hotels near Mumbai airport'))
  assert.equal(hotelResearchEvidence('Research the best 2 budget hotels near Mumbai airport', sources).sources.length, 2)
  assert.match(hotelResearchEvidence('Research 100 hotels in Mumbai', sources).text, /5 of 100/)
  assert.doesNotMatch(hotelResearchEvidence('Research hotels in Mumbai for 2 adults', sources.slice(0, 1)).text, /of 3 requested/)
  const aliases = [
    { n: 1, title: 'Hotel Airport International', url: 'https://www.makemytrip.com/hotels/hotel_airport_international-details-mumbai.html', snippet: '', text: '' },
    { n: 2, title: 'Airport International Hotel', url: 'https://www.agoda.com/hotel-airport-international/hotel/mumbai-in.html', snippet: '', text: '' },
  ]
  assert.equal(hotelResearchEvidence('Research 3 hotels in Mumbai', aliases).sources.length, 1)
  const validReview = hotelResearchEvidence('Research one hotel near Mumbai airport', [
    { n: 1, title: 'Roswyn, A Morgans Originals Hotel', url: 'https://www.tripadvisor.com/Hotel_Review-g304554-d12345-Reviews-Roswyn_A_Morgans_Originals_Hotel-Mumbai_Maharashtra.html', snippet: '', text: '' },
  ])
  assert.equal(validReview.sources.length, 1, 'actual property review URL shape remains supported')
})

if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('duet round 6: all checks passed')
