// 20 Oct live: Tavily (over plan limit) cost ~3.5s on every fresh server before Serper answered.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
process.env.TAVILY_API_KEY = 't'; process.env.SERPER_API_KEY = 's'; delete process.env.SEARCH_PROVIDER_ORDER
const calls: string[] = []
globalThis.fetch = (async (url: any) => {
  const u = String(url)
  if (u.includes('tavily')) { calls.push('tavily'); return new Response(JSON.stringify({ detail: { error: 'limit' } }), { status: 432 }) }
  if (u.includes('serper')) { calls.push('serper'); return new Response(JSON.stringify({ organic: [{ title: 'Petrol price Bangalore', link: 'https://www.goodreturns.in/petrol-price-in-bangalore.html', snippet: '₹102.92' }] }), { status: 200 }) }
  calls.push('other'); return new Response('{}', { status: 200 })
}) as any
const ws = await import('../lib/web-search.ts')
assert.deepEqual(ws.searchProviderOrder({}), ['serper', 'tavily'])
assert.deepEqual(ws.searchProviderOrder({ SEARCH_PROVIDER_ORDER: 'tavily,serper' }), ['tavily', 'serper'])
assert.deepEqual(ws.searchProviderOrder({ SEARCH_PROVIDER_ORDER: 'junk' }), ['serper', 'tavily'])
const r = await ws.searchWebResults('petrol price in bangalore today')
assert.equal(r.length, 1)
assert.deepEqual(calls, ['serper'], 'Serper answers first; Tavily is never called when Serper has results')
console.log('SERPER_FIRST_OK')
