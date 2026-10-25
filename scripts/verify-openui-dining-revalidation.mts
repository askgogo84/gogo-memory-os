// OFFLINE actual-component regression for owner-bound saved dining result revalidation.
// Simulated hooks and response queue only; no real browser, account, provider,
// restaurant availability request, booking, network or database call.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const ID = '6d84d990-8888-4d20-9fc7-e331c73a2011'
const OTHER = '61bdc60d-a901-4fa0-868b-3461790df018'
type Observation = { id: string; restaurant: string; note: string; observedSlots: string[];
  runType: string; status: string }
const record = (id: string): Observation => ({
  id, restaurant: 'Synthetic Dining Evidence ' + id, note: 'Historical only',
  observedSlots: ['19:00'], status: 'historical_slots', runType: 'restaurant_reservation_slot',
})
type Reply = { status: number; body?: unknown } | Error | { deferred: true }
type Element = { type: unknown; props: Record<string, unknown> }
const wait = () => new Promise<void>(resolve => setTimeout(resolve, 0))
const childrenContain = (node: unknown, test: (value: Element) => boolean): boolean => {
  if (Array.isArray(node)) return node.some(child => childrenContain(child, test))
  if (!node || typeof node !== 'object') return false
  const el = node as Element
  return test(el) || childrenContain(el.props?.children, test)
}
const source = readFileSync('app/dashboard/(app)/dining-results/[id]/page.tsx', 'utf8')
const code = ts.transpileModule(source, {
  fileName: 'page.tsx',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX },
}).outputText
const exports: Record<string, any> = {}
const states: unknown[] = []
const requests: Array<{url: string; options: Record<string, any>}> = []
const replies: Reply[] = []
let currentId = ID
let cursor = 0
let pendingEffect: {fn: () => (() => void); deps: string[]} | null = null
let effectDeps: string[] | null = null
let effectCleanup: (() => void) | null = null
let interval: (() => void) | null = null
let deferredResolve: ((value: any) => void) | null = null
const DiningMarker = () => null
const jsx = (type: unknown, props: Record<string, unknown> = {}) => ({type, props})
const react = {
  use: () => ({ id: currentId }),
  useState: (value: unknown) => {
    const i = cursor++
    if (!(i in states)) states[i] = value
    return [states[i], (v: unknown) => { states[i] = v }]
  },
  useEffect: (fn: () => (() => void), deps: string[]) => {
    pendingEffect = {fn, deps}
  },
}
function mockFetch(url: string, options: Record<string, any>) {
  requests.push({url, options})
  assert.equal(url, '/api/openui/dining/' + encodeURIComponent(currentId),
    'saved-record exact current ID, same-origin route')
  assert.equal(options.credentials, 'same-origin')
  assert.equal(options.cache, 'no-store')
  assert.equal(options.method || 'GET', 'GET')
  const reply = replies.shift()
  assert(reply, 'every fetch requires an explicitly queued inert reply')
  if (reply instanceof Error) return Promise.reject(reply)
  if ('deferred' in reply) return new Promise(resolve => { deferredResolve = resolve })
  return Promise.resolve({
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    json: async () => reply.body,
  })
}
runInNewContext(code, {
  exports,
  Error, String, Array, Object, Promise, console, encodeURIComponent,
  AbortSignal: { timeout: (ms: number) => { assert.equal(ms, 12000); return {} } },
  document: {hidden:false},
  fetch: mockFetch,
  setInterval: (callback: () => void, ms: number) => {
    assert.equal(ms, 30000); interval=callback; return 1
  },
  clearInterval: () => {interval=null},
  require: (name: string) => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return {jsx, jsxs:jsx}
    if (name === 'next/link') return {default: () => null}
    if (name === '@/components/dashboard/openui-dining-results') return {OpenUIDiningResults: DiningMarker}
    throw new Error('Unmocked I/O import in inert dining test: ' + name)
  },
})
function render() {
  cursor = 0
  pendingEffect = null
  return exports.default({ params: Promise.resolve({id:currentId}) }) as Element
}
function runEffect() {
  const next = pendingEffect
  assert(next, 'component registers effect')
  if (effectDeps?.length === next.deps.length &&
      effectDeps.every((value, i) => value === next.deps[i])) return
  effectCleanup?.()
  effectCleanup = next.fn()
  effectDeps = [...next.deps]
}
function visible(tree: Element) {
  return childrenContain(tree, el => el.type === DiningMarker && !!el.props.data)
}
async function receive() { await wait(); return render() }
function poll() { assert(interval, 'poll registered'); interval() }
function enqueue(status:number, body?: unknown) {replies.push({status,body})}

enqueue(200, record(ID))
render(); runEffect()
assert.equal(visible(await receive()), true, 'legitimate same-ID evidence shown')

// A 401 MUST revoke the prior private restaurant card (not merely show an error).
enqueue(401, {error:'unauthorized'})
poll()
assert.equal(visible(await receive()), false, 'sign-out/401 revokes old dining cards')

enqueue(200, record(ID)); poll()
assert.equal(visible(await receive()), true, 'newly proven same owner evidence restored')
replies.push(new Error('synthetic offline network failure')); poll()
assert.equal(visible(await receive()), false, 'network reject revokes previous cards')

enqueue(200, record(ID)); poll()
assert.equal(visible(await receive()), true)
enqueue(200, {id:ID,restaurant:'Missing contract fields'}); poll()
assert.equal(visible(await receive()), false, 'malformed HTTP 200 cannot render stale data')

enqueue(200, record(ID)); poll()
assert.equal(visible(await receive()), true)
enqueue(200, record(OTHER)); poll()
assert.equal(visible(await receive()), false, 'mismatched HTTP 200 ID cannot render another record')

enqueue(200, record(ID)); poll()
assert.equal(visible(await receive()), true)
currentId = OTHER
assert.equal(visible(render()), false,
  'route-param change hides old private evidence even BEFORE effect cleanup')
enqueue(200, record(OTHER))
runEffect()
assert.equal(visible(await receive()), true, 'new record only after exact-ID read')
assert.equal(requests.at(-1)?.url, '/api/openui/dining/' + OTHER)

// While a request is inflight, a polling tick cannot issue duplicate reads.
replies.push({deferred:true}); poll()
assert(deferredResolve)
const count=requests.length
poll()
assert.equal(requests.length, count, 'no duplicate concurrent polling reads')
deferredResolve({ok:false,status:503,json:async()=>({error:'unavailable'})})
assert.equal(visible(await receive()), false, 'failed delayed refresh revokes stale card')

assert.equal(replies.length,0)
assert.equal(requests.every(req => !req.options.body &&
  (req.options.method === undefined || req.options.method === 'GET')),true,
  'no mutations, sends or booking requests')

console.log('OPENUI-DINING-REVALIDATION-06: actual JSX recheck, route isolation, bad 200, network/401, serialized polling PASS (synthetic)')
