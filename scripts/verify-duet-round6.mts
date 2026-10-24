// Duet parity round 6 (24 Oct live battery): research mode, page summaries, inbox digest card, Make for decks and
// sheets, WhatsApp headings, draft sign-offs, FX fallback.
import assert from 'node:assert/strict'
import * as DR from '../lib/agent/deep-research.ts'
import * as US from '../lib/agent/url-summary.ts'
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
  assert.match(research, /scanText:\\s*prompt/, 'scan the full per-call research prompt')
  assert.match(summaries, /scanText:\\s*prompt/, 'scan the full URL-summary prompt including email addresses')
  assert.doesNotMatch(summaries, /prompt\\.split\\('\.'\\)/, 'do not truncate on email dot')
  assert.match(summaries, /if \\(!deps\\.fetchImpl\\) return null/, 'direct production fetch must fail closed')
})

if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('duet round 6: all checks passed')
