// Offline regression executing the *actual* comparison React components.
// This minimal React hook runner models dependencies, effect cleanup, rerender
// scheduling and JSX produced BEFORE effects run. It never mounts an actual
// browser, queries customer data, invokes providers or runs a mutation.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const ID = '61bdc60d-a901-4fa0-868b-3461790df018'
const OTHER_ID = '4afce011-8571-4ea5-89df-74e2a5a51ca1'
const fixture = { id: ID, subject: 'Private fixture comparison', request: 'Read only',
  status: 'completed', updatedAt: '2026-10-25T08:00:00Z', providers: [] }
type Reply = { status: number; body?: unknown }
type Element = { type: unknown; props: Record<string, any> }
type DependencyState = { deps: unknown[]; cleanup?: () => void }
const same = (a: unknown[] | undefined, b: unknown[] | undefined) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
    a.every((v, i) => Object.is(v, b[i]))
const childHas = (node: unknown, predicate: (item: Element) => boolean): boolean => {
  if (Array.isArray(node)) return node.some(n => childHas(n, predicate))
  if (node === null || typeof node !== 'object') return false
  const item = node as Element
  return predicate(item) || childHas(item.props?.children, predicate)
}
const tick = async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)) }

function mount(file: string, mode: 'page' | 'inline') {
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const states = new Map<number, any>()
  const memos = new Map<number, { deps: unknown[]; value: unknown }>()
  const existingEffects = new Map<number, DependencyState>()
  let nextEffects: Array<{ index: number; cb: () => (() => void) | void; deps: unknown[] }> = []
  let currentId = ID
  let cursor = 0
  let tree: unknown = null
  let interval: (() => void) | null = null
  let scheduled = false
  let mounted = false
  const replies: Array<Reply | Error> = []
  const requests: Array<{ url: string; method: string; credentials: unknown }> = []
  const SearchMarker = () => null
  const jsx = (type: unknown, props: Record<string, any> = {}) => ({ type, props })
  const schedule = () => {
    if (scheduled || !mounted) return
    scheduled = true
    queueMicrotask(() => { scheduled = false; if (mounted) commitRender() })
  }
  const react = {
    use: () => ({ id: currentId }),
    useMemo: (fn: () => unknown, deps: unknown[]) => {
      const index = cursor++
      const prior = memos.get(index)
      if (prior && same(prior.deps, deps)) return prior.value
      const value = fn()
      memos.set(index, { deps: [...deps], value })
      return value
    },
    useState: (initial: unknown) => {
      const index = cursor++
      if (!states.has(index)) states.set(index, initial)
      return [states.get(index), (value: unknown) => {
        states.set(index, typeof value === 'function' ? (value as Function)(states.get(index)) : value)
        schedule()
      }]
    },
    useEffect: (cb: () => (() => void) | void, deps: unknown[]) => {
      nextEffects.push({ index: cursor++, cb, deps })
    },
  }
  const noOp = () => null
  const imports: Record<string, unknown> = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol('Fragment') },
    'next/link': noOp,
    '@/lib/commerce/comparison-model': { COMPARISON_PROVIDERS: {}, comparisonHandoffPath: noOp },
    '@/components/dashboard/openui-search-results': { OpenUISearchResults: SearchMarker },
    './openui-search-results': { OpenUISearchResults: SearchMarker },
    '@/lib/openui/search-observation': {
      savedComparisonId: (value: string) => value.match(/comparisons\/([0-9a-f-]+)/i)?.[1] ?? null,
    },
  }
  const exportsObj: Record<string, any> = {}
  runInNewContext(compiled, {
    exports: exportsObj,
    require: (name: string) => {
      if (!(name in imports)) throw Error('Unexpected external dependency: ' + name)
      return imports[name]
    },
    fetch: async (url: string, options: { method?: string; credentials?: unknown } = {}) => {
      requests.push({ url, method: options.method ?? 'GET', credentials: options.credentials })
      const reply = replies.shift()
      if (reply instanceof Error) throw reply
      if (!reply) throw Error('Unmocked fetch would reach external system')
      return { ok: reply.status >= 200 && reply.status < 300,
        status: reply.status, json: async () => reply.body }
    },
    setInterval: (fn: () => void) => { interval = fn; return 1 },
    clearInterval: () => { interval = null },
    document: { hidden: false }, AbortSignal,
  })
  const component = mode === 'page' ? exportsObj.default : exportsObj.OpenUIComparisonInline
  assert.equal(typeof component, 'function', 'actual component must be loaded')
  // Render commits JSX before useEffect. An effect dependency must change to
  // clean up the old subscription, refetch and install a new timer.
  function commitRender() {
    cursor = 0
    nextEffects = []
    tree = mode === 'page'
      ? component({ params: Promise.resolve({ id: currentId }) })
      : component({ text: 'Open /dashboard/comparisons/' + currentId })
    for (const item of nextEffects) {
      const prior = existingEffects.get(item.index)
      if (prior && same(prior.deps, item.deps)) continue
      prior?.cleanup?.()
      const cleanup = item.cb()
      existingEffects.set(item.index, {
        deps: [...item.deps], cleanup: typeof cleanup === 'function' ? cleanup : undefined,
      })
    }
    return tree
  }
  return {
    enqueue: (reply: Reply | Error) => { replies.push(reply) },
    render: (id = ID) => { currentId = id; mounted = true; return commitRender() },
    poll: () => { assert.equal(typeof interval, 'function', 'poll timer registered'); interval!() },
    get data() { return states.get(mode === 'page' ? 0 : 1) as typeof fixture | null },
    get error() { return String(states.get(1) ?? '') },
    get requests() { return requests },
    visible: (snapshot: unknown = tree, id?: string) =>
      childHas(snapshot, node => node.type === SearchMarker &&
        (!id || node.props?.data?.id === id)),
    dispose: () => {
      mounted = false
      for (const item of existingEffects.values()) item.cleanup?.()
      existingEffects.clear()
    },
  }
}

