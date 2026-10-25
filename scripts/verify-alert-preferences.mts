// Duet parity step 2: what you hear about and how often — frequency, topics, quiet hours.
// Run: npx tsx scripts/verify-alert-preferences.mts
import assert from 'node:assert/strict'
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
