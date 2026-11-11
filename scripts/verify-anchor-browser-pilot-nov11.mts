// Addendum 6: Anchor Browser as an optional provider inside the existing managed-browser resolver.
import assert from 'node:assert/strict'
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, e: unknown, m: string) => { assert.deepEqual(a, e, m); checks++ }
const mb = await import('../lib/agent/managed-browser')
const { browserSandboxNameFor } = await import('../lib/agent/secure-browser-bootstrap')

const USER = '5f0c1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b', OTHER = '6f0c1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b'
const KEY = 'sk-anchor-fixture-0123456789'
const env: any = { ANCHOR_API_KEY: KEY, GOGO_BROWSER_ANCHOR_USERS: USER, VERCEL_ENV: 'production', GOGO_ANCHOR_PROFILE_SETTLE_MS: '0' }

// 1. Who gets Anchor: listed users only (both their sandboxes), never "on", never without the key.
const mine = browserSandboxNameFor(USER), mineCommerce = browserSandboxNameFor(`${USER}:commerce`), theirs = browserSandboxNameFor(OTHER)
eq([mb.anchorEnabledForSandbox(mine, env), mb.anchorEnabledForSandbox(mineCommerce, env), mb.anchorEnabledForSandbox(theirs, env), mb.anchorEnabledForSandbox(mine, { ...env, ANCHOR_API_KEY: '' }), mb.anchorEnabledForSandbox(mine, { ...env, GOGO_BROWSER_ANCHOR_USERS: 'on' }), mb.anchorEnabledForSandbox(mine, {})],
  [true, true, false, false, false, false], 'only listed users (general and commerce sandboxes), only with the key; "on" is not accepted')

// 2. The session request.
const cfg = mb.anchorSessionConfig('gogo-aaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb', 'f'.repeat(64), 'swiggy.com', false, 'production', ['swiggy.com'], false)
eq([cfg.session.recording.active, cfg.session.proxy, cfg.session.timeout, cfg.session.domain_allowlist, cfg.browser.profile, cfg.browser.captcha_solver.active, cfg.browser.extra_stealth.active, cfg.browser.web_bot_auth.active, cfg.session.live_view.one_time_url],
  [false, { active: true, type: 'anchor_proxy', country_code: 'in' }, { max_duration: 5, idle_timeout: 2 }, ['swiggy.com'], { name: 'gogo-aaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb', persist: true }, false, false, false, true],
  'no recording, India egress, 5-minute cap, the same top-level domains, a persistent named profile, no CAPTCHA solving, no stealth, Web Bot Auth off, one-time live view')
eq(mb.anchorSessionConfig('p', 'f'.repeat(64), 's', true, 'production', [], false).session.timeout.max_duration, 20, 'takeover and persistent commerce: the 20-minute owner-lock window')
ok(!JSON.stringify(cfg).includes(KEY), 'the API key is never in the request body')

// 3. A fake Anchor API.
let state: any = null, sessions: Record<string, any> = {}, calls: { method: string; path: string; body: any; headers: any }[] = []
let nextId = 1, cdp = (id: string) => `wss://connect.anchorbrowser.io?sessionId=${id}`, failCreate: number | null = null
const store = { load: async () => state && structuredClone(state), save: async (v: any) => { state = structuredClone(v) } }
const fetcher: typeof fetch = async (url, init: any) => {
  const path = String(url).replace(mb.ANCHOR_API + '/', ''), method = init?.method || 'GET', body = init?.body ? JSON.parse(init.body) : null
  calls.push({ method, path, body, headers: init?.headers })
  if (method === 'POST' && path === 'sessions') { if (failCreate) return new Response('{}', { status: failCreate }); const id = `sess-${String(nextId++).padStart(6, '0')}`; sessions[id] = { id, status: 'running', cdp_url: cdp(id), profile: body.browser.profile.name }; return new Response(JSON.stringify({ data: { id, cdp_url: cdp(id), live_view_url: `https://live.anchorbrowser.io/inspector.html?sessionId=${id}` } })) }
  const m = path.match(/^sessions\/([\w-]+)$/)
  if (m && method === 'GET') return sessions[m[1]] ? new Response(JSON.stringify({ data: sessions[m[1]] })) : new Response('{}', { status: 404 })
  if (m && method === 'DELETE') { if (sessions[m[1]]) sessions[m[1]].status = 'ended'; return new Response(JSON.stringify({ data: { status: 'ok' } })) }
  return new Response('{}', { status: 500 })
}
const run = (url: string, owner = mine, keepAlive = false) => mb.resolveAnchorSession(owner, url, store as any, env, fetcher, { keepAlive })

