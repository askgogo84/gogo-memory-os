import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const worker=readFileSync('lib/agent/life-event-worker.ts','utf8')
const execution=readFileSync('lib/agent/life-event-execution.ts','utf8')
const migration=readFileSync('supabase/migrations/20260921051000_brain_v1_1_schema_foundation.sql','utf8')

assert.match(migration,/outcome_unknown/)
assert.match(worker,/status: 'outcome_unknown'/)
assert.match(worker,/reconciliation_required:true/)
assert.match(execution,/status: 'outcome_unknown'/)
assert.match(execution,/reconciliationRequired:true/)
assert.match(execution,/will not retry automatically/)
assert.doesNotMatch(execution,/status: 'failed'[\s\S]{0,500}checkin_execution_uncertain/)

console.log('outcome_unknown check-in verification passed')
