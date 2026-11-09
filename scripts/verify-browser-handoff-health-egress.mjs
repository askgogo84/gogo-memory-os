// P1: execute the original exported handoff-health probe against inert HTTP fixtures.
// No production URLs, credentials, browser sessions, DNS, or outbound HTTP requests.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/agent/browser-handoff-health.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: 'lib/agent/browser-handoff-health.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const origin = 'https://sb-fixture-42.vercel.run'
const takeover = origin + '/take-control?token=synthetic-private-token'
const ready = () => new Response(JSON.stringify({ ready: true }), {
  status: 200, headers: { 'content-type': 'application/json' },
})
function harness(fakeFetch) {
  const exports = {}
  vm.runInNewContext(compiled, {
    exports, URL, AbortSignal, fetch: fakeFetch,
  }, { filename: 'lib/agent/browser-handoff-health.ts', timeout: 1000 })
  assert.equal(typeof exports.browserHandoffIsLive, 'function',
    'must test original exported function rather than duplicate logic')
  return exports.browserHandoffIsLive
}

let requestCount = 0
const probe = harness(async (url, init) => {
  requestCount++
  const u = new URL(String(url))
  assert.equal(u.origin, origin, 'probe may leave only to exact sandbox origin')
  assert.equal(u.pathname, '/health', 'probe must not load arbitrary saved path')
  assert.equal(u.searchParams.get('token'), 'synthetic-private-token',
    'only the original sandbox health probe receives its token')
  assert.equal(u.hash, '')
  assert.equal(init.redirect, 'manual', 'automatic 30x follow would bypass host containment')
  assert.equal(init.cache, 'no-store')
  assert.ok(init.signal instanceof AbortSignal)
  return ready()
})
assert.equal(await probe(takeover), true, 'valid sandbox /health READY remains supported')
assert.equal(requestCount, 1)
for (const bad of [
  'https://attacker.example/path?token=synthetic-private-token',
  'http://sb-fixture-42.vercel.run/path?token=synthetic-private-token',
  'https://sb-fixture-42.vercel.run:444/path?token=synthetic-private-token',
  'https://user:pass@sb-fixture-42.vercel.run/path?token=synthetic-private-token',
  origin + '/take-control',
  'https://sb-fixture-42.vercel.run.attacker.test/path?token=x',
  'https://127.0.0.1/?token=x',
  'not a url',
]) {
  assert.equal(await probe(bad), false, 'reject untrusted initial destination: ' + bad)
}
assert.equal(requestCount, 1, 'invalid inputs must not cause HTTP egress')

for (const code of [301, 302, 303, 307, 308]) {
  const visited = []
  const location = 'http://169.254.169.254/latest/meta-data/iam/security-credentials/'
  const redirectProbe = harness(async (url, init) => {
    visited.push(String(url))
    if (init.redirect !== 'manual') {
      // Simulate what real fetch would do by default: follow the untrusted Location.
      visited.push(location)
      return ready()
    }
    return new Response(null, { status: code, headers: { location } })
  })
  assert.equal(await redirectProbe(takeover), false,
    'HTTP ' + code + ' from sandbox may not be accepted as healthy')
  assert.equal(visited.length, 1, 'HTTP ' + code + ' must not reach redirect Location')
  assert.equal(new URL(visited[0]).origin, origin)
}

const notReady = harness(async () => new Response(JSON.stringify({ ready: false }), { status: 200 }))
assert.equal(await notReady(takeover), false, 'ready=false means not alive')
const serverFailure = harness(async () => new Response(JSON.stringify({ ready: true }), { status: 503 }))
assert.equal(await serverFailure(takeover), false, 'non-200 cannot assert liveness')
const brokenBody = harness(async () => new Response('not-json', { status: 200 }))
assert.equal(await brokenBody(takeover), false, 'invalid JSON fails closed')
const unavailable = harness(async () => { throw new Error('synthetic network timeout') })
assert.equal(await unavailable(takeover), false, 'network failures fail closed')

console.log('PASS: original browser handoff health probe pins HTTPS sandbox, manual redirects only, and fails closed')