const a = await run('https://www.swiggy.com/instamart')
eq([a.provider, a.newSession, a.id.startsWith('anchor:'), a.host, a.scope], ['anchor', true, true, '*.anchorbrowser.io', 'swiggy.com'], 'a new Anchor session, its id marked as Anchor')
ok(calls.every(c => c.headers['anchor-api-key'] === KEY && !String(c.path).includes(KEY)), 'the key goes only in the header')
ok(!JSON.stringify(state).includes(KEY) && !JSON.stringify(state).includes('wss://'), 'stored state holds identifiers only: no key, no connection URL')
const profile = calls[0].body.browser.profile.name
const b = await run('https://www.swiggy.com/instamart')
eq([b.newSession, b.id], [false, a.id], 'the next wave reuses the live session')
eq(calls.filter(c => c.method === 'POST').length, 1, 'only one session created')
await a.release()
const c = await run('https://www.swiggy.com/instamart')
eq([c.newSession, calls.filter(c => c.method === 'POST').at(-1)!.body.browser.profile.name], [true, profile], 'after release a new session reuses the same profile, so the login is kept')
// A different site: the old session is ended first, so a profile never has two writers.
const before = calls.length
await run('https://www.makemytrip.com/flights')
const order = calls.slice(before).map(x => `${x.method} ${x.path.split('/')[0]}`)
ok(order.indexOf('DELETE sessions') >= 0 && order.indexOf('DELETE sessions') < order.lastIndexOf('POST sessions'), 'switching site ends the old session before starting a new one')
ok(calls.at(-1)!.body.browser.profile.name !== profile, 'each site has its own profile')
// Another owner cannot use this state.
await assert.rejects(() => run('https://www.swiggy.com', theirs), /owner_mismatch/); checks++

// 4. Failure handling: nothing is retried on another provider; unknown outcomes block new sessions.
state = null; failCreate = 402
await assert.rejects(() => run('https://www.swiggy.com'), /anchor_provider_http_402/); checks++
ok(!state.anchor.pending, 'a 4xx (e.g. no credits) created nothing, so it is not "outcome unknown"')
failCreate = null
const flaky: typeof fetch = async (u, i: any) => (i?.method === 'POST' ? Promise.reject(new Error('reset')) : fetcher(u, i))
state = null
await assert.rejects(() => mb.resolveAnchorSession(mine, 'https://www.swiggy.com', store as any, env, flaky), /anchor_provider_unavailable/); checks++
await assert.rejects(() => run('https://www.swiggy.com'), /anchor_setup_outcome_unknown/); checks++
ok(state.anchor.pending === 'session', 'a request whose outcome is unknown blocks new sessions instead of risking two writers')
// A connection URL that carries the account key is refused and the session ended.
state = null; cdp = (id: string) => `wss://connect.anchorbrowser.io?apiKey=${KEY}&sessionId=${id}`
await assert.rejects(() => run('https://www.swiggy.com'), /anchor_connection_embeds_api_key/); checks++
ok(Object.values(sessions).at(-1).status === 'ended' && !state.anchor.pending && !state.anchor.session, 'refused: the session is ended and nothing is stored')
state = null; cdp = (id: string) => `wss://evil.example.com/?sessionId=${id}`
await assert.rejects(() => run('https://www.swiggy.com'), /anchor_connection_invalid/); checks++
cdp = (id: string) => `wss://connect.anchorbrowser.io?sessionId=${id}`
// Private hosts are refused before any call.
const n = calls.length
for (const bad of ['http://127.0.0.1', 'http://169.254.169.254', 'https://a:b@example.com']) await assert.rejects(() => run(bad)).then(() => checks++)
eq(calls.length, n, 'no provider call for a private or credentialed URL')
// No key: refused.
await assert.rejects(() => mb.resolveAnchorSession(mine, 'https://www.swiggy.com', store as any, { ...env, ANCHOR_API_KEY: '' }, fetcher), /anchor_configuration_missing/); checks++

