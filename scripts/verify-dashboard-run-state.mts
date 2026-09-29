import assert from 'node:assert/strict'
import { summarizeActiveRunState } from '../lib/dashboard/run-state'

// Production incident: a Blinkit run that ended blocked (status 'paused') still showed
// "Working" on the dashboard. Paused / waiting_approval runs are waiting on the user,
// not working; only running / queued runs are actively working.

assert.deepEqual(summarizeActiveRunState([{ status: 'running' }]).label, 'Working')
assert.deepEqual(summarizeActiveRunState([{ status: 'queued' }]).label, 'Working')

// The exact incident: a paused (provider-blocked) run must read as waiting, not working.
const blocked = summarizeActiveRunState([{ status: 'paused' }])
assert.equal(blocked.label, 'Waiting for you')
assert.equal(blocked.tone, 'waiting')
assert.equal(blocked.working, 0)

assert.equal(summarizeActiveRunState([{ status: 'waiting_approval' }]).label, 'Waiting for you')

// Terminal states are neither working nor waiting.
assert.equal(summarizeActiveRunState([{ status: 'completed' }]).label, 'Ready')
assert.equal(summarizeActiveRunState([{ status: 'failed' }]).label, 'Ready')
assert.equal(summarizeActiveRunState([]).label, 'Ready')
assert.equal(summarizeActiveRunState(null).label, 'Ready')

// A genuinely-running run wins over a paused one (Gogo is actively doing something).
const mixed = summarizeActiveRunState([{ status: 'paused' }, { status: 'running' }])
assert.equal(mixed.label, 'Working')
assert.equal(mixed.working, 1)
assert.equal(mixed.waiting, 1)

console.log('✅ dashboard run-state indicator: paused/blocked runs read as waiting, not working')
