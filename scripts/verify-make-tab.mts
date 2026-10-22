// Duet parity step 3: Make — finished work Gogo produced, owner-scoped, filtered by kind.
// Run: npx tsx scripts/verify-make-tab.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://state-fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only'
const rows = [
  { id: 'a1', type: 'research_brief', title: 'Co-working near Rajajinagar', subtitle: '6 sources', updated_at: '2026-10-22T05:00:00Z' },
  { id: 'a2', type: 'comparison', title: 'iPhone 17 256GB', subtitle: '4 stores', updated_at: '2026-10-21T05:00:00Z' },
  { id: 'a3', type: 'trip', title: 'Goa trip', subtitle: '', updated_at: '2026-10-20T05:00:00Z' },
  { id: 'a4', type: 'goal_plan', title: 'Walk 8000 steps', subtitle: '', updated_at: '2026-10-19T05:00:00Z' },
]
let fail = false
const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: any) => {
  const url = new URL(String(input))
  assert.equal(url.origin, 'https://state-fixture.supabase.co')
  assert.equal(url.pathname.split('/').at(-1), 'agent_artifacts')
  assert.equal(url.searchParams.get('telegram_id'), 'eq.123', 'owner-scoped')
  if (fail) return new Response(JSON.stringify({ message: 'boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } })
}) as any
try {
  const m = await import('../lib/dashboard/make')
  const all = await m.getMadeForYou('123')
  assert.equal(all.items.length, 4); assert.deepEqual(all.counts, { all: 4, briefs: 1, comparisons: 1, plans: 2, trackers: 0 })
  assert.equal(all.items[0].href, '/dashboard/reports/a1'); assert.equal(all.items[0].label, 'Brief')
  const plans = await m.getMadeForYou('123', 'plans')
  assert.deepEqual(plans.items.map(i => i.id), ['a3', 'a4'])
  assert.equal(m.makeKind('nope'), 'all'); assert.equal(m.makeKind('comparisons'), 'comparisons')
  assert.deepEqual((await m.getMadeForYou('')).items, [])
  fail = true
  const broken = await m.getMadeForYou('123')
  assert.equal(broken.ok, false, 'a read failure is reported, not shown as empty')
  const nav = readFileSync('components/dashboard/dashboard-nav.tsx', 'utf8')
  assert.match(nav, /href:'\/dashboard\/make', label:'Make'/)
  const live = readFileSync('components/dashboard/gogo-live.tsx', 'utf8')
  assert.match(live, /href: `\/dashboard\/reports\/\$\{encodeURIComponent\(String\(a\.id\)\)\}`/, 'panel Files open the result itself')
  const page = readFileSync('app/dashboard/(app)/make/page.tsx', 'utf8')
  assert.match(page, /getMadeForYou\(String\(session\?\.telegramId \|\| ''\), kind\)/)
  console.log('Make tab: owner-scoped finished work, kind filters with counts, honest read failure, panel links open results')
} finally { globalThis.fetch = originalFetch }
