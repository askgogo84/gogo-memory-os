import assert from 'node:assert/strict'
import { parseAutonomyCommand } from '../lib/agent/adaptive-autonomy'

assert.deepEqual(parseAutonomyCommand('How autonomous are you?'),{kind:'status'})
assert.deepEqual(parseAutonomyCommand('What can you do without asking?'),{kind:'status'})
assert.deepEqual(parseAutonomyCommand('set calendar autonomy to auto'),{kind:'set',capability:'calendar',level:'auto'})
assert.deepEqual(parseAutonomyCommand('set email autonomy to ask'),{kind:'set',capability:'email',level:'ask'})
assert.deepEqual(parseAutonomyCommand('be more autonomous with my reminders'),{kind:'set',capability:'reminders',level:'auto'})
assert.deepEqual(parseAutonomyCommand('always ask me before travel'),{kind:'set',capability:'travel',level:'ask'})
assert.equal(parseAutonomyCommand('book my flight'),null)
assert.equal(parseAutonomyCommand('be less autonomous'),null)

console.log('adaptive autonomy command parsing passed')
