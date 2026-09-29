import assert from 'node:assert/strict'
import { summarizeActiveRunState } from '../lib/dashboard/run-state'

// Production incident: a Blinkit run that ended blocked (status 'paused') still showed
// "Working" on the dashboard. Paused / waiting_approval runs are waiting on the user,
// not working; only running / queued runs are actively working.

assert.deepEqual(summarizeActiveRunState([{ status: 'running' }]).label, 'Working')
assert.deepEqual(summarizeActiveRunState([{ status: 'queued' }]).label, 'Working')

// The exact incident: a paused (provider-blocked) run must NOT read as "Working".
// A bare/rejected paused run is neither Working nor a standing "Waiting for you" prompt.
const blocked = summarizeActiveRunState([{ status: 'paused' }])
assert.notEqual(blocked.label, 'Working')
assert.equal(blocked.working, 0)
assert.equal(blocked.waiting, 0)

// A rejected-approval paused run must NOT linger as "Waiting for you".
assert.equal(summarizeActiveRunState([{ status: 'paused', error: 'approval_rejected' }]).label, 'Ready')

// An explicit approval wait is the one unambiguous "waiting on the user" state.
assert.equal(summarizeActiveRunState([{ status: 'waiting_approval' }]).label, 'Waiting for you')

// A paused run stopped at a human-action boundary (sign-in / secure handoff) IS
// actionable and must read "Waiting for you", not "Ready".
assert.equal(summarizeActiveRunState([{ status: 'paused', error: 'human_auth_required' }]).label, 'Waiting for you')
assert.equal(summarizeActiveRunState([{ status: 'paused', metadata_json: { handoff: { releaseUrl: 'x' } } }]).label, 'Waiting for you')
// Secure-browser-waiting handoffs signal via metadata (error cleared) — still actionable.
assert.equal(summarizeActiveRunState([{ status: 'paused', error: null, metadata_json: { browser_waiting: true, auth_resume: { kind: 'flight_execute' } } }]).label, 'Waiting for you')

// Terminal states are neither working nor waiting.
assert.equal(summarizeActiveRunState([{ status: 'completed' }]).label, 'Ready')
assert.equal(summarizeActiveRunState([{ status: 'failed' }]).label, 'Ready')
assert.equal(summarizeActiveRunState([]).label, 'Ready')
assert.equal(summarizeActiveRunState(null).label, 'Ready')

// A genuinely-running run reads as Working even alongside a paused one.
const mixed = summarizeActiveRunState([{ status: 'paused' }, { status: 'running' }])
assert.equal(mixed.label, 'Working')
assert.equal(mixed.working, 1)

// A running run must win over more-recent waiting_approval rows (home must not report
// "Waiting" while execution is active).
const runningPlusApprovals = summarizeActiveRunState([
  { status: 'waiting_approval' }, { status: 'waiting_approval' }, { status: 'running' },
])
assert.equal(runningPlusApprovals.label, 'Working')

console.log('✅ dashboard run-state indicator: paused/blocked runs read as waiting, not working')
