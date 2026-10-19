// 19 Oct: Tavily answered 432 (over plan quota) for hours; every search still paid a failed call first
// and then fell to the slowest fallback. Chain is now Tavily → Serper (Google) → Anthropic, with a
// 30 minute skip for a provider that reports quota/auth exhaustion.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only'
process.env.OPENAI_API_KEY ||= 'fixture-only'
process.env.ANTHROPIC_API_KEY ||= 'fixture-only'
process.env.TAVILY_API_KEY = 'fixture-tavily'
process.env.SERPER_API_KEY = 'fixture-serper'
const calls = {tavily: 0, serper: 0, anthropic: 0}
let tavilyStatus = 432, serperStatus = 200
const serperBodies: any[] = []
;(globalThis as any).fetch = async (url: any, init: any = {}) => {
  const u = String(url)
  const json = (body: any, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}})
  if (u.startsWith('https://api.tavily.com')) { calls.tavily++; return json({detail: {error: 'limit'}}, tavilyStatus) }
  if (u.startsWith('https://google.serper.dev')) {
    calls.serper++
    assert.equal(init.headers['X-API-KEY'], 'fixture-serper')
    serperBodies.push(JSON.parse(init.body))
    if (serperStatus !== 200) return json({message: 'Not enough credits'}, serperStatus)
    return json({
      answerBox: {title: 'Gold rate today', answer: '₹12,540 per gram (22K)', link: 'https://www.goodreturns.in/gold-rates/bangalore.html'},
      organic: [
        {title: 'Gold Rate in Bangalore', link: 'https://www.goodreturns.in/gold-rates/bangalore.html', snippet: 'dup of answer box'},
        {title: 'Petrol price', link: 'https://www.amazon.in/x', snippet: 'Today 102.92', date: '3 hours ago'},
        {title: 'Old', link: 'https://example.invalid/old', snippet: 's', date: 'Oct 5, 2026'},
      ],
    })
  }
  if (u.includes('anthropic')) { calls.anthropic++; return json({content: [], stop_reason: 'end_turn'}) }
  throw Error('unexpected fetch ' + u)
}
;(globalThis as any).console = {...console, error() {}, log() {}}
const ws = await import('../lib/web-search')

// 1. Tavily over quota → Serper answers; Anthropic not needed.
const first = await ws.searchWebResults('gold rate in bengaluru today')
assert.equal(calls.tavily, 1)
assert.equal(calls.serper, 1)
assert.equal(calls.anthropic, 0, 'Serper answered, no Anthropic call')
assert.equal(first[0].url, 'https://www.goodreturns.in/gold-rates/bangalore.html')
assert.match(first[0].snippet, /12,540/)
assert.equal(first.filter(r => r.url === first[0].url).length, 1, 'answer box and organic duplicate merged')
assert.equal(serperBodies[0].gl, 'in', 'Indian Google results')
const petrol = first.find(r => /amazon/.test(r.url))!
assert.ok(petrol.publishedDate && Date.now() - Date.parse(petrol.publishedDate) < 3.1 * 3_600_000, 'relative date converted')
assert.equal(first.find(r => /invalid\/old/.test(r.url))!.publishedDate!.slice(0, 10), '2026-10-05')

// 2. Tavily is skipped during the 30 minute backoff.
await ws.searchWebResults('news about tata motors')
assert.equal(calls.tavily, 1, 'Tavily skipped after 432')
assert.equal(calls.serper, 2)
assert.equal(ws.tavilyQuotaBlocked(Date.now() + 31 * 60_000), false, 'backoff expires after 30 minutes')

// 3. Domain-scoped searches keep only those domains.
const scoped = await ws.searchWebResults('iphone 17 price', {includeDomains: ['amazon.in', 'flipkart.com']})
assert.match(serperBodies.at(-1).q, /\(site:amazon\.in OR site:flipkart\.com\)$/)
assert.deepEqual(scoped.map(r => r.url), ['https://www.amazon.in/x'])

// 4. Serper out of credits → Anthropic, and Serper is then skipped too.
serperStatus = 400
await ws.searchWebResults('weather in goa')
assert.equal(calls.anthropic, 1)
serperStatus = 403
await ws.searchWebResults('weather in mysore')
assert.equal(calls.anthropic, 2)
assert.equal(ws.providerQuotaBlocked('serper'), true, '403 starts the Serper backoff')
const before = calls.serper
await ws.searchWebResults('weather in ooty')
assert.equal(calls.serper, before, 'Serper skipped during its backoff')
assert.equal(calls.anthropic, 3)

// 5. A transient 500 does not start a backoff; relative-date parser rejects guesses.
ws.noteTavilyFailure(new Error('tavily_failed:500'), Date.now() + 40 * 60_000)
assert.equal(ws.tavilyQuotaBlocked(Date.now() + 41 * 60_000), false)
assert.equal(ws.serperDate('yesterday-ish'), undefined)
process.stdout.write('Search chain: Tavily → Serper → Anthropic; quota refusals skip a provider for 30 min; Serper dates and domain scope verified.\n')
