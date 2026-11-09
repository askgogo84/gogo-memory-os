// Task-status unknown-outcome retention: synthetic, no real DB/provider/account effects.
// An unverified external effect is not resolved merely because its timestamp is old.
// This is a dedicated PR-only fixture, independent of the #1040 leased test runner.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-placeholder-only'
process.env.OPENAI_API_KEY ||= 'fixture-placeholder-only'
process.env.ANTHROPIC_API_KEY ||= 'fixture-placeholder-only'

const { isMatchableRun, matchRunByTitle, tryGetTaskStatus } =
  await import('../lib/agent/task-status.ts')

const now = new Date('2026-10-28T05:45:00.000Z')
const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()
const owner = '100101'
const stranger = '100102'
const unknown = {
  id: 'synthetic-uncertain-1',
  telegram_id: owner,
  title: 'Invoice approval task',
  status: 'outcome_unknown',
  updated_at: twoDaysAgo,
  summary: 'Provider outcome not verified; do not retry.',
  metadata_json: { outcome_state: 'unknown', reconciliation_required: true },
}

assert.equal(isMatchableRun(unknown, now), true,
  '48h-old unverified external outcome must remain matchable until verified')
assert.equal(matchRunByTitle([unknown], 'invoice approval task', now)?.run?.id, unknown.id,
  'named status lookup must still find an aged unverified effect')

// Keep genuine historical terminal items bounded and existing active states alive.
for (const status of ['queued', 'running', 'waiting_approval', 'paused', 'watching']) {
  assert.equal(isMatchableRun({ ...unknown, status }, now), true, status)
}
for (const status of ['completed', 'failed', 'cancelled']) {
  assert.equal(isMatchableRun({ ...unknown, status }, now), false,
    'terminal history must not become indefinitely matchable: ' + status)
}

let reads = 0
let stepReads = 0
const foreign = { ...unknown, id: 'synthetic-foreign-2', telegram_id: stranger, updated_at: now.toISOString() }
const result = await tryGetTaskStatus(
  { telegramId: owner },
  'What is the status of my invoice approval task?',
  {
    now: () => now,
    listRuns: async queriedOwner => {
      reads++
      assert.equal(queriedOwner, owner, 'query must preserve exact request owner')
      // Adversarial fake provider returns a foreign row; own actor filter must deny it.
      return [foreign, unknown]
    },
    listSteps: async (queriedOwner, runId) => {
      stepReads++
      assert.equal(queriedOwner, owner)
      assert.equal(runId, unknown.id)
      return []
    },
  },
)
assert.equal(reads, 1)
assert.equal(stepReads, 1)
assert.equal(result?.runId, unknown.id)
assert.equal(result?.handledBy, 'task-status')
assert.equal(result?.readOnly, true)
assert.equal(result?.mutated, false)
assert.match(String(result?.text || ''), /has an unconfirmed outcome/)
assert.match(String(result?.text || ''), /check with the provider before retrying/)
assert.doesNotMatch(String(result?.text || ''), /couldn't find a|is done|nothing left pending/i)

// Both actual matcher AND the production owner-scoped SQL status whitelist must retain it.
const source = readFileSync('lib/agent/task-status.ts', 'utf8')
const match = source.match(/const MATCHABLE_STATUSES\s*=\s*\[([^\]]+)\]/)
assert.ok(match, 'production status filter remains explicit')
assert.match(match[1], /['"]outcome_unknown['"]/,
  'defaultDeps SQL must fetch aged uncertain effects rather than recency-filter them')

console.log('PASS named-task outcome_unknown retention: aged uncertainty, owner isolation, terminal controls, no side effects')
