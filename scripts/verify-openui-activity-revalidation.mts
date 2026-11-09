// OFFLINE/INERT actual-component regression: no live provider, auth, browser,
// booking, owner account, payment, database, or external network call.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { safeActivityProviderUrl } from '../lib/openui/activity-observation'

const A = 'c615f10c-9071-43a5-9f67-7c175309b6c1'
const B = '5d4311ef-0e55-4d4c-b063-0e21830c20a8'
const venue = {
  title: 'Synthetic Court', provider: 'playo.co',
  sourceUrl: 'https://playo.co/venues/bengaluru/synthetic', observedAt: '2026-10-25T10:09:00.000Z',
}
const record = (id: string) => ({
  id, service: 'badminton court', location: 'Synthetic Town', requestedTime: 'Saturday',
  status: 'discovered', venues: [venue], observedAt: venue.observedAt,
  notice: 'Historical public-web source only; no availability or booking verified.',
})
type Reply = { status: number; body?: unknown } | Error | { deferred: true }
type Element = { type: unknown; props: Record<string, unknown> }
const wait = () => new Promise<void>(resolve => setTimeout(resolve, 0))
const find = (node: unknown, match: (element: Element) => boolean): boolean => {
  if (Array.isArray(node)) return node.some(child => find(child, match))
  if (!node || typeof node !== 'object') return false
  const element = node as Element
  return match(element) || find(element.props?.children, match)
}
const source = readFileSync('app/dashboard/(app)/activity-results/[id]/page.tsx', 'utf8')
const code = ts.transpileModule(source, {
  fileName: 'page.tsx', compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText
const exports: Record<string, any> = {}
const state: unknown[] = []
const replies: Reply[] = []
const requests: Array<{ url: string; options: Record<string, any> }> = []
let currentId = A
let cursor = 0
let nextEffect: { fn: () => (() => void); deps: string[] } | null = null
let effectDeps: string[] | null = null
let cleanup: (() => void) | null = null
let interval: (() => void) | null = null
let resolveDeferred: ((value: unknown) => void) | null = null
const ActivityMarker = () => null
const jsx = (type: unknown, props: Record<string, unknown> = {}) => ({ type, props })
const react = {
  use: () => ({ id: currentId }),
  useState: (initial: unknown) => {
    const i = cursor++
    if (!(i in state)) state[i] = initial
    return [state[i], (value: unknown) => { state[i] = value }]
  },
  useEffect: (fn: () => (() => void), deps: string[]) => { nextEffect = { fn, deps } },
}
function mockedFetch(url: string, options: Record<string, any>) {
  requests.push({ url, options })
  assert.equal(url, '/api/openui/activities/' + encodeURIComponent(currentId),
    'read path must remain scoped to current saved record')
  assert.equal(options.credentials, 'same-origin')
  assert.equal(options.cache, 'no-store')
  assert.equal(options.method ?? 'GET', 'GET')
  const reply = replies.shift()
  assert(reply, 'each fetch requires an explicit synthetic response')
  if (reply instanceof Error) return Promise.reject(reply)
  if ('deferred' in reply) return new Promise(resolve => { resolveDeferred = resolve })
  return Promise.resolve({
    ok: reply.status >= 200 && reply.status < 300, status: reply.status,
    json: async () => reply.body,
  })
}
runInNewContext(code, {
  exports, Error, Date, String, Array, Object, Promise, Number, URL,
  console, encodeURIComponent,
  AbortSignal: { timeout: (ms: number) => { assert.equal(ms, 12000); return {} } },
  document: { hidden: false }, fetch: mockedFetch,
  setInterval: (callback: () => void, ms: number) => {
    assert.equal(ms, 30000); interval = callback; return 1
  },
  clearInterval: () => { interval = null },
  require: (name: string) => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === 'next/link') return { default: () => null }
    if (name === '@/lib/openui/activity-observation') return { safeActivityProviderUrl }
    if (name === '@/components/dashboard/openui-activity-results') return { OpenUIActivityResults: ActivityMarker }
    throw new Error('Unexpected external dependency in synthetic activity page: ' + name)
  },
})
function render() {
  cursor = 0
  nextEffect = null
  return exports.default({ params: Promise.resolve({ id: currentId }) }) as Element
}
function runEffect() {
  const e = nextEffect
  assert(e, 'page must register a route-scoped effect')
  if (effectDeps?.length === e.deps.length &&
    effectDeps.every((value, i) => value === e.deps[i])) return
  cleanup?.()
  cleanup = e.fn()
  effectDeps = [...e.deps]
}
function displayed(node: Element) {
  return find(node, e => e.type === ActivityMarker && !!e.props.data)
}
function alerts(node: Element) {
  return find(node, e => e.props?.role === 'alert')
}
function poll() { assert(interval, 'poll must be registered'); interval() }
function enqueue(status: number, body?: unknown) { replies.push({ status, body }) }
async function settle() { await wait(); return render() }

