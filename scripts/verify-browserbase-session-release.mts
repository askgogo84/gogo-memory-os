import assert from 'node:assert/strict'

// Allow importing modules that eagerly construct the Supabase admin client.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const {
  resolveManagedSession, ensureManagedBrowser, releaseManagedSessionById,
  NORMAL_SESSION_TIMEOUT_SECONDS, KEEPALIVE_SESSION_TIMEOUT_SECONDS,
} = await import('../lib/agent/managed-browser')
const { sweepOrphanManagedSessions, ORPHAN_AGE_SECONDS } = await import('../lib/agent/browser-session-sweeper')

const PROJECT = '11111111-1111-4111-8111-111111111111'
const CTX = '22222222-2222-4222-8222-222222222222'
const SESS = '33333333-3333-4333-8333-333333333333'
const ENDPOINT = 'wss://connect.ap-southeast-1.browserbase.com/?secret=fixture'
const env = { BROWSERBASE_API_KEY: 'fixture-only', BROWSERBASE_PROJECT_ID: PROJECT }
const J = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

function makeFetcher(running: any[] = []) {
  const reqs: Array<{ path: string; method: string; body: any }> = []
  const released = new Set<string>()
  const fetcher: typeof fetch = async (url, init) => {
    const path = String(url).split('/v1/')[1]
    const body = init?.body ? JSON.parse(String(init.body)) : null
    reqs.push({ path, method: init?.method || 'GET', body })
    if (path.startsWith('sessions?')) return J(running)
    if (path === 'contexts') return J({ id: CTX, projectId: PROJECT })
    if (path.startsWith('contexts/')) return J({ id: path.split('/')[1], projectId: PROJECT })
    if (path === 'sessions') return J({ id: SESS, projectId: PROJECT, contextId: body.browserSettings.context.id, userMetadata: body.userMetadata, status: 'RUNNING', expiresAt: new Date(Date.now() + 1200000).toISOString(), connectUrl: ENDPOINT })
    const m = path.match(/^sessions\/([^?]+)$/)
    if (m) { if ((init?.method || 'GET') === 'POST') { released.add(m[1]); return J({ id: m[1], status: 'COMPLETED' }) } return J({ id: m[1], projectId: PROJECT, status: 'RUNNING' }) }
    throw new Error('unexpected fixture request: ' + path)
  }
  return { fetcher, reqs, released }
}
const memStore = () => { let s: any = null; return { load: async () => s && structuredClone(s), save: async (v: any) => { s = structuredClone(v) } } }

// 1. Timeout/keepAlive values sent at session creation.
{
  const { fetcher, reqs } = makeFetcher()
  await resolveManagedSession('owner', 'https://www.amazon.in', memStore(), env, fetcher, { keepAlive: false })
  const normal = reqs.find(r => r.path === 'sessions' && r.method === 'POST')!.body
  assert.equal(normal.timeout, 300)
  assert.equal(normal.timeout, NORMAL_SESSION_TIMEOUT_SECONDS)
  assert.equal(normal.keepAlive, false)
}
{
  const { fetcher, reqs } = makeFetcher()
  await resolveManagedSession('owner', 'https://www.amazon.in', memStore(), env, fetcher, { keepAlive: true })
  const ka = reqs.find(r => r.path === 'sessions' && r.method === 'POST')!.body
  assert.equal(ka.timeout, 1200)
  assert.equal(ka.timeout, KEEPALIVE_SESSION_TIMEOUT_SECONDS)
  assert.equal(ka.keepAlive, true)
}
// 1b. Session is tagged with app + deployment env at creation (userMetadata).
{
  const { fetcher, reqs } = makeFetcher()
  await resolveManagedSession('owner', 'https://www.amazon.in', memStore(), { ...env, VERCEL_ENV: 'production' }, fetcher, { keepAlive: false })
  const body = reqs.find(r => r.path === 'sessions' && r.method === 'POST')!.body
  assert.equal(body.userMetadata.app, 'askgogo')
  assert.equal(body.userMetadata.env, 'production')
}