const page = mount('app/dashboard/(app)/comparisons/[id]/page.tsx', 'page')
page.enqueue({ status: 200, body: fixture })
const before = page.render(ID)
assert.equal(page.visible(before), false, 'initial frame has no private source cards')
await tick()
assert.equal(page.visible(), true, 'successful real GET causes rendered cards')

page.enqueue({ status: 401, body: { error: 'unauthorized' } })
page.poll()
await tick()
assert.equal(page.data, null)
assert.equal(page.visible(), false, 'a 401 removes already-rendered private cards')
assert.match(page.error, /Sign in/)

page.enqueue({ status: 200, body: fixture })
page.poll()
await tick()
assert.equal(page.visible(), true)
page.enqueue(new Error('offline'))
page.poll()
await tick()
assert.equal(page.visible(), false, 'offline revalidation revokes rendered results')

page.enqueue({ status: 200, body: fixture })
page.poll()
await tick()
page.enqueue({ status: 200, body: { subject: 'missing providers' } })
page.poll()
await tick()
assert.equal(page.visible(), false, '200 without evidence rows fails closed')
assert.match(page.error, /incomplete/i)

page.enqueue({ status: 200, body: fixture })
page.poll()
await tick()
page.enqueue({ status: 200, body: { ...fixture, id: OTHER_ID } })
page.poll()
await tick()
assert.equal(page.visible(), false, '200 for a different run ID cannot display')
page.enqueue({ status: 200, body: fixture })
page.poll()
await tick()
assert.equal(page.visible(ID), true)

page.enqueue({ status: 200, body: { ...fixture, id: OTHER_ID } })
const requestsBeforeRoute = page.requests.length
const preEffectRoute = page.render(OTHER_ID)
assert.equal(page.visible(preEffectRoute), false, 'route-change frame cannot flash old report before effect')
await tick()
assert.equal(page.requests.length, requestsBeforeRoute + 1, '[id] effect must re-fetch on route change')
assert.equal(page.requests.at(-1)?.url, '/api/comparisons/' + OTHER_ID)
assert.equal(page.visible(ID), false)
assert.equal(page.visible(OTHER_ID), true)
page.dispose()

const inline = mount('components/dashboard/openui-comparison-inline.tsx', 'inline')
inline.enqueue({ status: 200, body: fixture })
inline.render(ID)
await tick()
assert.equal(inline.visible(ID), true)
inline.enqueue(new Error('offline'))
inline.poll()
await tick()
assert.equal(inline.visible(), false, 'inline network error clears rendered card')
inline.enqueue({ status: 200, body: fixture })
inline.poll()
await tick()
assert.equal(inline.visible(ID), true)
inline.enqueue({ status: 200, body: { subject: 'malformed' } })
inline.poll()
await tick()
assert.equal(inline.visible(), false, 'inline malformed 200 clears rendered card')
inline.enqueue({ status: 200, body: fixture })
inline.poll()
await tick()
inline.enqueue({ status: 403, body: { error: 'forbidden' } })
inline.poll()
await tick()
assert.equal(inline.visible(), false, '403 does not preserve inline cached card')
inline.enqueue({ status: 200, body: fixture })
inline.poll()
await tick()
assert.equal(inline.visible(ID), true)

inline.enqueue({ status: 200, body: { ...fixture, id: OTHER_ID } })
const inlineBefore = inline.requests.length
const inlinePreEffectRoute = inline.render(OTHER_ID)
assert.equal(inline.visible(inlinePreEffectRoute), false, 'Chat link change cannot flash another ID')
await tick()
assert.equal(inline.requests.length, inlineBefore + 1, '[id] inline effect must refetch on link change')
assert.equal(inline.visible(ID), false)
assert.equal(inline.visible(OTHER_ID), true)
inline.dispose()

for (const req of [...page.requests, ...inline.requests]) {
  assert.match(req.url, /^\/api\/comparisons\/[0-9a-f-]{36}$/)
  assert.equal(req.method, 'GET', 'only read-only comparison GET is executed')
  assert.equal(req.credentials, 'same-origin', 'requires authenticated same-origin session')
}
console.log('OpenUI comparison: real JSX + dependency-aware effects revoke stale cards (offline)')
