import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readableRunSummary } from '../lib/dashboard/readable-summary'
import { lifecycleMonitorExpired } from '../lib/agent/life-event-integrations'
// 15 Oct live run in Chrome after #555. Run: npx tsx scripts/verify-live-usecases-oct15b.mts
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

// 1. Saved summaries from before the flight-time fix read as clock times, and zoned instants show India time.
assert.equal(readableRunSummary('₹15,766 · IndiGo · 2026-11-20T10:20:00 → 2026-11-20T17:40:00 · non-stop'), '₹15,766 · IndiGo · 10:20 am → 5:40 pm · non-stop')
assert.equal(readableRunSummary('x 2026-11-20T20:10:00 → 2026-11-21T06:35:00 y'), 'x 8:10 pm → 6:35 am (+1) y')
assert.equal(readableRunSummary('checked 2026-10-15T03:42:52.287Z'), 'checked 15 Oct, 9:12 am')
assert.equal(readableRunSummary('departs 2026-11-20T10:20'), 'departs 20 Nov, 10:20 am')
assert.equal(readableRunSummary(null), '')
assert.equal(readableRunSummary('No dates here.'), 'No dates here.')

// 2. A flight watched two days after landing has nothing left to watch.
const now = new Date('2026-10-15T04:30:00Z')
assert.equal(lifecycleMonitorExpired({ event_type: 'travel', start_at: '2026-10-13T08:05:00Z', end_at: '2026-10-13T17:40:00Z' }, now), true)
assert.equal(lifecycleMonitorExpired({ event_type: 'travel', start_at: '2026-10-13T08:05:00Z' }, now), true, 'no end saved: 36h after departure')
assert.equal(lifecycleMonitorExpired({ event_type: 'travel', start_at: '2026-10-14T20:00:00Z' }, now), false, 'a long flight still in the air is still watched')
assert.equal(lifecycleMonitorExpired({ event_type: 'travel', start_at: '2026-11-20T04:50:00Z' }, now), false)
assert.equal(lifecycleMonitorExpired({ event_type: 'delivery', start_at: '2026-09-01T00:00:00Z' }, now), false, 'deliveries end on their own status')
assert.equal(lifecycleMonitorExpired({ event_type: 'travel' }, now), false, 'no dates: keep watching')
const worker = read('lib/agent/life-event-integration-worker.ts')
assert.match(worker, /if \(!resumeRunId && lifecycleMonitorExpired\(event\)\) \{\n\s+await complete\(action, \{ monitorState: 'event_over' \}\)/)

// 3. Runs stuck in running for hours are not "now" work, and the minute cron closes them.
const stale = read('lib/agent/stale-runs.ts')
assert.match(stale, /STALE_RUNNING_HOURS = 12/)
assert.match(stale, /\.eq\('status', 'running'\)\s*\n\s*\.lt\('updated_at', staleRunningCutoff\(\)\)/)
const cron = read('app/api/cron/autonomous-runs/route.ts')
assert.match(cron, /const staleRunsClosed=await sweepStaleRunningRuns\(\)/)
const home = read('app/dashboard/(app)/home/page.tsx')
const feed = read('lib/dashboard/task-feed.ts')
assert.match(feed, /\.filter\(\(r: any\) => !isStaleRunning\(r, now\) && !retiredRunReason\(r\)\)/)

// 4. One site that stopped four times is one thing to do, on Home, the menu badge and Needs you.
assert.match(feed, /Stopped here \$\{count\} times/)
assert.match(read('components/dashboard/gogo-live.tsx'), /new Map\(handoffs\.map\(\(h: any\) => \[String\(h\?\.title \|\| h\?\.id\), h\]\)\)/)
const agent = read('app/dashboard/(app)/agent/page.tsx')
assert.match(agent, /needsYou:\(snapshot\?\.approvals\?\.length\|\|0\)\+handoffGroups\.length/)
assert.match(agent, /earlier stop\{earlier\.length===1\?'':'s'\} on this site/)

// 4b. "Waiting for you" on Today is the Needs you count, not every old paused run (it said 25 while Needs you said 1).
assert.match(home, /const nowCount=sections\.now\.length\+serviceNotices\.total/)
assert.doesNotMatch(home+feed, /pausedRunsRes|actionablePaused/)

// 5. Cancelled reminders are not part of today.
assert.match(home, /filter\(\(r:any\)=>r\.status!=='cancelled'&&r\.delivery_state!=='cancelled'\)/)

// 6. Activity never shows a raw error code as the task line, and summaries read as clock times.
const activity = read('app/dashboard/(app)/activity/page.tsx')
assert.match(activity, /function runSubline\(run:DashboardActivityRun\)\{return readableRunSummary\(rawRunSubline\(run\)\)\}/)
assert.match(activity, /run\.error&&!\/\^\[a-z0-9_:\.-\]\+\$\/\.test\(run\.error\)/)

// 7. Stopping a watch that does not exist lists what is running, in plain words.
const watch = read('lib/agent/watch-command.ts')
assert.doesNotMatch(watch, /in persistent watcher state\.'.*handledBy:'watcher-stop'/)
assert.match(watch, /You don't have a watch for \$\{typedWatchName\(params\.text\)\|\|'that'\}\. Your active watches:/)
// 8. Steps of a closed stuck run stop too, and the task page never says a step of an ended task is still working.
assert.match(stale, /\.in\('run_id', ids\)\.in\('status', \['running', 'queued'\]\)/)
const runPage = read('app/dashboard/(app)/activity/[runId]/page.tsx')
assert.match(runPage, /const runOver=\['completed','failed','closed','cancelled'\]\.includes/)
assert.match(runPage, /\{stopped\?'Stopped when the task ended\.':/)

// 9. A trip's flight-status watch ends 6 hours after the last leg lands, not with the 72-hour trip context.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { flightStatusExpiry } = await import('../lib/agent/contextual-travel-watchers')
assert.equal(flightStatusExpiry([{ arrive_at: '2026-10-13T17:40:00Z' }] as any, '2026-10-16T17:40:00.000Z'), '2026-10-13T23:40:00.000Z')
assert.equal(flightStatusExpiry([] as any, '2026-10-16T17:40:00.000Z'), '2026-10-16T17:40:00.000Z')
assert.match(read('lib/agent/contextual-travel-watchers.ts'), /expiresAt:flightStatusExpiry\(rows,expiresAt\),/)
console.log('verify-live-usecases-oct15b: ok')
