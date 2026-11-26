import assert from 'node:assert/strict'
import { runDeepResearch } from '../lib/agent/deep-research'

const wallet = 'https://www.cashfree.com/cashfree-wallet/'
const guide = 'https://www.cashfree.com/docs/tools-ai/agentpay-mcp/integration-guide'
const unrequested = 'https://www.cashfree.com/unrelated/'
const question = `Research a wallet beta, using only ${wallet} and ${guide}. Cite what is live, future, and unverified.`
const first = { url: wallet, title: 'Wallet', snippet: 'Bills are live. Shopping, food and travel are coming soon.' }
const second = { url: guide, title: 'Guide', snippet: 'Credit-card and loan payments are unavailable. Settlement requires a success result and UTR.' }
const third = { url: unrequested, title: 'Unrequested', snippet: 'A different service sets an INR 10000 cap.' }

let calls = 0
const hallucination = async () => {
  calls++
  return 'Credit-card and loan payments have a ₹10,000 limit [1].'
}
const partial = await runDeepResearch(question, {
  search: async () => [second, third],
  model: hallucination,
})
assert.equal(calls, 0, 'missing exact evidence stops before model synthesis')
assert.match(partial.text, /could not verify.*requested source/i)
assert.doesNotMatch(partial.text, /10,000|Unrequested/)
assert.deepEqual(partial.sources.map(s => s.url), [guide])

const allSourceResults = async () => [third, second, { ...first, url: wallet.slice(0, -1) }]
const queries: string[] = []
const complete = await runDeepResearch(question, {
  search: async (query) => { queries.push(query); return allSourceResults() },
  model: async prompt => {
    assert.doesNotMatch(prompt, /different service/)
    return JSON.stringify([
      { source: 1, excerpt: 'Shopping, food and travel are coming soon.' },
      { source: 2, excerpt: 'Credit-card and loan payments are unavailable.' },
    ])
  },
})
assert.equal(queries.length, 2)
assert.ok(queries.every(query => query.startsWith('site:www.cashfree.com/')))
assert.deepEqual(complete.sources.map(s => s.url.replace(/\/$/, '')), [wallet.slice(0, -1), guide])
assert.match(complete.text, /coming soon\. \[1\]/)
assert.match(complete.text, /are unavailable\. \[2\]/)
assert.doesNotMatch(complete.text, /10,000|Unrequested/)

const invalid = await runDeepResearch(question, {
  search: allSourceResults,
  model: async () => JSON.stringify([
    { source: 1, excerpt: 'Shopping, food and travel are coming soon.' },
    { source: 2, excerpt: 'Credit card payments have a ₹10,000 limit.' },
  ]),
})
assert.match(invalid.text, /could not verify.*requested source/i)
assert.doesNotMatch(invalid.text, /10,000/)

const incompleteCitations = await runDeepResearch(question, {
  search: allSourceResults,
  model: async () => JSON.stringify([{ source: 2, excerpt: 'Credit-card and loan payments are unavailable.' }]),
})
assert.match(incompleteCitations.text, /could not verify.*requested source/i)

const unsafe = await runDeepResearch('Research a service using only https://www.cashfree.com/launch?token=not-public.', {
  search: async () => assert.fail('a restricted URL must never reach public search'),
  model: async () => assert.fail('a restricted URL must never reach inference'),
})
assert.equal(unsafe.sources.length, 0)
assert.doesNotMatch(unsafe.text, /not-public/)

console.log('PASS: explicit research sources require complete coverage and verbatim evidence; lookalike sources and unsupported claims are rejected')
