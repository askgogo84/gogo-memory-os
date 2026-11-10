// Addendum 5 (Goal-to-Done), phase 1: ownership and "done" states, the Tasks › Overview board. Fixtures only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const o = await import('../lib/agent/task-ownership')
const g = await import('../lib/dashboard/goal-board')
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, e: unknown, m: string) => { assert.deepEqual(a, e, m); checks++ }
const NOW = new Date('2026-11-11T06:00:00Z'), at = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()
const run = (x: any) => ({ id: x.id || Math.random().toString(36).slice(2), type: 'general_multi_tool', title: 'Task', summary: '', status: 'completed', metadata_json: {}, started_at: at(2), updated_at: at(1), ...x })

// 1. States.
eq(o.doneStateOf(run({})), 'done_unverified', 'a finished run with no outside evidence is done, not checked')
{ const conf = (decision: string) => run({ metadata_json: { owner_confirmation: { decision, at: at(0.5), by: 'u', surface: 'dashboard' } } })
  eq([o.doneStateOf(conf('done')), o.doneEvidenceOf(conf('done'))?.by], ['verified', 'owner'], 'the owner marking it complete is outside evidence')
  eq([o.doneStateOf(conf('not_done')), o.ownershipOf(conf('not_done'))], ['blocked', 'your_turn'], 'sent back by the owner: their turn') }
const checked = (v: any) => run({ metadata_json: { verification: v } })
eq(o.doneStateOf(checked({ state: 'verified_completed', check: 'reminder_readback', at: at(0.5) })), 'verified', 'a code check that read the result back counts')
for (const [v, why] of [[{ state: 'verified_completed', check: 'claude_judge', at: at(0.5) }, 'a model as the checker'], [{ state: 'verified_completed', check: 'LLM review', at: at(0.5) }, 'an LLM as the checker'],
  [{ state: 'verified_completed', at: at(0.5) }, 'no named check'], [{ state: 'verified_completed', check: 'x', at: 'soon' }, 'no time'], [{ state: 'still_unknown', check: 'x', at: at(0.5) }, 'a check that did not confirm'], ['yes', 'a bare string']] as const)
  eq(o.doneStateOf(checked(v)), 'done_unverified', `not checked: ${why}`)
eq(o.doneStateOf(run({ metadata_json: { mode: 'draft' } })), 'draft', 'a draft is never done')
eq(o.doneStateOf(run({ type: 'gmail_draft' })), 'draft', 'a draft run type is a draft')
eq(o.doneStateOf(run({ metadata_json: { mode: 'draft', verification: { state: 'verified_completed', check: 'x', at: at(1) } } })), 'draft', 'even a checked draft is a draft')
eq(o.doneStateOf(run({ status: 'outcome_unknown' })), 'unknown', 'outcome unknown')
eq(o.doneStateOf(run({ status: 'completed', metadata_json: { outcome_status: 'unknown' } })), 'unknown', 'a completed wrapper over an unknown outcome is unknown')
eq(o.doneStateOf(run({ status: 'completed', metadata_json: { outcome_status: 'failed' } })), 'failed', 'a completed wrapper over a failure is a failure')
eq(o.doneStateOf(run({ status: 'outcome_unknown', error: 'user_cancelled' })), 'unknown', 'a cancel note never hides an unknown outcome')
eq([o.doneStateOf(run({ status: 'running' })), o.doneStateOf(run({ status: 'queued' })), o.doneStateOf(run({ status: 'watching' }))], ['running', 'queued', 'waiting_external'], 'running, starting, waiting')
eq(o.doneStateOf(run({ status: 'waiting_approval' })), 'waiting_approval', 'needs a yes')
eq(o.doneStateOf(run({ status: 'paused', metadata_json: { handoff: { takeoverUrl: 'x' } } })), 'blocked', 'stopped for a sign-in')
eq(o.doneStateOf(run({ status: 'failed', error: 'provider_access_limited' })), 'blocked', 'a site refused')
eq(o.doneStateOf(run({ status: 'failed', error: 'timeout' })), 'failed', 'a plain failure')
eq(o.doneStateOf(run({ status: 'failed', error: 'user_cancelled' })), 'cancelled', 'cancelled by the owner')

