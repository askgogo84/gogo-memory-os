// Duet parity: only the owner marks a task complete; watches say why and when they end (R02).
// Run: npx tsx scripts/verify-owner-confirmation.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://state-fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only'

const runs: Record<string, any> = {
  'aaaaaaaa-0000-4000-8000-000000000001': { id: 'aaaaaaaa-0000-4000-8000-000000000001', telegram_id: '123', title: 'Goa trip plan', status: 'completed', type: 'general_multi_tool', metadata_json: { plan_type: 'general_multi_tool' } },
  'aaaaaaaa-0000-4000-8000-000000000002': { id: 'aaaaaaaa-0000-4000-8000-000000000002', telegram_id: '123', title: 'Still running', status: 'running', type: 'general_multi_tool', metadata_json: {} },
}
const activity: any[] = []
const patches: any[] = []
let dropNextWrite = false
const originalFetch = globalThis.fetch
const response = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = (async (input: any, init: any) => {
  const url = new URL(String(input)), method = init?.method || 'GET'
  assert.equal(url.origin, 'https://state-fixture.supabase.co', 'no live service permitted')
  const table = url.pathname.split('/').at(-1)
  const body = init?.body ? JSON.parse(String(init.body)) : null
  if (table === 'agent_activity') { activity.push(body); return response(null, 201) }
  assert.equal(table, 'agent_runs')
  const owner = url.searchParams.get('telegram_id')?.replace('eq.', '')
  const id = url.searchParams.get('id')?.replace('eq.', '') || ''
  const row = runs[id]
  if (method === 'GET') return response(row && row.telegram_id === owner ? row : null)
  assert.equal(method, 'PATCH')
  assert.equal(url.searchParams.get('status'), 'eq.completed', 'only a finished run is confirmed')
  assert.equal(owner, row?.telegram_id, 'owner-scoped write')
  if (dropNextWrite) { dropNextWrite = false; return response([]) }
  patches.push(body); Object.assign(row, body)
  return response([{ id: row.id }])
}) as any

