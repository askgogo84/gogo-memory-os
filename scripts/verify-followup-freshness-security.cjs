// Security regression for the ORIGINAL production pending-followup freshness helper.
// No Supabase connection, sends, calendar changes, reminders, or user data.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync('lib/bot/handlers/followup-state.ts', 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'followup-state.ts',
}).outputText
const fixedNow = Date.parse('2026-11-05T08:00:00.000Z')
class FrozenDate extends Date { static now() { return fixedNow } }
const exports = {}
vm.runInNewContext(output, {
  exports,
  console,
  Date: FrozenDate,
  require(name) {
    assert.equal(name, '@/lib/supabase-admin', 'only inert database import permitted')
    return { supabaseAdmin: { from() { throw Error('unexpected database operation') } } }
  },
}, { filename: 'followup-state.original-handler.js', timeout: 1000 })

const fresh = exports.isFreshFollowupState
assert.equal(typeof fresh, 'function', 'original exported helper must execute')
let n = 0
function check(label, state, expected, maxMinutes) {
  assert.equal(fresh(state, maxMinutes), expected, label)
  console.log('PASS ' + label)
  n++
}
const at = delta => new Date(fixedNow + delta).toISOString()

// Pending reminder and calendar time answers must only use trusted recent state.
check('fresh 10-minute state', { created_at: at(-1_000) }, true)
check('fresh payload timestamp', { payload: { created_at: at(-90_000) } }, true)
check('boundary at 10 minutes', { created_at: at(-600_000) }, true)
check('expired by one millisecond', { created_at: at(-600_001) }, false)
check('old 30-day legacy state', { created_at: at(-30 * 86_400_000) }, false)
check('missing state', null, false)
check('legacy missing timestamps', { type: 'followup_state', kind: 'pending_calendar' }, false)
check('empty string timestamp', { created_at: '' }, false)
check('invalid timestamp', { created_at: 'not-a-date' }, false)
check('invalid primary timestamp is not overridden by payload', { created_at: 'broken', payload: { created_at: at(-2_000) } }, false)
check('bounded +59-second skew', { created_at: at(59_000) }, true)
check('more than 60-second future skew', { created_at: at(61_000) }, false)
check('years-future forged pending state', { created_at: '2099-01-01T00:00:00Z' }, false)
check('expired under one-minute TTL', { created_at: at(-61_000) }, false, 1)
check('positive TTL stays valid', { created_at: at(-50_000) }, true, 1)
check('negative TTL rejected', { created_at: at(-1_000) }, false, -1)
check('zero TTL rejected', { created_at: at(-1_000) }, false, 0)
check('NaN TTL rejected', { created_at: at(-1_000) }, false, Number.NaN)
check('Infinity TTL rejected', { created_at: at(-1_000) }, false, Infinity)

// Verify this is the actual guard consumed by both reminder and calendar completion paths.
const message = fs.readFileSync('lib/bot/process-message.ts', 'utf8')
const resolver = fs.readFileSync('lib/bot/pending-question-resolver.ts', 'utf8')
assert.match(message, /isFreshFollowupState\(pendingReminder\)/, 'reminder completion uses guard')
assert.match(message, /isFreshFollowupState\(pendingCalendar\)/, 'calendar completion uses guard')
assert.match(resolver, /isFreshFollowupState\(r\)/, 'legacy reminder resolver uses guard')
assert.match(resolver, /isFreshFollowupState\(c\)/, 'legacy calendar resolver uses guard')
console.log('PASS real reminder/calendar call sites use original guard')
console.log('followup-freshness security regression: ' + n + ' original-helper scenarios passed')
