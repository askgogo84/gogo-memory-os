import assert from 'node:assert/strict'
import {
  isReminderReadQuery,
  normalizeNaturalReminderSave,
  parseListReminderCompound,
} from '../lib/bot/handlers/natural-command-routing.ts'
import { parseExplicitListShow } from '../lib/bot/handlers/list-conversation-context.ts'

const compound = 'Create a list called Persistent Runtime Test with Passport, Charger and Power bank. Remind me tomorrow at 9:00 AM to review the Persistent Runtime Test list.'
const parsed = parseListReminderCompound(compound)
assert.ok(parsed, 'compound list+reminder command should be detected')
assert.equal(parsed?.listName, 'Persistent Runtime Test')
assert.deepEqual(parsed?.items, ['Passport', 'Charger', 'Power bank'])
assert.equal(parsed?.reminderText, 'Remind me tomorrow at 9:00 AM to review the Persistent Runtime Test list.')
assert.equal(normalizeNaturalReminderSave(compound), parsed?.reminderText)

assert.equal(parseExplicitListShow('Show me the list called Persistent Runtime Test.'), 'Persistent Runtime Test')
assert.equal(parseExplicitListShow('Open my grocery list'), 'grocery')

assert.equal(isReminderReadQuery('What reminders do I have for tomorrow?'), true)
assert.equal(isReminderReadQuery('Show me my reminders for tomorrow'), true)
assert.equal(isReminderReadQuery('Do I have any reminders today?'), true)
assert.equal(isReminderReadQuery('Remind me tomorrow at 9 AM to call Srinivas'), false)
assert.equal(isReminderReadQuery('Set a reminder tomorrow at 9 AM'), false)
assert.ok(normalizeNaturalReminderSave('What reminders do I have for tomorrow?'), 'read query must be intercepted before write routing')

assert.equal(parseListReminderCompound('Create a list called Test with A and B.'), null)
assert.equal(parseListReminderCompound('Remind me tomorrow at 9 AM to call Srinivas'), null)

console.log('verify-reminder-list-p0: PASS')
