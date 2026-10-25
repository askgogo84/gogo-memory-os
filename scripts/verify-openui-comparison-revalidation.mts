// Execute the actual saved-comparison React effects in a fully isolated VM.
// No browser session, provider request, database, or customer account is used.
// Source inspection alone does not prove 200 -> unauthorized/offline revokes UI state.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const ID = '61bdc60d-a901-4fa0-868b-3461790df018'
const OTHER_ID = '4afce011-8571-4ea5-89df-74e2a5a51ca1'
const fixture = { id: ID, subject: 'Private fixture comparison', request: 'Read only',
  status: 'completed', updatedAt: '2026-10-25T08:00:00Z', providers: [] }
type SimulatedResponse = { status: number; body?: unknown }

function harness(file: string, kind: 'page' | 'inline') {
  const source = readFileSync(file, 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const slots: unknown[] = []
  let cursor = 0
  let renderId = ID
  let effect: (() => (() => void) | void) | null = null
  let interval: (() => void) | null = null
  const replies: Array<SimulatedResponse | Error> = []
  const requests: Array<{ url: string; method: string; credentials: unknown }> = []
  const ReactMock = {
    use: () => ({ id: renderId }),
    useMemo: (fn: () => unknown) => fn(),
    useState: (initial: unknown) => {
      const index = cursor++
      if (index >= slots.length) slots.push(initial)
      return [slots[index], (next: unknown) => { slots[index] = next }]
    },
    useEffect: (cb: () => (() => void) | void) => { effect = cb },
  }
  const noop = () => null
  const mocks: Record<string, unknown> = {
    react: ReactMock,
    'react/jsx-runtime': { jsx: noop, jsxs: noop, Fragment: noop },
    'next/link': { default: noop },
    '@/lib/commerce/comparison-model': { COMPARISON_PROVIDERS: {}, comparisonHandoffPath: noop },
    '@/components/dashboard/openui-search-results': { OpenUISearchResults: noop },
    '@/lib/openui/search-observation': {
      savedComparisonId: (value: string) => value.match(/comparisons\/([0-9a-f-]+)/i)?.[1] ?? null,
    },
    './openui-search-results': { OpenUISearchResults: noop },
  }
  const exportsObj: Record<string, any> = {}
  runInNewContext(compiled, {
    exports: exportsObj,
    require: (name: string) => {
      if (!(name in mocks)) throw Error('Unexpected external dependency: ' + name)
      return mocks[name]
    },
    fetch: async (url: string, options: { method?: string; credentials?: unknown } = {}) => {
      requests.push({ url, method: options.method ?? 'GET', credentials: options.credentials })
      const next = replies.shift()
      if (next instanceof Error) throw next
      if (!next) throw Error('Unexpected fetch without inert fixture')
      return { ok: next.status >= 200 && next.status < 300, status: next.status,
        json: async () => next.body }
    },
    setInterval: (fn: () => void) => { interval = fn; return 1 },
    clearInterval: () => { interval = null },
    AbortSignal,
    document: { hidden: false },
  })
  const component = kind === 'page' ? exportsObj.default : exportsObj.OpenUIComparisonInline
  assert.equal(typeof component, 'function', 'real component must load')
  return {
    enqueue: (reply: SimulatedResponse | Error) => { replies.push(reply) },
    render: (id = ID) => {
      renderId = id
      cursor = 0
      effect = null
      if (kind === 'page') component({ params: Promise.resolve({ id }) })
      else component({ text: 'Open /dashboard/comparisons/' + id })
      assert.equal(typeof effect, 'function', 'effect was registered')
      return effect!() || noop
    },
    poll: () => { assert.equal(typeof interval, 'function'); interval!() },
    get data() { return slots[0] as typeof fixture | null },
    get error() { return String(slots[1] ?? '') },
    get requests() { return requests },
  }
}

const settle = async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)) }

const page = harness('app/dashboard/(app)/comparisons/[id]/page.tsx', 'page')
page.enqueue({ status: 200, body: fixture })
let stop = page.render()
await settle()
assert.equal(page.data?.id, ID, 'initial owner-scoped saved comparison was presented')

page.enqueue({ status: 401, body: { error: 'unauthorized' } })
page.poll()
await settle()
assert.equal(page.data, null, '401 on revalidation must remove a previously visible private report')
assert.match(page.error, /Sign in/, 'revoked session must be explained without stale cards')

page.enqueue({ status: 200, body: fixture })
page.poll()
await settle()
assert.equal(page.data?.id, ID)
page.enqueue(new Error('inert-network-failure'))
page.poll()
await settle()
assert.equal(page.data, null, 'network failure must not preserve an older price/source list')

page.enqueue({ status: 200, body: fixture })
page.poll()
await settle()
page.enqueue({ status: 200, body: { subject: 'missing providers' } })
page.poll()
await settle()
assert.equal(page.data, null, 'malformed successful response must fail closed')
assert.match(page.error, /incomplete/i)
page.enqueue({ status: 200, body: fixture })
page.poll()
await settle()
assert.equal(page.data?.id, ID)
page.enqueue({ status: 200, body: { ...fixture, id: OTHER_ID } })
page.poll()
await settle()
assert.equal(page.data, null, 'a 200 payload for a different run ID cannot replace owner-bound evidence')
page.enqueue({ status: 200, body: fixture })
page.poll()
await settle()
assert.equal(page.data?.id, ID)
stop()
page.enqueue(new Error('inert-switch'))
stop = page.render(OTHER_ID)
assert.equal(page.data, null, 'route change must remove old comparison before new fetch resolves')
await settle()
stop()

const inline = harness('components/dashboard/openui-comparison-inline.tsx', 'inline')
inline.enqueue({ status: 200, body: fixture })
const stopInline = inline.render()
await settle()
assert.equal(inline.data?.id, ID)
inline.enqueue(new Error('inert-network-failure'))
inline.poll()
await settle()
assert.equal(inline.data, null, 'inline network failure must revoke cached price cards')
inline.enqueue({ status: 200, body: fixture })
inline.poll()
await settle()
assert.equal(inline.data?.id, ID)
inline.enqueue({ status: 200, body: { subject: 'malformed' } })
inline.poll()
await settle()
assert.equal(inline.data, null, 'inline malformed successful response must revoke stale cards')
inline.enqueue({ status: 200, body: fixture })
inline.poll()
await settle()
inline.enqueue({ status: 403, body: { error: 'forbidden' } })
inline.poll()
await settle()
assert.equal(inline.data, null, 'inline non-OK result must continue to fail closed')
stopInline()

for (const req of [...page.requests, ...inline.requests]) {
  assert.match(req.url, /^\/api\/comparisons\/[0-9a-f-]{36}$/)
  assert.equal(req.method, 'GET', 'read-only regression may not submit or mutate')
  assert.equal(req.credentials, 'same-origin', 'only current authenticated session is used')
}
console.log('OpenUI comparison revalidation: real page + inline effects revoke stale private evidence (offline)')
