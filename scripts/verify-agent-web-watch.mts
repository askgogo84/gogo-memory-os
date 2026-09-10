import assert from 'node:assert/strict'
import { parseWebWatchCommand } from '../lib/agent/watch-command'
import { normalizeWebSearchWatcher } from '../lib/agent/watchers'

const cases = [
  {
    text: 'Watch the web for Christopher Ward C63 Sealander availability in New York and tell me when something new appears',
    query: 'Christopher Ward C63 Sealander availability in New York',
  },
  {
    text: 'monitor online for CreditIQ accelerator applications',
    query: 'CreditIQ accelerator applications',
  },
  {
    text: 'watch Qatar startup program online',
    query: 'Qatar startup program',
  },
]

for (const c of cases) {
  const parsed = parseWebWatchCommand(c.text)
  assert.ok(parsed, `should parse: ${c.text}`)
  assert.equal(parsed.query, c.query)
  assert.equal(parsed.cadenceMinutes, 15)
  assert.equal(parsed.delivery, 'both')
}

assert.equal(parseWebWatchCommand('What is on my calendar?'), null)
assert.equal(parseWebWatchCommand('Watch a movie tonight'), null)
assert.equal(parseWebWatchCommand('monitor'), null)

const normalized = normalizeWebSearchWatcher({
  title:'  Watch watch availability  ',
  query:'  Christopher Ward   New York ',
  triggerKeywords:['stock','Stock','available',''],
  cadenceMinutes:2,
  delivery:'whatsapp',
})
assert.ok(normalized)
assert.equal(normalized.query, 'Christopher Ward New York')
assert.deepEqual(normalized.triggerKeywords, ['stock','available'])
assert.equal(normalized.cadenceMinutes, 15)
assert.equal(normalized.delivery, 'whatsapp')

const maxCadence = normalizeWebSearchWatcher({ title:'x', query:'y', cadenceMinutes:99999 })
assert.equal(maxCadence?.cadenceMinutes, 1440)
assert.equal(normalizeWebSearchWatcher({ title:'x', query:'' }), null)

console.log('✅ agent web watcher checks passed')
