// 19 Oct live: petrol answer was a long source-by-source essay; "Latest news on Tata Motors" led with
// a year-old story. News asks are date-restricted at the provider; the answer prompt enforces brevity.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only'
process.env.OPENAI_API_KEY ||= 'fixture-only'
process.env.ANTHROPIC_API_KEY ||= 'fixture-only'
delete process.env.TAVILY_API_KEY
process.env.SERPER_API_KEY = 'fixture-serper'
const bodies: any[] = []
let empty = false
;(globalThis as any).fetch = async (url: any, init: any = {}) => {
  const u = String(url)
  if (u.startsWith('https://google.serper.dev')) {
    const body = JSON.parse(init.body); bodies.push(body)
    const organic = empty && body.tbs ? [] : [{title: 'Result', link: 'https://example.invalid/r', snippet: 'snippet', date: '1 day ago'}]
    return new Response(JSON.stringify({organic}), {status: 200, headers: {'content-type': 'application/json'}})
  }
  if (u.includes('anthropic')) return new Response(JSON.stringify({content: [], stop_reason: 'end_turn'}), {status: 200, headers: {'content-type': 'application/json'}})
  throw Error('unexpected fetch ' + u)
}
;(globalThis as any).console = {...console, error() {}, log() {}}
const ws = await import('../lib/web-search')

await ws.searchWeb('Latest news on Tata Motors')
assert.match(bodies.at(-1).tbs || '', /^cdr:1,cd_min:\d+\/\d+\/\d{4}$/, 'news ask is limited to recent results')
await ws.searchWeb('Petrol price in Bangalore today')
assert.equal(bodies.at(-1).tbs, undefined, 'price lookups are not date-restricted')
await ws.searchWeb('What is the 22K gold rate in Bangalore today?')
assert.equal(bodies.at(-1).tbs, undefined)
empty = true
const n = bodies.length
const text = await ws.searchWeb('Any news about Zerodha?')
assert.equal(bodies.length, n + 2, 'no recent results → one retry without the date limit')
assert.equal(bodies.at(-1).tbs, undefined)
assert.match(text, /example\.invalid/)
for (const q of ['latest headlines', 'any updates on the Mumbai metro', 'news about Infosys']) assert.ok(ws.isRecentNewsQuery(q), q)
for (const q of ['latest iphone price', 'latest score india vs australia', 'what is the time in London']) assert.ok(!ws.isRecentNewsQuery(q), q)

const prompt = readFileSync('lib/services/claude.ts', 'utf8')
assert.match(prompt, /BREVITY \(19 Oct/)
assert.match(prompt, /start with the direct answer in the first line/)
assert.match(prompt, /Never open with "Based on the search results"/)
assert.match(prompt, /Never present an item more than a month old as latest news/)
process.stdout.write('Concise web answers: news limited to 7 days with fallback; prices unrestricted; brevity rules in the answer prompt.\n')