// 2. Ownership: responsibility only, and the most hands-on of plan and state.
eq(o.ownershipOf(run({ status: 'running' })), 'gogo_handles', 'Gogo is doing it')
eq(o.ownershipOf(run({ status: 'waiting_approval' })), 'together', 'waiting for a yes')
eq(o.ownershipOf(run({ metadata_json: { mode: 'draft' } })), 'together', 'a draft to review')
eq(o.ownershipOf(run({ status: 'paused', metadata_json: { handoff: { takeoverUrl: 'x' } } })), 'your_turn', 'a sign-in only the owner can do')
eq(o.ownershipOf(run({ status: 'running', metadata_json: { ownership: 'your_turn' } })), 'your_turn', 'the plan said it is the owner’s, so it stays theirs')
eq(o.ownershipOf(run({ status: 'waiting_approval', metadata_json: { ownership: 'gogo_handles' } })), 'together', 'a plan cannot make an approval Gogo’s alone')
eq(o.ownershipOf(run({ status: 'running', metadata_json: { ownership: 'admin' } })), 'gogo_handles', 'an unknown label is ignored')
{ const src = readFileSync(new URL('../lib/agent/task-ownership.ts', import.meta.url), 'utf8')
  ok(!/policy|sentinel|adaptive-trust|permission|approve\(/i.test(src.replace(/^\/\/.*$/gm, '')), 'ownership code reads no permission and grants none')
  const users = ['lib/agent/policy.ts', 'lib/agent/sentinel.ts', 'lib/agent/adaptive-trust.ts'].map(f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))
  ok(users.every(u => !/task-ownership/.test(u)), 'and no permission code reads ownership') }

// 3. The board.
const runs = [
  run({ id: 'r1', status: 'running', title: 'Flight prices BLR to DEL', updated_at: at(0.1) }),
  run({ id: 'r2', status: 'waiting_approval', title: 'Email to Divya', metadata_json: { mode: 'draft' } }),
  run({ id: 'r3', status: 'paused', title: 'Sign in to Swiggy', metadata_json: { handoff: { takeoverUrl: 'x' } } }),
  run({ id: 'r4', title: 'Reminder', type: 'reminder', metadata_json: { verification: { state: 'verified_completed', check: 'reminder_readback', at: at(1) } } }),
  run({ id: 'r5', title: 'Research investors', type: 'research' }),
  run({ id: 'r6', status: 'failed', error: 'timeout', title: 'Train search' }),
  run({ id: 'r7', status: 'outcome_unknown', title: 'Calendar block' }),
  run({ id: 'r8', status: 'failed', error: 'user_cancelled', title: 'Cancelled thing' }),
  run({ id: 'r9', status: 'completed', title: 'Old', updated_at: at(24 * 40), started_at: at(24 * 40) }),
  run({ id: 'r10', status: 'running', title: 'Lost worker', updated_at: at(20) }),
  run({ id: 'r11', status: 'running', type: 'secure_browser', title: 'Store page', metadata_json: { comparison_parent_id: 'p' } }),
  run({ id: 'r1', status: 'running', title: 'duplicate row of r1' }),
]
const b = g.buildGoalBoard({ runs, approvals: [{ id: 'a1', run_id: 'r2', title: 'dup' }, { id: 'a2', run_id: null, title: 'Book table at Toit', created_at: at(1) }], todos: [{ createdAt: at(5) }, { createdAt: at(24 * 60) }], now: NOW })
eq(b.groups.gogo_handles.map(i => i.id), ['r1'], 'Gogo handles: what it is doing now')
eq(b.groups.together.map(i => i.id).sort(), ['ap-a2', 'r2', 'r7'].sort(), 'together: the draft, the unknown outcome, the approval with no run shown; an approval for a shown run is not repeated')
eq(b.groups.your_turn.map(i => i.id), ['r3'], 'your turn: the sign-in')
eq(b.done.map(i => i.id), ['r4', 'r5'], 'finished in 30 days, checked first; the failure, the old run and the cancel are not listed')
ok(!JSON.stringify(b).includes('r11') && !JSON.stringify(b).includes('duplicate row'), 'a child read and a repeated row are not tasks of their own')
ok(!b.groups.gogo_handles.some(i => i.id === 'r10'), 'a run stuck for hours is not shown as working')
eq(b.metrics.doneChecked, 1, 'done and checked counts only outside evidence')
eq([b.metrics.worked, b.metrics.failed, b.metrics.unknown], [2, 2, 1], 'two worked, two failed (one lost its worker), one unknown left out of both')
eq(b.metrics.minutesSaved, g.TIME_SAVED_MINUTES.reminder + g.TIME_SAVED_MINUTES.research, 'time saved: the fixed minutes for each finished run, never the draft')
eq(b.metrics.needYou, 4, 'needs you: draft, sign-in, unknown, the approval with no run')
eq(b.metrics.ownTodos, 1, 'own to-dos in the last 30 days')
ok(b.metrics.handedToGogo >= 7, 'tasks Gogo took on')
eq(g.minutesLabel(0), 'none yet', 'no savings shown as none'); eq(g.minutesLabel(17), 'about 15 min', 'minutes'); eq(g.minutesLabel(185), 'about 3 h', 'hours')
eq(g.minutesSavedFor({ type: 'travel_research' }), 20, 'kind picked from the run type'); eq(g.minutesSavedFor({ type: 'zzz' }), g.TIME_SAVED_DEFAULT, 'unknown kind: default')

