import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shouldTreatMutationFailureAsUnknown } from '../lib/agent/outcome-reconciliation'

assert.equal(shouldTreatMutationFailureAsUnknown(undefined),true)
assert.equal(shouldTreatMutationFailureAsUnknown(null),true)
assert.equal(shouldTreatMutationFailureAsUnknown(500),true)
assert.equal(shouldTreatMutationFailureAsUnknown(503),true)
assert.equal(shouldTreatMutationFailureAsUnknown(408),true)
assert.equal(shouldTreatMutationFailureAsUnknown(429),true)
assert.equal(shouldTreatMutationFailureAsUnknown(400),false)
assert.equal(shouldTreatMutationFailureAsUnknown(401),false)
assert.equal(shouldTreatMutationFailureAsUnknown(409),false)

const calendar=readFileSync('lib/agent/booking-calendar-execution.ts','utf8')
assert.match(calendar,/reconcileGoogleCalendarEvent/)
assert.match(calendar,/status:'outcome_unknown'/)
assert.match(calendar,/will not create another event until I can verify/)
assert.match(calendar,/verified_absent/)
assert.match(calendar,/verified_completed/)
assert.match(calendar,/bookingCalendarEventId/)

console.log('Outcome reconciliation verification passed')