// 5. Release by id: Anchor ids go to Anchor, Browserbase ids are unchanged.
let hit = ''
const rel: typeof fetch = async (u, i: any) => { hit = `${i?.method} ${String(u)}`; return new Response('{}') }
eq(await mb.releaseManagedSessionById('anchor:sess-000123', env, rel), true, 'an Anchor session is ended through Anchor')
eq(hit, `DELETE ${mb.ANCHOR_API}/sessions/sess-000123`, 'with DELETE on its own id')
eq(await mb.releaseManagedSessionById('anchor:../../x', env, rel), false, 'a malformed id is refused')
// Browserbase state is untouched by the Anchor path.
state = { owner: (await import('node:crypto')).createHash('sha256').update(mine).digest('hex'), contexts: { 'swiggy.com': '22222222-2222-4222-8222-222222222222' } }
await run('https://www.swiggy.com/instamart')
eq(state.contexts, { 'swiggy.com': '22222222-2222-4222-8222-222222222222' }, 'the Browserbase login record is kept as it was, so switching back needs no new sign-in')

// 6. Wiring: Browserbase stays the default; the live-view lookup does not treat an Anchor id as a Browserbase one.
const { readFileSync } = await import('node:fs')
const src = readFileSync(new URL('../lib/agent/managed-browser.ts', import.meta.url), 'utf8')
ok(/const session=anchorEnabledForSandbox\(owner\)\?await resolveAnchorSession\(owner,url,store,process\.env,fetch,\{keepAlive\}\):await resolveManagedSession\(owner,url,store,process\.env,fetch,\{keepAlive\}\)/.test(src), 'Anchor only for listed users; everyone else on Browserbase as before')
eq(await mb.managedLiveViewUrl('anchor:sess-000123', { BROWSERBASE_API_KEY: 'x' } as any, async () => { throw new Error('must not be called') }), null, 'no Browserbase live-view call for an Anchor session (the takeover falls back to the screenshot relay)')
// Review, 11 Nov: one writer per profile is enforced, not hoped for.
{ const fresh = async () => { state = null; sessions = {}; calls = []; return run('https://www.swiggy.com') }
  await fresh()
  ok(/^gogo-[0-9a-f]{32}$/.test(calls.at(-1)!.body.browser.profile.name), 'the profile name is random and stored, not derived from the owner')
  const p1 = calls.at(-1)!.body.browser.profile.name
  state = null; await run('https://www.swiggy.com')
  ok(calls.at(-1)!.body.browser.profile.name !== p1, 'a lost state file starts a fresh profile instead of attaching to the live one')
  // An unexpected status and a DELETE that fails: no second session.
  await fresh()
  const id = Object.keys(sessions)[0]
  sessions[id].status = 'starting'
  const failingDelete: typeof fetch = async (u, i: any) => (i?.method === 'DELETE' ? new Response('{}', { status: 503 }) : fetcher(u, i))
  const posts = calls.filter(c => c.method === 'POST').length
  await assert.rejects(() => mb.resolveAnchorSession(mine, 'https://www.makemytrip.com', store as any, env, failingDelete), /anchor_previous_session_closing/); checks++
  eq(calls.filter(c => c.method === 'POST').length, posts, 'no new session while the old one may still be writing')
  ok(state.anchor.session?.id === id, 'and the old session is still on record')
  // DELETE accepted but the session still reports running: still refused.
  const stuck: typeof fetch = async (u, i: any) => (i?.method === 'DELETE' ? new Response('{}') : fetcher(u, i))
  sessions[id].status = 'running'
  await assert.rejects(() => mb.resolveAnchorSession(mine, 'https://www.makemytrip.com', store as any, env, stuck), /anchor_previous_session_closing/); checks++
  // A session near its cap is not reused.
  await fresh(); state.anchor.session.startedAt = Date.now() - 4.5 * 60_000
  const before = calls.filter(c => c.method === 'POST').length
  await run('https://www.swiggy.com')
  eq(calls.filter(c => c.method === 'POST').length, before + 1, 'a session with under a minute left is replaced, not reused')
  // An unknown outcome lifts by itself after the longest possible session.
  state.anchor.pending = 'session'; state.anchor.pendingAt = Date.now() - 26 * 60_000; delete state.anchor.session
  await run('https://www.swiggy.com'); ok(!state.anchor.pending, 'a stale unknown-outcome marker is cleared after 25 minutes')
  state.anchor.pending = 'session'; state.anchor.pendingAt = Date.now() - 60_000; delete state.anchor.session
  await assert.rejects(() => run('https://www.swiggy.com'), /anchor_setup_outcome_unknown/); checks++
  // Connection host rules; upper-case ids in the setting still match.
  for (const bad of ['wss://anchorbrowser.io/x', 'wss://connect.anchorbrowser.io:8443/x', 'wss://anchorbrowser.io.evil.com/x']) { state = null; cdp = () => bad; await assert.rejects(() => run('https://www.swiggy.com'), /anchor_connection_invalid/).then(() => checks++) }
  cdp = (i: string) => `wss://connect.anchorbrowser.io?sessionId=${i}`
  ok(mb.anchorEnabledForSandbox(mine, { ...env, GOGO_BROWSER_ANCHOR_USERS: USER.toUpperCase() }), 'an id pasted in capitals still matches') }