// 4. The flag and the loader.
eq([g.goalBoardEnabledFor('918884501501', {}), g.goalBoardEnabledFor('918884501501', { GOGO_TASKS_OWNERSHIP: 'on' }), g.goalBoardEnabledFor('918884501501', { GOGO_TASKS_OWNERSHIP: '8884501501' }),
  g.goalBoardEnabledFor('918884501501', { GOGO_TASKS_OWNERSHIP: '8310441698' }), g.goalBoardEnabledFor('', { GOGO_TASKS_OWNERSHIP: '' })], [false, true, true, false, false], 'off by default; on for everyone or for listed owners')
const calls: any[] = []
const fake = (rows: Record<string, any>) => ({ from: (t: string) => { const q: any = { f: [] as any[] }; const chain = new Proxy(q, { get: (_x, k: string) => k === 'then' ? (res: any) => res(rows[t + ':' + (q.f.find((f: any) => f[0] === 'in')?.[2]?.[0] || '')] || rows[t] || { data: [] }) : (...a: any[]) => { q.f.push([k, ...a]); calls.push([t, k, ...a]); return chain } }); return chain } })
const lb = await g.getGoalBoard('918884501501', [], NOW, fake({ 'agent_runs:queued': { data: [run({ id: 'x1', status: 'running' })] }, 'agent_runs:completed': { data: [run({ id: 'x2' })] }, agent_approvals: { data: [] } }))
eq([lb.groups.gogo_handles.map(i => i.id), lb.done.map(i => i.id), lb.unavailable], [['x1'], ['x2'], false], 'the loader reads open and recent runs and approvals')
ok(calls.filter(c => c[1] === 'eq' && c[2] === 'telegram_id').every(c => c[3] === '918884501501'), 'every read is scoped to the exact owner id, as text')
eq((await g.getGoalBoard('9'.repeat(25), [], NOW, fake({}))), g.EMPTY_BOARD, 'an owner id that is not exact reads nothing')
eq((await g.getGoalBoard('918884501501', [], NOW, fake({ agent_approvals: { data: null, error: { message: 'x' } } }))).unavailable, true, 'a failed read says the board may be incomplete')

// 5. The page: off means unchanged.
const page = readFileSync(new URL('../app/dashboard/(app)/tasks/page.tsx', import.meta.url), 'utf8')
ok(/const overview = Boolean\(session\) && goalBoardEnabledFor\(String\(tg\)\)/.test(page) && /const tabs = overview \? \['overview', 'need', 'radar', 'recent', 'todos'\] : \['need', 'radar', 'recent', 'todos'\]/.test(page), 'without the flag the tabs and default are what they were')
ok(/lead=\{overview \? \{ key: 'overview', label: 'Overview' \} : undefined\}/.test(page) && /overview && tab === 'overview' \? await getGoalBoard/.test(page), 'the board is only read when the tab is shown')
console.log(`GOAL_BOARD_OK ${checks} checks`)
