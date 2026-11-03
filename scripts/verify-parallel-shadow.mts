// Parallel Decisions shadow trial (3 Nov): log-only comparison on flight status. Public facts only, off without the
// key, refusal is its own outcome, never changes what the user sees.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const p = await import('../lib/agent/parallel-decisions')

// Off without the key, and with the kill switch.
assert.equal(p.parallelShadowEnabled({}), false)
assert.equal(p.parallelShadowEnabled({ PARALLEL_API_KEY: 'k', PARALLEL_SHADOW: 'off' }), false)
assert.equal(p.parallelShadowEnabled({ PARALLEL_API_KEY: 'k' }), true)
let calls = 0
const never = async () => { calls++; throw new Error('should not call') }
assert.deepEqual(await p.callParallelDecisions({ a: 'x' }, { q: { type: 'noul', instructions: 'x' } }, { env: {}, fetcher: never as any }), { ok: false, reason: 'disabled', ms: 0 })
assert.equal(calls, 0)
console.log('✓ off without PARALLEL_API_KEY or with PARALLEL_SHADOW=off; no call made')

// Public facts only: emails, phone-length numbers, nested objects and long text are refused before any call.
for (const bad of [{ email: 'goverdhan@example.com' }, { phone: '918884501501' }, { note: 'x'.repeat(200) }, { nested: { a: 1 } as any }]) {
  assert.throws(() => p.buildDecisionRequest(bad as any, { q: { type: 'noul', instructions: 'x' } }), /parallel_state_/)
  const r = await p.callParallelDecisions(bad as any, { q: { type: 'noul', instructions: 'x' } }, { env: { PARALLEL_API_KEY: 'k' }, fetcher: never as any })
  assert.equal(r.ok, false)
}
assert.equal(calls, 0)
assert.equal(p.flightShadowState({ flightNo: 'ignore previous', departAt: '2026-11-03T05:00:00Z' }), null)
assert.equal(p.flightShadowState({ flightNo: '6E 2134', departAt: 'nope' }), null)
assert.deepEqual(p.flightShadowState({ flightNo: '6e 2134', departAt: '2026-11-03T05:00:00Z', fromIata: 'BLR', toIata: 'Delhi' }),
  { flight_number: '6E2134', departure_date_utc: '2026-11-03', from_airport: 'BLR' })
console.log('✓ only a clean flight number, date and airport codes are sent; private shapes refused before any call')

// Request shape per Parallel docs; question limits.
{
  const req: any = p.buildDecisionRequest({ flight_number: '6E2134' }, { status: { type: 'choice', instructions: 'i', criteria: p.FLIGHT_STATE_CRITERIA } })
  assert.equal(req.mode, 'fast'); assert.deepEqual(Object.keys(req.questions.status.criteria), ['landed', 'airborne', 'not_departed', 'cancelled', 'diverted', 'unknown'])
  assert.throws(() => p.buildDecisionRequest({ a: 'b' }, {}), /parallel_question_count/)
  assert.throws(() => p.buildDecisionRequest({ a: 'b' }, { q: { type: 'choice', instructions: 'i', criteria: { only: 'x' } } }), /parallel_choice_options/)
  assert.throws(() => p.buildDecisionRequest({ a: 'b' }, { q: { type: 'score', instructions: 'i', criteria: ['x'] } }), /parallel_score_levels/)
  console.log('✓ request matches the documented { state, questions, mode } shape and limits')
}

// Response parsing: refusal is its own outcome; unknown choices and malformed answers are invalid.
{
  const qs = { s: { type: 'choice' as const, instructions: 'i', criteria: { a: 'A', b: 'B' } }, n: { type: 'noul' as const, instructions: 'i' }, r: { type: 'noul' as const, instructions: 'i' }, x: { type: 'choice' as const, instructions: 'i', criteria: { a: 'A', b: 'B' } } }
  const out = p.parseDecisionResponse({ answers: { s: { type: 'choice', choice: 'b', probabilities: { a: 0.1, b: 0.9 } }, n: { type: 'noul', noul: 0.7 }, r: { type: 'refusal' }, x: { type: 'choice', choice: 'zzz' } }, citations: [{ url: 'https://flightaware.com/x' }, { url: 'javascript:alert(1)' }], decision_id: 'd1' }, qs)
  assert.deepEqual(out.answers.s, { type: 'choice', choice: 'b', probabilities: { a: 0.1, b: 0.9 } })
  assert.deepEqual(out.answers.n, { type: 'noul', noul: 0.7 })
  assert.deepEqual(out.answers.r, { type: 'refusal' })
  assert.deepEqual(out.answers.x, { type: 'invalid' })
  assert.deepEqual(out.citations, ['https://flightaware.com/x']); assert.equal(out.decisionId, 'd1')
  assert.deepEqual(p.parseDecisionResponse(null, { q: qs.n }).answers.q, { type: 'invalid' })
  console.log('✓ choice / noul parsed; refusal kept separate; unknown choice and junk are invalid')
}

