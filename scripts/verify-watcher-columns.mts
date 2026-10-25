// 23 Oct live: Home and Tasks said "Nothing is running in the background" with four active watches, because the
// feed selected agent_watchers.title — a column that does not exist (PostgREST error → empty list).
// Every agent_watchers select in the app must name real columns (production schema, read 23 Oct).
// Run: npx tsx scripts/verify-watcher-columns.mts
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const COLUMNS = new Set(['id', 'telegram_id', 'goal_id', 'run_id', 'type', 'condition_json', 'cadence_minutes', 'active', 'last_checked_at', 'last_state_json', 'next_check_at', 'created_at', 'updated_at'])
const files = execSync('git ls-files "lib/**/*.ts" "app/**/*.ts" "app/**/*.tsx"', { encoding: 'utf8' }).split('\n').filter(Boolean)
const bad: string[] = []
let checked = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/from\('agent_watchers'\)\s*\.select\('([^']*)'/g)) {
    checked++
    for (const col of m[1].split(',').map(c => c.trim().split(/[:\s]/)[0]).filter(Boolean)) if (col !== '*' && !COLUMNS.has(col)) bad.push(`${f}: ${col}`)
  }
}
assert.deepEqual(bad, [], 'agent_watchers selects name only real columns')
assert.ok(checked >= 10, `found the watcher selects (${checked})`)
console.log(`verify-watcher-columns: ok (${checked} selects)`)
