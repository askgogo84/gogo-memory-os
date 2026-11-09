// G5: pause / resume a background watch. Pure patches, owner-scoped PATCH route, tolerant snapshot, Radar buttons.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isMissingColumnError, parseWatcherAction, pausePatch, resumePatch, watcherState } from '../lib/agent/watcher-pause'
let n = 0; const ok = (s: string) => { n++; console.log('PASS', s) }
const now = new Date('2026-11-09T12:00:00Z')
assert.deepEqual(pausePatch(now), { paused_at: now.toISOString(), next_check_at: null, updated_at: now.toISOString() })
assert.deepEqual(resumePatch(now), { paused_at: null, next_check_at: now.toISOString(), updated_at: now.toISOString() })
assert.equal(watcherState({ active: true, paused_at: null }), 'active'); assert.equal(watcherState({ active: true, paused_at: now.toISOString() }), 'paused'); assert.equal(watcherState({ active: false, paused_at: now.toISOString() }), 'stopped')
assert.equal(parseWatcherAction({ action: 'pause' }), 'pause'); assert.equal(parseWatcherAction({ action: 'delete' }), null); assert.equal(parseWatcherAction(null), null)
assert.equal(isMissingColumnError({ code: '42703' }), true); assert.equal(isMissingColumnError({ message: 'column agent_watchers.paused_at does not exist' }), true); assert.equal(isMissingColumnError({ code: '23505' }), false)
ok('pure: pause clears next_check_at (poller skips it), resume checks now; states; action parsing; migration detection')
const route = readFileSync('app/api/agent/watchers/[id]/route.ts', 'utf8')
assert.match(route, /export async function PATCH/); assert.match(route, /requireAgentMutationOrigin\(request\)[\s\S]*requireAgentSession\(request\)[\s\S]*\.eq\('telegram_id', session\.telegramId\)\.eq\('active', true\)/)
assert.match(route, /migration_required/); assert.match(route, /watcher_paused|watcher_resumed/)
const snap = readFileSync('app/api/agent/snapshot/route.ts', 'utf8'); assert.match(snap, /42703/); assert.match(snap, /state: w\.paused_at \? 'paused' : 'active'/)
const page = readFileSync('app/dashboard/(app)/agent/page.tsx', 'utf8'); assert.match(page, /pauseWatcher\(w\.id,w\.state==='paused'\?'resume':'pause'\)/); assert.match(page, /\{w\.state==='paused'\?'Resume':'Pause'\}/)
const mig = readFileSync('supabase/migrations/20261109190000_agent_watchers_paused_at.sql', 'utf8'); assert.match(mig, /add column if not exists paused_at timestamptz/)
assert.match(readFileSync('supabase/migrations/20261109190000_agent_watchers_paused_at.rollback.sql', 'utf8'), /drop column if exists paused_at/)
const w = readFileSync('lib/agent/watchers.ts', 'utf8'); assert.match(w, /\.eq\('active', true\)\s*\.lte\('next_check_at', now\.toISOString\(\)\)/, 'poller only takes rows with a due next_check_at, so a paused watch (null) is never polled')
ok('route owner-scoped with origin + session guards and 409 before migration; snapshot tolerant; Radar shows Pause/Resume; migration + rollback prepared')
console.log(`verify-watcher-pause-nov9: ${n} passed`)