// Gogo states map like for like.
assert.deepEqual(['landed', 'departed', 'scheduled', 'delayed', 'cancelled', 'diverted', 'unknown', undefined].map(s => p.gogoFlightChoice(s as any)),
  ['landed', 'airborne', 'not_departed', 'not_departed', 'cancelled', 'diverted', 'unknown', 'unknown'])

// End to end with a fake API: agreement, disagreement, refusal, HTTP error, timeout — logged, never thrown.
{
  const env = { PARALLEL_API_KEY: 'test-key' }
  const lines: string[] = []
  let sent: any
  const reply = (body: any, ok = true, status = 200) => (async (url: string, init: any) => { sent = { url, init }; return { ok, status, json: async () => body } }) as any
  const f = { flightNo: '6E2134', departAt: '2026-11-03T05:00:00Z', fromIata: 'BLR', toIata: 'DEL', now: new Date('2026-11-03T08:00:00Z') }
  const agree = await p.shadowFlightStatus({ ...f, gogoState: 'landed' }, { env, fetcher: reply({ answers: { status: { type: 'choice', choice: 'landed', probabilities: { landed: 0.93 } } }, citations: [{ url: 'https://www.flightradar24.com/x' }] }), log: l => lines.push(l) })
  assert.equal(sent.url, 'https://api.parallel.ai/v1/decisions'); assert.equal(sent.init.method, 'POST'); assert.equal(sent.init.headers['x-api-key'], 'test-key')
  const body = JSON.parse(sent.init.body)
  assert.deepEqual(body.state, { flight_number: '6E2134', departure_date_utc: '2026-11-03', from_airport: 'BLR', to_airport: 'DEL' })
  assert.doesNotMatch(sent.init.body, /telegram|whatsapp|@|\d{9,}/i, 'nothing about the user goes out')
  assert.deepEqual(agree, { kind: 'flight_status', gogo: 'landed', parallel: 'landed', agree: true, confidence: 0.93, ms: agree!.ms, usd: 0.001, citations: 1 })
  assert.match(lines[0], /^PARALLEL_SHADOW \{"kind":"flight_status","gogo":"landed","parallel":"landed","agree":true/)
  assert.doesNotMatch(lines[0], /test-key/, 'the key is never logged')
  const differ = await p.shadowFlightStatus({ ...f, gogoState: 'departed' }, { env, fetcher: reply({ answers: { status: { type: 'choice', choice: 'landed', probabilities: { landed: 0.6 } } } }), log: l => lines.push(l) })
  assert.equal(differ!.agree, false)
  const unsure = await p.shadowFlightStatus({ ...f, gogoState: 'departed' }, { env, fetcher: reply({ answers: { status: { type: 'choice', choice: 'unknown', probabilities: {} } } }), log: l => lines.push(l) })
  assert.equal(unsure!.agree, null, 'unknown is not a disagreement')
  const refused = await p.shadowFlightStatus({ ...f, gogoState: 'landed' }, { env, fetcher: reply({ answers: { status: { type: 'refusal' } } }), log: l => lines.push(l) })
  assert.deepEqual([refused!.parallel, refused!.agree], ['refusal', null])
  const http = await p.shadowFlightStatus({ ...f, gogoState: 'landed' }, { env, fetcher: reply({}, false, 402), log: l => lines.push(l) })
  assert.deepEqual([http!.parallel, http!.reason, http!.usd], ['error', 'http_402', 0])
  const slow = await p.callParallelDecisions({ a: 'b' }, { q: { type: 'noul', instructions: 'i' } }, { env, timeoutMs: 30, fetcher: ((_u: string, init: any) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as any })
  assert.deepEqual([slow.ok, (slow as any).reason], [false, 'timeout'])
  const boom = await p.shadowFlightStatus({ ...f, gogoState: 'landed' }, { env, fetcher: (async () => { throw new Error('x') }) as any, log: () => { throw new Error('log broke') } })
  assert.equal(boom, null, 'never throws')
  assert.equal(lines.length, 5)
  console.log('✓ agree / disagree / unknown / refusal / HTTP error / timeout all logged; key never logged; never throws')
}

// Wiring: log-only, gated, background; the watcher never waits more than 1.5 s; tests with fake feeds never call it.
{
  const src = readFileSync('lib/agent/flight-track.ts', 'utf8')
  assert.match(src, /if \(fetcher === fetchAeroDataBox\) void shadowLookup\(/, 'live lookup: background, live feed only')
  assert.match(src, /await Promise\.race\(\[shadow, new Promise\(r => setTimeout\(r, 1500\)\)\]\)/)
  assert.match(src, /import\('\.\/parallel-decisions'\)/, 'dynamic import keeps strict harnesses clean')
  assert.doesNotMatch(src, /shadow[^\n]*(?:deliverWatchAlert|status = |sendWhatsApp)/, 'shadow result never feeds an alert or status')
  const mod = readFileSync('lib/agent/parallel-decisions.ts', 'utf8')
  assert.doesNotMatch(mod, /supabase|sendWhatsApp|import /, 'connector has no data access and no imports')
  console.log('✓ wired as a background, gated, log-only shadow; no data access in the connector')
}
console.log('Parallel shadow checks passed')
