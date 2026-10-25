import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collapseRepeatedRuns } from '../lib/dashboard/activity-collapse'
// 15 Oct: Activity was flooded with the same "KLM KL0879 ... provider status page changed" row every few minutes.
// Run: npx tsx scripts/verify-activity-collapse.mts
const run = (id: string, at: string, over: Record<string, any> = {}) => ({ id, title: 'Gogo · KLM KL0879 Amsterdam → Bengaluru', status: 'completed', category: 'Browser', summary: 'The provider status page changed.', error: null, updatedAt: at, startedAt: at, ...over })
const rows = [
  run('a', '2026-10-15T10:00:00Z'),
  run('b', '2026-10-15T09:00:00Z'),
  run('x', '2026-10-15T08:30:00Z', { title: 'Read reminders', category: 'Reminders', summary: 'You have 3 reminders' }),
  run('c', '2026-10-15T08:00:00Z'),
  run('d', '2026-10-15T07:00:00Z', { summary: 'The page could not be loaded.' }),
  run('w', '2026-10-15T06:00:00Z', { status: 'waiting_approval' }),
  run('w2', '2026-10-15T05:00:00Z', { status: 'waiting_approval' }),
]
const out = collapseRepeatedRuns(rows)
assert.deepEqual(out.map(r => [r.id, r.repeats]), [['a', 3], ['x', 1], ['d', 1], ['w', 1], ['w2', 1]])
assert.equal(out[0].firstAt, '2026-10-15T08:00:00Z', 'first time is the earliest of the repeats')
assert.equal(out[0].updatedAt, '2026-10-15T10:00:00Z', 'the row keeps the newest run and links to it')
assert.equal(collapseRepeatedRuns([]).length, 0)
const page = readFileSync('app/dashboard/(app)/activity/page.tsx', 'utf8')
assert.ok(page.includes('collapseRepeatedRuns(list)') && page.includes('Ran {run.repeats} times'))
console.log('verify-activity-collapse: ok')
