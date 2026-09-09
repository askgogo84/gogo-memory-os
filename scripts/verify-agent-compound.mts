import assert from 'node:assert/strict'
import { parseExpiryReminderPlan } from '../lib/agent/compound-planner'

const cases = [
  ['find my passport and remind me six months before it expires', { target:'passport', amount:6, unit:'month' }],
  ['Find my driving licence and remind me 30 days before expiry', { target:'driving licence', amount:30, unit:'day' }],
  ['find passport then remind me two weeks before expiration', { target:'passport', amount:2, unit:'week' }],
  ['find my passport', null],
  ['remind me six months before my passport expires', null],
] as const

for (const [text, expected] of cases) {
  const actual = parseExpiryReminderPlan(text)
  if (expected === null) assert.equal(actual, null, text)
  else assert.deepEqual(actual, expected, text)
  console.log(`✓ ${text}`)
}

console.log(`✅ compound agent planner: ${cases.length} checks passed`)
