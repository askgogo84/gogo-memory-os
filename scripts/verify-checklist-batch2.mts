// 14 Oct dashboard run: (1) plain chat replied "Skipped today's lunch reminder (2:30 pm)" with no
// such reminder and nothing run; (2) "Delete the gym reminder for 6am tomorrow" said it could not
// find a reminder named "Gym" because the when-words were required to appear in the name.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.OPENAI_API_KEY ||= 'dummy-key'

const { guardChatActionClaims, claimsCompletedChange } = await import('../lib/bot/action-claim-guard')
const { extractCancelQuery, extractSkipQuery, extractWhenHour, reminderMatches, stripWhenWords } = await import('../lib/bot/handlers/edit-reminder')

// A finished-change receipt from plain chat is blocked, whatever the wording.
const receipts = [
  "⏭️ *Skipped today's lunch reminder* (2:30 pm).\n\nIt'll fire again tomorrow as usual, boss.",
  "Skipped today's lunch reminder (2:30 pm).",
  "Done. I've cancelled your gym reminder.",
  '💪 Set for 6am tomorrow. Rain or shine, boss.',
  'Added milk to your grocery list.',
  "Sure, I've moved the meeting to 5 pm.",
  'Okay! Deleted the 8 pm alarm.',
]
for (const t of receipts) assert.equal(guardChatActionClaims(t).blocked, true, t)
assert.match(guardChatActionClaims(receipts[0]).text, /^I haven't changed anything/)

// Ordinary chat that merely talks about these words is untouched.
const talk = [
  'Skipping lunch while fasting is fine. Drink plenty of water.',
  'You can skip the reminder from the app.',
  'Want me to add it to your list?',
  'I can set a reminder for that if you like.',
  'Added benefits of fasting include better focus.',
  'Cancelled flights are usually refunded.',
  'Set the scene first, then explain.',
  'Moved by the story, she wrote back.',
  'Bengaluru will be 24°C and cloudy today.',
]
for (const t of talk) assert.equal(claimsCompletedChange(t), false, t)

// The name of a reminder is separated from the words that say when it fires.
assert.equal(extractCancelQuery('delete the gym reminder for 6am tomorrow'), 'gym')
assert.equal(extractCancelQuery('cancel gym reminder'), 'gym')
assert.equal(extractCancelQuery('cancel water reminder'), 'water')
assert.equal(extractCancelQuery('remove the call mom reminder at 8 pm tonight'), 'call mom')
assert.equal(extractCancelQuery('cancel the 6pm reminder'), null)
assert.equal(extractSkipQuery('skip lunch today'), 'lunch')
assert.equal(extractSkipQuery('skip the yoga reminder on friday'), 'yoga')
assert.equal(stripWhenWords('standup on wednesday at 10'), 'standup')
assert.equal(reminderMatches({ message: 'Gym' }, extractCancelQuery('delete the gym reminder for 6am tomorrow')!), true)

// A clock time in the sentence can pick between reminders that share a name.
assert.equal(extractWhenHour('for 6am tomorrow'), 6)
assert.equal(extractWhenHour('at 8:30 pm'), 20)
assert.equal(extractWhenHour('12 am'), 0)
assert.equal(extractWhenHour('12 pm'), 12)
assert.equal(extractWhenHour('tomorrow'), null)

console.log('Checklist batch 2: chat cannot report finished changes; reminder names match without their when-words')