try {
  const oc = await import('../lib/agent/owner-confirmation')
  const now = Date.parse('2026-10-22T09:00:00Z')

  // Which finished tasks ask the owner.
  const base = { status: 'completed', type: 'travel_research', updated_at: '2026-10-21T10:00:00Z', metadata_json: {} }
  assert.equal(oc.needsOwnerConfirmation(base, now), true)
  assert.equal(oc.needsOwnerConfirmation({ ...base, type: 'watcher' }, now), false, 'background checks never ask')
  assert.equal(oc.needsOwnerConfirmation({ ...base, type: 'web_search' }, now), false, 'chat reads never ask')
  assert.equal(oc.needsOwnerConfirmation({ ...base, status: 'failed' }, now), false)
  assert.equal(oc.needsOwnerConfirmation({ ...base, updated_at: '2026-10-01T10:00:00Z' }, now), false, 'older than the window')
  assert.equal(oc.needsOwnerConfirmation({ ...base, metadata_json: { owner_confirmation: { decision: 'done' } } }, now), false, 'decided once')
  assert.equal(oc.ownerReopened({ metadata_json: { owner_confirmation: { decision: 'not_done' } } }), true)

  assert.deepEqual(oc.parseOwnerDecision({ decision: 'done' }), { decision: 'done', note: '' })
  assert.equal(oc.parseOwnerDecision({ decision: 'cancel' }), null)
  assert.equal(oc.parseOwnerDecision(null), null)
  assert.match(oc.continuePrompt('Goa trip plan'), /^Not done yet: Goa trip plan\. What's missing is $/)

  // Owner-scoped write + audit row; never changes status.
  const id = 'aaaaaaaa-0000-4000-8000-000000000001'
  const r1 = await oc.recordOwnerDecision({ telegramId: '123', runId: id, actorId: 'user-1', decision: 'done' })
  assert.equal(r1.ok, true)
  assert.equal(runs[id].status, 'completed')
  assert.equal(runs[id].metadata_json.owner_confirmation.decision, 'done')
  assert.equal(runs[id].metadata_json.plan_type, 'general_multi_tool', 'existing metadata kept')
  assert.equal(activity.at(-1).event_type, 'task_owner_confirmed')
  assert.equal(activity.at(-1).metadata_json.by, 'user-1')
  const r2 = await oc.recordOwnerDecision({ telegramId: '123', runId: id, actorId: 'user-1', decision: 'done' })
  assert.equal((r2 as any).unchanged, true, 'repeat tap writes nothing')
  assert.equal(patches.length, 1)
  const r3 = await oc.recordOwnerDecision({ telegramId: '123', runId: id, actorId: 'user-1', decision: 'not_done' })
  assert.equal(r3.ok, true); assert.equal(activity.at(-1).event_type, 'task_owner_reopened'); assert.equal(activity.at(-1).metadata_json.previous, 'done')
  assert.deepEqual(await oc.recordOwnerDecision({ telegramId: '999', runId: id, actorId: 'x', decision: 'done' }), { ok: false, error: 'not_found' }, 'another owner cannot confirm')
  assert.deepEqual(await oc.recordOwnerDecision({ telegramId: '123', runId: 'aaaaaaaa-0000-4000-8000-000000000002', actorId: 'user-1', decision: 'done' }), { ok: false, error: 'not_finished' })

  // Watches: why and when they end; R02's 27 Sep flight watch reads as passed on 22 Oct.
  const today = new Date(now)
  assert.equal(oc.watchEnds({ title: 'Watch: AT 9 flight status to New York on 27th September', condition_json: {} }, today).datePassed, true)
  assert.match(oc.watchEnds({ title: 'Watch: AT 9 flight status to New York on 27th September', condition_json: {} }, today).label, /\(27 Sept?\) has passed/)
  assert.equal(oc.watchEnds({ title: 'BLR to Goa fares on 14 Nov', condition_json: {} }, today).datePassed, false)
  assert.equal(oc.watchEnds({ title: 'Gold below 13000', condition_json: {} }, today).label, 'Until you stop it')
  assert.match(oc.watchEnds({ title: 'x', condition_json: { expiresAt: '2026-11-15T00:00:00Z' } }, today).label, /^Ends 15 Nov/)
  assert.equal(oc.watchEnds({ title: 'x', condition_json: { expiresAt: '2026-10-01T00:00:00Z' } }, today).datePassed, true)
  assert.match(oc.watchWhy({ created_at: '2026-10-20T06:00:00Z', condition_json: {} }), /^You asked on 20 Oct$/)
  assert.equal(oc.watchWhy({ condition_json: { reason: 'Your Goa trip on 14 Nov' } }), 'Your Goa trip on 14 Nov')
  assert.equal(oc.explicitDateIn('the 2026-09-27 flight', today)?.toISOString().slice(0, 10), '2026-09-27')
  assert.equal(oc.explicitDateIn('Feb 5', today)?.toISOString().slice(0, 10), '2026-02-05', 'a bare date more than 60 days ahead reads as the past one'); assert.equal(oc.explicitDateIn('Dec 5', today)?.toISOString().slice(0, 10), '2026-12-05')
  assert.equal(oc.explicitDateIn('Nov 14', today)?.toISOString().slice(0, 10), '2026-11-14')

  // A write that matched no row is never reported as saved.
  runs['aaaaaaaa-0000-4000-8000-000000000003'] = { id: 'aaaaaaaa-0000-4000-8000-000000000003', telegram_id: '123', title: 'Ghost', status: 'completed', type: 'booking', metadata_json: {} }
  dropNextWrite = true
  await assert.rejects(oc.recordOwnerDecision({ telegramId: '123', runId: 'aaaaaaaa-0000-4000-8000-000000000003', actorId: 'user-1', decision: 'done' }), /owner_confirmation_not_saved/)

  // Wiring: the feed asks for confirmation and the card posts to the owner-scoped route.
  const feed = readFileSync('lib/dashboard/task-feed.ts', 'utf8')
  assert.match(feed, /needsOwnerConfirmation\(r, now\.getTime\(\)\)/)
  assert.match(feed, /runIds: rows\.map\(x => String\(x\.id\)\)/, 'same-title tasks are one card')
  assert.match(feed, /watchEnds\(w, now\)/)
  const card = readFileSync('components/dashboard/confirm-done-card.tsx', 'utf8')
  assert.match(card, /for \(const id of confirm\.runIds\?\.length \? confirm\.runIds : \[confirm\.runId\]\)/)
  assert.match(card, /setTimeout\(\(\) => router\.refresh\(\), 1500\)/)
  assert.match(card, /\/api\/agent\/runs\/\$\{encodeURIComponent\(id\)\}\/confirm/)
  const route = readFileSync('app/api/agent/runs/[id]/confirm/route.ts', 'utf8')
  assert.match(route, /requireAgentMutationOrigin\(request\)/)
  assert.match(route, /telegramId: session\.telegramId/)
  console.log('Owner confirmation: only the owner completes or reopens a task, audited; watches show why and when they end')
} finally {
  globalThis.fetch = originalFetch
}
