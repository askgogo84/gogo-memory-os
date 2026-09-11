import assert from 'node:assert/strict'
import { normalizeVoicePromptForBot, normalizeVoiceMeridiem } from '../lib/bot/handlers/voice-normalizer'
import { getAmbiguousReminderTime, parseReminderIntent } from '../lib/bot/handlers/reminders'

const explicitCases = [
  'remind me to take a photo tomorrow at 9:30 a.m. and keep it in my bag.',
  'remind me tomorrow at 9.30 a.m. to take a photo',
  'remind me tomorrow at 9:30 AM to take a photo',
  'remind me tomorrow at 9 p.m. to call Rahul',
  'remind me tomorrow at 9.30 p. m. to call Rahul',
]

for (const input of explicitCases) {
  const normalized = normalizeVoicePromptForBot(input)
  assert.equal(getAmbiguousReminderTime(normalized), null, `explicit meridiem must not be treated as ambiguous: ${input} -> ${normalized}`)
  const parsed = parseReminderIntent(normalized)
  assert.ok(parsed, `explicit voice reminder must parse: ${input} -> ${normalized}`)
}

const target = normalizeVoicePromptForBot('remind me to take a photo tomorrow at 9:30 a.m. and keep it in my bag.')
assert.match(target, /9:30\s*am/i, 'voice normalization must preserve the exact 9:30 AM time')
const parsed = parseReminderIntent(target)
assert.ok(parsed)
const istTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}).format(new Date(parsed.remindAtIso))
assert.equal(istTime, '09:30', '9:30 a.m. voice reminder must resolve to 09:30 IST')
assert.match(parsed.message.toLowerCase(), /take a photo/, 'task text must remain intact')
assert.match(parsed.message.toLowerCase(), /keep it in my bag/, 'task context after the explicit time must remain intact')

assert.equal(normalizeVoiceMeridiem('9:30 a.m.'), '9:30 am')
assert.equal(normalizeVoiceMeridiem('9.30 p. m.'), '9.30 pm')
assert.ok(getAmbiguousReminderTime('remind me tomorrow at 9 to take a photo'), 'bare 9 must still ask AM/PM')

console.log('✅ voice reminder explicit AM/PM regression passed')
