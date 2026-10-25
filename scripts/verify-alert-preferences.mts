// Duet parity step 2: what you hear about and how often — frequency, topics, quiet hours.
// Run: npx tsx scripts/verify-alert-preferences.mts
import assert from 'node:assert/strict'
import ts from 'typescript'
import { runInNewContext } from 'node:vm'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://state-fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only'

let tableMissing = true
let row: any = null
const writes: any[] = []
const originalFetch = globalThis.fetch
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = (async (input: any, init: any) => {
  const url = new URL(String(input)), method = init?.method || 'GET'
  assert.equal(url.origin, 'https://state-fixture.supabase.co', 'no live service permitted')
  const table = url.pathname.split('/').at(-1)
  const body = init?.body ? JSON.parse(String(init.body)) : null
  if (table === 'user_alert_preferences') {
    if (tableMissing) return json({ code: 'PGRST205', message: "Could not find the table 'public.user_alert_preferences' in the schema cache" }, 404)
    if (method === 'GET') { assert.equal(url.searchParams.get('telegram_id'), 'eq.123'); return json(row) }
    assert.equal(method, 'POST'); assert.match(url.searchParams.get('on_conflict') || '', /telegram_id/)
    row = body; writes.push({ table, body }); return json(null, 201)
  }
  if (table === 'agent_watchers') { assert.equal(method, 'PATCH'); assert.equal(url.searchParams.get('type'), 'eq.email_triage'); assert.equal(url.searchParams.get('telegram_id'), 'eq.123'); writes.push({ table, body }); return new Response(null, { status: 204 }) }
  if (table === 'agent_activity') { writes.push({ table, body }); return json(null, 201) }
  throw new Error('unexpected table ' + table)
}) as any

