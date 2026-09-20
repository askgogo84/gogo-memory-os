import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseExpiryReminderPlan, parseListReminderPlan } from '../lib/agent/compound-planner'

const expiryCases = [
  ['find my passport and remind me six months before it expires', { target:'passport', amount:6, unit:'month' }],
  ['Find my driving licence and remind me 30 days before expiry', { target:'driving licence', amount:30, unit:'day' }],
  ['find passport then remind me two weeks before expiration', { target:'passport', amount:2, unit:'week' }],
  ['find my passport', null],
  ['remind me six months before my passport expires', null],
] as const

for (const [text, expected] of expiryCases) {
  const actual = parseExpiryReminderPlan(text)
  if (expected === null) assert.equal(actual, null, text)
  else assert.deepEqual(actual, expected, text)
  console.log(`✓ ${text}`)
}

assert.deepEqual(
  parseListReminderPlan('create a list called Weekend Bag with charger, passport and remind me tomorrow at 8 pm to pack'),
  { listName:'Weekend Bag', items:['charger','passport'], reminderCommand:'remind me tomorrow at 8 pm to pack' },
)
assert.deepEqual(
  parseListReminderPlan('make list named Groceries with milk, eggs, bread then remind me tonight to order groceries'),
  { listName:'Groceries', items:['milk','eggs','bread'], reminderCommand:'remind me tonight to order groceries' },
)
assert.equal(parseListReminderPlan('create a list called Weekend Bag with charger and passport'), null)

const source=fs.readFileSync('lib/agent/compound-planner.ts','utf8')
assert.match(source,/function isReminderReadQuery\(/)
assert.match(source,/parseExplicitListRead\(/)
assert.match(source,/\.eq\('sent', false\)/)
assert.match(source,/readOnly: true, mutated: false/)
const readOnly=source.indexOf('const readOnly = await tryRunReadOnlyCoreQuery(params)')
const listReminder=source.indexOf('const listReminder = await tryRunListReminderPlan(params)')
const expiry=source.indexOf('const plan = parseExpiryReminderPlan(params.text)', listReminder)
assert.ok(readOnly>=0 && listReminder>readOnly && expiry>listReminder, 'read-only and compound list/reminder routing must run before legacy expiry routing')

console.log(`✅ compound agent planner: ${expiryCases.length + 8} safety checks passed`)
