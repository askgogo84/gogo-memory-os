// Inert source-function privacy regression. Never call a real model, web search, DB,
// messaging provider, browser, or customer service in this fixture.
import assert from 'node:assert/strict'
import {
  isDeepResearchRequest,
  researchContainsPrivateData,
  runDeepResearch,
} from '../lib/agent/deep-research.ts'

const personal = [
  'Research my medical test reports with sources',
  'Compare my blood test results with references',
  'Do a deep research on my health records',
  'Research my bank statement with sources',
  'Research my income tax returns with citations',
  'Investigate my salary slips',
  'Research my Aadhaar details with sources',
  'Research my passport with sources',
  'Research my messages with sources',
  'Research my email from HR',
  'Research the best resolution for alex.r@example.com with sources',
]

let cases = 0
for (const question of personal) {
  assert.equal(researchContainsPrivateData(question), true, `private eligibility: ${question}`)
  assert.equal(isDeepResearchRequest(question), false, `public route must not claim: ${question}`)
  let modelCalls = 0
  let searchCalls = 0
  let fetchCalls = 0
  const result = await runDeepResearch(question, {
    model: async () => { modelCalls++; throw new Error('unexpected private MODEL egress') },
    search: async () => { searchCalls++; throw new Error('unexpected private SEARCH egress') },
    fetchImpl: (async () => { fetchCalls++; throw new Error('unexpected private FETCH egress') }) as typeof fetch,
  })
  assert.equal(modelCalls, 0, `private model calls: ${question}`)
  assert.equal(searchCalls, 0, `private web-search calls: ${question}`)
  assert.equal(fetchCalls, 0, `private fetch calls: ${question}`)
  assert.deepEqual(result.sources, [])
  assert.deepEqual(result.queries, [])
  assert.match(result.text, /will not send it to public web research/i)
  cases++
}

// Public comparative research must remain available; all providers here are
// deterministic in-memory stubs. No network request occurs.
const publicQuestions = [
  'Research the best electric scooters under 1.5 lakh in India with sources',
  'Compare electric scooters and bicycles with references',
  'Research medical journal reports on cancer treatment with sources',
]
for (const question of publicQuestions) {
  assert.equal(researchContainsPrivateData(question), false, `public classification: ${question}`)
  assert.equal(isDeepResearchRequest(question), true, `public research accepted: ${question}`)
  cases++
}
let publicModelCalls = 0
let publicSearchCalls = 0
const result = await runDeepResearch(publicQuestions[0], {
  model: async (_prompt, _maxTokens, model) => {
    publicModelCalls++
    return model.includes('haiku')
      ? 'best India electric scooters 2026\\nAther TVS iQube reviews 2026'
      : 'Public comparison based only on the supplied evidence [1].'
  },
  search: (async (_query: string) => {
    publicSearchCalls++
    return [{
      title: 'Synthetic public scooter comparison',
      url: 'https://example.org/scooter-comparison',
      content: 'Synthetic public evidence; no personal information.',
    }]
  }) as any,
})
assert.ok(publicModelCalls >= 2, 'public research model still used')
assert.ok(publicSearchCalls >= 2, 'public public-search still used')
assert.match(result.text, /Public comparison/)
assert.match(result.text, /Sources:/)
cases++
console.log(`PASS ${cases} private-data egress + public-research regression classes (all inert)`)