try {
  const ap = await import('../lib/agent/alert-preferences')

  // Defaults keep today's behaviour (hourly checks, 10 pm–7 am quiet, everything on) — also before the migration.
  const d = await ap.getAlertPreferences('123')
  assert.deepEqual([d.checkEveryMinutes, d.quietStart, d.quietEnd, d.saved], [60, 22, 7, false])
  assert.ok(Object.values(d.topics).every(Boolean))
  assert.deepEqual(await ap.saveAlertPreferences('123', d), { ok: false, error: 'not_ready' }, 'missing table is reported, not thrown')

  // Validation: only the offered choices.
  const body = { checkEveryMinutes: 240, quietStart: 23, quietEnd: 6, topics: { ideas: false, watches: true } }
  const parsed = ap.parseAlertPreferencesBody(body)!
  assert.equal(parsed.checkEveryMinutes, 240); assert.equal(parsed.topics.ideas, false); assert.equal(parsed.topics.bills, true, 'unspecified topics stay on')
  for (const bad of [{ ...body, checkEveryMinutes: 30 }, { ...body, quietStart: 24 }, { ...body, topics: { spam: true } }, { ...body, topics: { ideas: 'no' } }, null]) assert.equal(ap.parseAlertPreferencesBody(bad), null)

  // Quiet hours wrap past midnight; equal start/end = never quiet.
  const q = { quietStart: 22, quietEnd: 7 }
  assert.deepEqual([23, 2, 6, 7, 12, 21].map(h => ap.isQuietHour(q, h)), [true, true, true, false, false, false])
  assert.equal(ap.isQuietHour({ quietStart: 13, quietEnd: 15 }, 14), true)
  assert.equal(ap.isQuietHour({ quietStart: 9, quietEnd: 9 }, 9), false)

  // Frequency.
  const now = Date.parse('2026-10-22T09:00:00Z')
  assert.equal(ap.dueForCheck({ checkEveryMinutes: 120 }, '2026-10-22T08:00:00Z', now), false)
  assert.equal(ap.dueForCheck({ checkEveryMinutes: 120 }, '2026-10-22T07:00:00Z', now), true)
  assert.equal(ap.dueForCheck({ checkEveryMinutes: 120 }, null, now), true)

  // Topics: approvals never muted; bills/replies/travel/tasks mapped from pulse items.
  assert.equal(ap.topicForPulse('approval'), null)
  assert.equal(ap.allowedByTopic({ topics: { ...d.topics, tasks: false } }, null), true)
  assert.equal(ap.topicForPulse('open_loop', { kind: 'followup', source_type: 'gmail_service_notice' }), 'bills')
  assert.equal(ap.topicForPulse('open_loop', { kind: 'followup', source_type: 'gmail' }), 'replies')
  assert.equal(ap.topicForPulse('life_event'), 'travel')
  assert.equal(ap.topicForPulse('browser_blocker'), 'tasks')
  assert.equal(ap.allowedByTopic({ topics: { ...d.topics, ideas: false } }, 'ideas'), false)

  // Save: one owner row, inbox watch follows the frequency, audit row.
  tableMissing = false
  assert.deepEqual(await ap.saveAlertPreferences('123', parsed), { ok: true })
  assert.equal(row.check_every_minutes, 240); assert.equal(row.topics.ideas, false); assert.equal(row.telegram_id, '123')
  assert.equal(writes.find(w => w.table === 'agent_watchers')?.body.cadence_minutes, 240)
  assert.deepEqual(writes.find(w => w.table === 'agent_activity')?.body.metadata_json.muted, ['ideas'])
  const back = await ap.getAlertPreferences('123')
  assert.deepEqual([back.checkEveryMinutes, back.quietStart, back.quietEnd, back.topics.ideas, back.saved], [240, 23, 6, false, true])

  // Wiring.
  const pulse = readFileSync('lib/agent/autonomy-pulse.ts', 'utf8')
  assert.match(pulse, /if\(isQuietHour\(prefs,hour\)\)return \{sent:false,reason:'quiet_hours'\}/)
  assert.match(pulse, /dueForCheck\(prefs,await lastPulseAt\(telegramId,prefs\.checkEveryMinutes\)\)/)
  assert.match(pulse, /allowedByTopic\(prefs,/)
  assert.doesNotMatch(pulse, /hour<7\|\|hour>=22/, 'hard-coded quiet hours replaced')
  const watch = readFileSync('lib/agent/watch-alert-delivery.ts', 'utf8')
  assert.match(watch, /topics\.every\(t => prefs\.topics\[t\] === false\)\) return \{ state: 'app_only'/)
  assert.match(readFileSync('lib/agent/watchers.ts', 'utf8'), /topic:\['bills','replies'\]/)
  assert.match(readFileSync('lib/agent/flight-leg-tracker.ts', 'utf8'), /topic: 'travel'/)
  const client = readFileSync('components/dashboard/alert-settings.tsx', 'utf8')
  assert.doesNotMatch(client, /from '@\/lib\/agent\/alert-preferences'/, 'the client form never imports the server module')
  const route = readFileSync('app/api/agent/alert-preferences/route.ts', 'utf8')
  assert.match(route, /requireAgentMutationOrigin\(request\)/)
  const sql = readFileSync('supabase/migrations/20261022100000_user_alert_preferences.sql', 'utf8')
  assert.match(sql, /enable row level security/); assert.match(sql, /revoke all on table public\.user_alert_preferences from public, anon, authenticated/)
  assert.match(sql, /workspace_id uuid null/, 'reserved for team workspaces')
  console.log('Alert preferences: defaults before migration, strict choices, quiet hours, frequency, topics, inbox cadence, audit')
} finally {
  globalThis.fetch = originalFetch
}


// P1: exercise the actual transpiled alert-settings API and page with inert,
// synthetic 64-bit owner rows. No network, tenant data, email or real mutation.
{
  const { exactAlertOwnerId } = await import('../lib/agent/alert-owner-id.ts')
  const first = '9007199254740992'
  const second = '9007199254740993'
  assert.equal(Number(first), Number(second), 'the pre-fix Number coercion aliases unrelated owners')
  assert.equal(exactAlertOwnerId(first), first)
  assert.equal(exactAlertOwnerId(second), second)
  assert.equal(exactAlertOwnerId('-9223372036854775808'), '-9223372036854775808')
  assert.equal(exactAlertOwnerId('9223372036854775807'), '9223372036854775807')
  assert.equal(exactAlertOwnerId('123', 'ios'), '123')
  assert.equal(exactAlertOwnerId(first, 'android'), null, 'mobile legacy actor is a lossy number')
  assert.equal(exactAlertOwnerId(Number(second)), null, 'already rounded number cannot authorize')
  for (const bad of [null, undefined, 0, '0', '-0', '01', '+1', '1.0', '1e2', '2junk', ' 123', '9223372036854775808', '-9223372036854775809']) {
    assert.equal(exactAlertOwnerId(bad), null, 'invalid signed-64-bit identity must fail closed: ' + String(bad))
  }

  const userRows = new Map<string, any>([
    [first, { briefing_enabled: false, briefing_time: '07:00' }],
    [second, { briefing_enabled: true, briefing_time: '11:30' }],
    ['123', { briefing_enabled: false, briefing_time: '08:30' }],
    ['-9223372036854775808', { briefing_enabled: true, briefing_time: '06:10' }],
  ])
  const dbReads: string[] = []
  const dbWrites: string[] = []
  const prefReads: string[] = []
  const prefWrites: string[] = []
  let parsedBodies = 0
  let actor: any = null
  let pageActor: any = null
  let rejectOrigin = false
  const response = (body: unknown, status = 200) => Response.json(body, { status })
  const supabase = {
    from(table: string) {
      assert.equal(table, 'users', 'unexpected table: production service-role client is never reached')
      let filter: string | undefined
      let patch: Record<string, any> | null = null
      const q: any = {
        select: () => q,
        update: (body: any) => { patch = body; return q },
        eq: (field: string, value: any) => {
          assert.equal(field, 'telegram_id')
          assert.equal(typeof value, 'string', 'authorization filter must be an exact persisted decimal string')
          filter = value
          return q
        },
        maybeSingle: async () => {
          assert.notEqual(filter, undefined, 'select must be owner-scoped')
          dbReads.push(filter!)
          return { data: userRows.get(filter!) || null, error: null }
        },
        then: (done: any, fail: any) => {
          // An omitted WHERE condition intentionally mutates BOTH fixture users;
          // tests must prove the real PUT write filter is bound, not just its read.
          if (patch) {
            const targets = filter === undefined ? [...userRows.keys()] : [filter]
            for (const target of targets) {
              const row = userRows.get(target)
              if (row) Object.assign(row, patch)
              dbWrites.push(target)
            }
          }
          return Promise.resolve({ error: null }).then(done, fail)
        },
      }
      return q
    },
  }
  const mockedSession = {
    requireAgentSession: async () => actor || response({ error: 'unauthorized' }, 401),
    isAgentSession: (value: any) => Boolean(value && typeof value.telegramId === 'string'),
    requireAgentMutationOrigin: (_req: any) => rejectOrigin ? response({ error: 'bad_origin' }, 403) : null,
  }
  const mockAlertPreferences = {
    DEFAULT_ALERT_PREFERENCES: { saved: false },
    getAlertPreferences: async (owner: string) => { prefReads.push(owner); return { saved: true, checkedOwner: owner } },
    saveAlertPreferences: async (owner: string, _prefs: any) => { prefWrites.push(owner); return { ok: true } },
    parseAlertPreferencesBody: (body: any) => body?.checkEveryMinutes === 60 ? body : null,
  }
  const moduleLoad = (file: string, deps: Record<string, any>) => {
    const exports: any = {}
    const transpiled = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    runInNewContext(transpiled, {
      exports, require: (name: string) => {
        if (!(name in deps)) throw Error('unmocked module in isolated test: ' + name)
        return deps[name]
      },
      Response, Request, URL, URLSearchParams, console, BigInt, process, Date, setTimeout, clearTimeout,
    })
    return exports
  }
  const routeFile = 'app/api/agent/alert-preferences/route.ts'
  const pageFile = 'app/dashboard/(app)/alerts/page.tsx'
  const routeSource = readFileSync(routeFile, 'utf8')
  const pageSource = readFileSync(pageFile, 'utf8')
  assert.match(routeSource, /requireAgentMutationOrigin\(request\)/, 'keep the browser CSRF gate')
  assert.doesNotMatch(routeSource, /Number\((?:session\.telegramId|telegramId)\)/, 'never round before a privileged query')
  assert.doesNotMatch(pageSource, /Number\(tg\)/, 'SSR must not round private account identity')
  const api = moduleLoad(routeFile, {
    'next/server': { NextResponse: { json: response } },
    '@/lib/agent/session': mockedSession,
    '@/lib/agent/alert-preferences': mockAlertPreferences,
    '@/lib/agent/alert-owner-id': { exactAlertOwnerId },
    '@/lib/supabase-admin': { supabaseAdmin: supabase },
  })
  const settings = {
    checkEveryMinutes: 60, quietStart: 22, quietEnd: 7, topics: { travel: true },
    brief: { enabled: true, time: '06:10' },
  }
  const putReq = () => ({
    headers: new Headers(),
    json: async () => { parsedBodies++; return settings },
  } as any)
  const getReq = new Request('https://app.askgogo.in/api/agent/alert-preferences')

  actor = { telegramId: second, surface: 'web' }
  const getSecond = await api.GET(getReq)
  assert.equal(getSecond.status, 200)
  assert.deepEqual((await getSecond.json()).brief, { enabled: true, time: '11:30' })
  assert.equal(prefReads.at(-1), second)
  assert.equal(dbReads.at(-1), second)
  const putSecond = await api.PUT(putReq())
  assert.equal(putSecond.status, 200)
  assert.equal(prefWrites.at(-1), second, 'owner alert settings always save to own row')
  assert.deepEqual(dbWrites, [second], 'only second owner has been mutated')
  assert.deepEqual(userRows.get(first), { briefing_enabled: false, briefing_time: '07:00' }, 'unrelated owner unchanged')
  assert.deepEqual(userRows.get(second), { briefing_enabled: true, briefing_time: '06:10' })

  actor = { telegramId: first, surface: 'web' }
  const getFirst = await api.GET(getReq)
  assert.equal(getFirst.status, 200)
  assert.deepEqual((await getFirst.json()).brief, { enabled: false, time: '07:00' })
  assert.equal(dbReads.at(-1), first)
  actor = { telegramId: '-9223372036854775808', surface: 'web' }
  const negative = await api.GET(getReq)
  assert.equal(negative.status, 200)
  assert.equal((await negative.json()).brief.time, '06:10')

  const count = () => [dbReads.length, dbWrites.length, prefReads.length, prefWrites.length, parsedBodies]
  for (const value of [first, second, '9223372036854775808', '-9223372036854775809', '000123', '1.5', 'abc', '0']) {
    actor = { telegramId: value, surface: 'android' }
    // 123 is the only valid mobile fixture; all these are outside safe mobile actor range or invalid.
    const before = count()
    assert.equal((await api.GET(getReq)).status, 403, 'invalid/mobile owner GET must fail before DB')
    assert.equal((await api.PUT(putReq())).status, 403, 'invalid/mobile owner PUT must fail before parsing/write')
    assert.deepEqual(count(), before, 'invalid owner must not even parse request body or read/save settings')
  }
  actor = { telegramId: second, surface: 'web' }
  rejectOrigin = true
  const prior = count()
  assert.equal((await api.PUT(putReq())).status, 403, 'keep same-origin CSRF gate')
  assert.deepEqual(count(), prior)
  rejectOrigin = false
  actor = null
  assert.equal((await api.GET(getReq)).status, 401, 'no authenticated owner means no read')
  assert.equal((await api.PUT(putReq())).status, 401, 'no authenticated owner means no write')

  const jsx = (type: any, props: any) => ({ type, props })
  const page = moduleLoad(pageFile, {
    '@/lib/dashboard/session': { getSession: async () => pageActor },
    '@/lib/supabase-admin': { supabaseAdmin: supabase },
    '@/lib/agent/alert-preferences': mockAlertPreferences,
    '@/lib/agent/alert-owner-id': { exactAlertOwnerId },
    '@/components/dashboard/alert-settings': { AlertSettings: () => null },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol.for('react.fragment') },
  })
  pageActor = { telegramId: second }
  const pageBefore = count()
  await page.default()
  assert.equal(dbReads.at(-1), second, 'SSR must read precisely owner B, never alias owner A')
  assert.equal(prefReads.at(-1), second)
  assert.equal(dbReads.length, pageBefore[0] + 1)
  pageActor = { telegramId: '9223372036854775808' }
  const invalidPage = count()
  await page.default()
  assert.deepEqual(count(), invalidPage, 'invalid SSR owner must not query private settings')
  pageActor = null
  await page.default()
  assert.deepEqual(count(), invalidPage, 'logged-out SSR must not query private settings')
  console.log('PASS P1: actual agent alert GET/PUT and SSR use exact 64-bit session owners; mobile unsafe aliases, malformed sessions and blocked origins fail closed')
}