// Second review: a refused connection whose session could not be ended stays on record; old-format state is handled.
{ state = null; sessions = {}
  cdp = (id: string) => `wss://connect.anchorbrowser.io?apiKey=${KEY}&sessionId=${id}`
  const noDelete: typeof fetch = async (u, i: any) => (i?.method === 'DELETE' ? new Response('{}', { status: 503 }) : fetcher(u, i))
  await assert.rejects(() => mb.resolveAnchorSession(mine, 'https://www.swiggy.com', store as any, env, noDelete), /anchor_connection_embeds_api_key/); checks++
  const left = Object.keys(sessions)[0]
  ok(state.anchor.session?.id === left, 'the session that could not be ended is kept on record')
  cdp = (id: string) => `wss://connect.anchorbrowser.io?sessionId=${id}`
  const posts = calls.filter(c => c.method === 'POST').length
  await assert.rejects(() => mb.resolveAnchorSession(mine, 'https://www.swiggy.com', store as any, env, noDelete), /anchor_previous_session_closing/); checks++
  eq(calls.filter(c => c.method === 'POST').length, posts, 'so the next run does not start a second writer')
  state = { owner: state.owner, contexts: {}, anchor: { profiles: { 'swiggy.com': 'gogo-aaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb' } } }
  await run('https://www.swiggy.com')
  ok(/^gogo-[0-9a-f]{32}$/.test(calls.at(-1)!.body.browser.profile.name), 'an old-format stored name is replaced, not trusted')
  state.anchor = { profiles: {}, pending: 'session' }
  await assert.rejects(() => run('https://www.swiggy.com'), /anchor_setup_outcome_unknown/); checks++
  ok(Number.isFinite(state.anchor.pendingAt), 'a marker without a time is stamped, so it clears in 25 minutes') }
console.log(`ANCHOR_PILOT_OK ${checks} checks`)
