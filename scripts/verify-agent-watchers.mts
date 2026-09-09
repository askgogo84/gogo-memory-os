import assert from 'node:assert/strict'
import { normalizeDeadlineWatcher } from '../lib/agent/watchers'

const valid = normalizeDeadlineWatcher({
  title: 'Accelerator deadline',
  deadline: '2026-09-20T18:00:00+05:30',
  notifyBeforeHours: 48,
  delivery: 'both',
})
assert.ok(valid)
assert.equal(valid.title, 'Accelerator deadline')
assert.equal(valid.notifyBeforeHours, 48)
assert.equal(valid.delivery, 'both')
console.log('✓ valid deadline watcher')

assert.equal(normalizeDeadlineWatcher({ deadline:'2026-09-20T12:00:00Z' }), null)
console.log('✓ title is required')
assert.equal(normalizeDeadlineWatcher({ title:'Deadline', deadline:'not-a-date' }), null)
console.log('✓ valid deadline is required')

const clampedHigh = normalizeDeadlineWatcher({ title:'Long watch', deadline:'2026-12-20T12:00:00Z', notifyBeforeHours:99999, delivery:'app' })!
assert.equal(clampedHigh.notifyBeforeHours, 720)
assert.equal(clampedHigh.delivery, 'app')
console.log('✓ notify window clamps to 30 days')

const defaulted = normalizeDeadlineWatcher({ title:'Default delivery', deadline:'2026-12-20T12:00:00Z', notifyBeforeHours:0, delivery:'unknown' })!
assert.equal(defaulted.notifyBeforeHours, 24)
assert.equal(defaulted.delivery, 'both')
console.log('✓ defaults are safe')

console.log('✅ Background Gogo watcher checks passed')