// 2. Release on a thrown error while wiring up the sandbox (network policy fails).
{
  const { fetcher, released } = makeFetcher()
  const savedFetch = globalThis.fetch
  globalThis.fetch = fetcher
  const savedEnv = { k: process.env.BROWSERBASE_API_KEY, p: process.env.BROWSERBASE_PROJECT_ID, r: process.env.GOGO_BROWSER_RUNTIME }
  process.env.BROWSERBASE_API_KEY = 'fixture-only'
  process.env.BROWSERBASE_PROJECT_ID = PROJECT
  process.env.GOGO_BROWSER_RUNTIME = 'browserbase'
  const sandbox = {
    runCommand: async () => ({ exitCode: 0, stdout: async () => 'null', stderr: async () => '' }),
    writeFiles: async () => {},
    updateNetworkPolicy: async () => { throw new Error('policy_boom') },
  }
  await assert.rejects(() => ensureManagedBrowser(sandbox, 'owner', 'https://www.amazon.in', false), /policy_boom/)
  assert.ok(released.has(SESS), 'a created session must be REQUEST_RELEASE-d when sandbox wiring throws')
  globalThis.fetch = savedFetch
  process.env.BROWSERBASE_API_KEY = savedEnv.k; process.env.BROWSERBASE_PROJECT_ID = savedEnv.p; process.env.GOGO_BROWSER_RUNTIME = savedEnv.r
}

// 3. Release by id (handoff completion / cancel / expiry teardown), idempotent.
{
  const { fetcher, released } = makeFetcher()
  assert.equal(await releaseManagedSessionById(SESS, env, fetcher), true)
  assert.ok(released.has(SESS))
  assert.equal(await releaseManagedSessionById('not-a-uuid', env, fetcher), false, 'invalid id is a no-op')
}

// 4 & 5. Sweep releases only a production-tagged, aged, non-active orphan; skips an
// active handoff, a young session, a preview-tagged session, and an untagged session.
{
  const now = 1_000_000_000_000
  const OLD = '44444444-4444-4444-8444-444444444444'      // production, aged, orphan → released
  const ACTIVE = '55555555-5555-4555-8555-555555555555'   // production, aged, active handoff → skipped
  const YOUNG = '66666666-6666-4666-8666-666666666666'    // production, young → skipped
  const PREVIEW = '77777777-7777-4777-8777-777777777777'  // preview-tagged, aged → skipped (not production)
  const UNTAGGED = '88888888-8888-4888-8888-888888888888' // no tag, aged → skipped
  const prod = (id: string, mins: number) => ({ id, projectId: PROJECT, startedAt: new Date(now - mins * 60000).toISOString(), userMetadata: { app: 'askgogo', env: 'production' } })
  const running = [
    prod(OLD, 30), prod(ACTIVE, 30), prod(YOUNG, 1),
    { id: PREVIEW, projectId: PROJECT, startedAt: new Date(now - 30 * 60000).toISOString(), userMetadata: { app: 'askgogo', env: 'preview' } },
    { id: UNTAGGED, projectId: PROJECT, startedAt: new Date(now - 30 * 60000).toISOString() },
  ]
  assert.equal(ORPHAN_AGE_SECONDS, 1500)
  const { fetcher, released } = makeFetcher(running)
  const res = await sweepOrphanManagedSessions({ env, fetcher, now, activeSessionIds: new Set([ACTIVE]) })
  assert.equal(res.inspected, 5)
  assert.equal(res.released, 1)
  assert.ok(released.has(OLD), 'production aged orphan released')
  assert.ok(!released.has(ACTIVE), 'active handoff session never released')
  assert.ok(!released.has(YOUNG), 'young session not released')
  assert.ok(!released.has(PREVIEW), 'preview-tagged session never released by a production sweep')
  assert.ok(!released.has(UNTAGGED), 'untagged session never released')
  assert.equal(res.skippedActive, 1)
  assert.equal(res.skippedYoung, 1)
  assert.equal(res.skippedUntagged, 2) // preview + untagged
}

// 6. The cron route refuses outside production and releases nothing (shared project/key).
{
  const { GET } = await import('../app/api/cron/browser-session-sweep/route')
  const savedFetch = globalThis.fetch
  globalThis.fetch = (async () => { throw new Error('non-production sweep must not reach Browserbase') }) as any
  const saved = { cron: process.env.CRON_SECRET, ve: process.env.VERCEL_ENV, rt: process.env.GOGO_BROWSER_RUNTIME }
  process.env.CRON_SECRET = 'sweep-secret'
  process.env.VERCEL_ENV = 'preview'
  process.env.GOGO_BROWSER_RUNTIME = 'browserbase'
  const res = await GET(new Request('https://x/api/cron/browser-session-sweep?secret=sweep-secret'))
  const body: any = await res.json()
  assert.equal(body.skipped, 'non_production', 'non-production sweep releases nothing')
  globalThis.fetch = savedFetch
  const restore = (k: string, v: string | undefined) => { if (v === undefined) delete (process.env as any)[k]; else process.env[k] = v }
  restore('CRON_SECRET', saved.cron); restore('VERCEL_ENV', saved.ve); restore('GOGO_BROWSER_RUNTIME', saved.rt)
}

console.log('Browserbase session release + sweep verification passed')
