import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isAdaptiveTrustQuery } from '../lib/agent/adaptive-trust'

assert.equal(isAdaptiveTrustQuery('What should you do automatically?'),true)
assert.equal(isAdaptiveTrustQuery('What can you learn from my approvals?'),true)
assert.equal(isAdaptiveTrustQuery('Show me autonomy suggestions'),true)
assert.equal(isAdaptiveTrustQuery('Where can you be more autonomous?'),true)
assert.equal(isAdaptiveTrustQuery('What can you stop asking me about?'),true)
assert.equal(isAdaptiveTrustQuery('Book my flight'),false)

const trust=readFileSync(new URL('../lib/agent/adaptive-trust.ts',import.meta.url),'utf8')
assert.match(trust,/\.range\(from,from\+pageSize-1\)/)
assert.match(trust,/execution_payload/)
assert.match(trust,/current==='off'/)
assert.match(trust,/s\.lowRiskSuccess>=5&&cleanHistory&&s\.highRiskSuccess===0/)
assert.match(trust,/Patterns I’m learning/)
assert.match(trust,/I will never change these automatically/)
assert.match(trust,/Hard safety still overrides auto/)

const feature=readFileSync(new URL('../lib/feature-intents.ts',import.meta.url),'utf8')
const trustPos=feature.indexOf('isAdaptiveTrustQuery(text)')
const reminderPos=feature.indexOf('normalizeNaturalReminderSave(text)')
assert.ok(trustPos>=0&&reminderPos>=0&&trustPos<reminderPos,'trust queries must route before capability specialists')

console.log('adaptive trust v2 safety and routing checks passed')