// First read is actual saved, owner-evidenced public-web observation.
enqueue(200, record(A))
render(); runEffect()
assert.equal(displayed(await settle()), true)

// Authorisation loss clears the previous private evidence.
enqueue(401, { error: 'unauthorized' }); poll()
assert.equal(displayed(await settle()), false, '401 revokes prior saved activity cards')
assert.equal(alerts(render()), true)
enqueue(200, record(A)); poll()
assert.equal(displayed(await settle()), true)
replies.push(new Error('offline synthetic network failure')); poll()
assert.equal(displayed(await settle()), false, 'network error revokes previous cards')

// A 200 is not evidence when identity or required shape is wrong.
enqueue(200, record(A)); poll()
assert.equal(displayed(await settle()), true)
enqueue(200, record(B)); poll()
assert.equal(displayed(await settle()), false, 'mismatched 200 ID denied')
enqueue(200, record(A)); poll()
assert.equal(displayed(await settle()), true)
enqueue(200, { id:A,service:'badminton',venues:[venue] }); poll()
assert.equal(displayed(await settle()), false, 'incomplete 200 denied')
enqueue(200, record(A)); poll()
assert.equal(displayed(await settle()), true)
enqueue(200, { ...record(A), venues:[{ ...venue,sourceUrl:'https://playo.co.evil.test/venue' }] }); poll()
assert.equal(displayed(await settle()), false, 'unsafe provider URL denied')
enqueue(200, record(A)); poll()
assert.equal(displayed(await settle()), true)

// Two overlapping polls must not create concurrent owner evidence requests.
const count = requests.length
replies.push({deferred:true})
poll()
poll()
assert.equal(requests.length, count + 1, 'serialized polling prevents overlapping network reads')
assert(resolveDeferred)
resolveDeferred({ok:true,status:200,json:async()=>record(A)})
assert.equal(displayed(await settle()), true)

// After URL navigation but BEFORE the effect/GET, don't leak old record.
currentId = B
assert.equal(displayed(render()), false, 'route navigation pre-effect cannot flash prior owner evidence')
assert.equal(alerts(render()), false, 'route navigation does not flash stale auth/error state')
enqueue(200, record(B))
render(); runEffect()
assert.equal(displayed(await settle()), true, 'new route may show only its exact matching observation')

// Old request completes after a navigation: cleanup prevents stale write.
replies.push({deferred:true}); poll()
assert(resolveDeferred)
const staleResolve = resolveDeferred
currentId = A
assert.equal(displayed(render()), false)
enqueue(200, record(A)); render(); runEffect()
assert.equal(displayed(await settle()), true)
staleResolve({ok:true,status:200,json:async()=>record(B)})
assert.equal(displayed(await settle()), true, 'late old-route reply cannot clobber current route')
assert.equal(requests.every(r => r.options.credentials === 'same-origin' && r.options.cache === 'no-store'), true)
cleanup?.()
console.log('OPENUI-ACTIVITY-REVALIDATION-07: real component exact-ID, 401/network/malformed, pre-effect navigation, stale async, serialized GET regression PASS (synthetic)')
