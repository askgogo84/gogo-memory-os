import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync('lib/agent/life-event-execution.ts','utf8')

assert.match(source,/finalSubmitSucceeded\s*&&\s*terminalConfirmation/,'check-in completion must still require a successful final submit plus confirmation evidence')
assert.doesNotMatch(source,/boarding pass \(\?:is \)\?\(\?:ready\|available\|issued\|generated\)/,'generic boarding-pass ready/available copy must not be accepted as terminal check-in proof')
assert.match(source,/check\[- \]\?in confirmation/,'confirmation-specific check-in evidence must remain accepted')
assert.match(source,/you\(\?:'\|’\)re checked in|you are checked in|checked in successfully/,'explicit checked-in confirmation must remain accepted')
assert.match(source,/checkin_confirmation_not_verified/,'unverified execution must remain paused/blocked rather than completed')
assert.match(source,/checkin_execution_uncertain/,'lost execution evidence must remain non-retriable/uncertain')

console.log('✅ Check-in terminal-evidence safety regression passed')
