import assert from 'node:assert/strict'
import { classifyCheckVerb } from '../lib/data/lists-core'

// Permanent regression cases. Every past routing hijack gets a line here.
// "check X" is a list command only when X looks like a LIST ITEM.

// MUST NOT be claimed as a list command:
for (const text of [
  "check what's playing at pvr forum mall this weekend and get me the showtimes",
  'check when the next train to mysuru leaves',
  'check https://in.bookmyshow.com/explore/movies-bengaluru',
  'check the weather in bangalore',
  'check seat availability on the vande bharat',
  'check how much the flight to delhi costs',
  'check the score of the rcb match',
]) {
  assert.equal(classifyCheckVerb(text), null, `must not be a list command: ${text}`)
}

// MUST still be claimed - real list items:
for (const text of ['check milk', 'check passport', 'check power bank', 'tick eggs', 'mark sunscreen']) {
  assert.equal(classifyCheckVerb(text), 'list_check', `must be a list command: ${text}`)
}

// uncheck stays uncheck, prefix-anchored:
assert.equal(classifyCheckVerb('uncheck milk'), 'list_uncheck')
assert.equal(classifyCheckVerb('untick eggs'), 'list_uncheck')

console.log('list check-verb regression passed')
