// 28 Oct live use-case run: routing and formatting failures found on production.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
const { detectFriendReminder } = await import('../lib/bot/handlers/friend-reminders')
assert.equal(detectFriendReminder('Ask Claude to review this business plan and summarise its feedback for me.'), null, 'an AI model is not a friend to remind')
assert.equal(detectFriendReminder('ask chatgpt to write a poem'), null)
assert.ok(detectFriendReminder('Remind Divya to pay me 700 tomorrow at 6 pm'), 'friend reminders still work')

const { parseGmailReadFilter } = await import('../lib/bot/handlers/gmail-read')
assert.deepEqual(parseGmailReadFilter('Draft replies to my unread work emails from today'), { sender: null, topic: null }, '"from today" is a time, not a sender')
assert.equal(parseGmailReadFilter('latest email from Swiggy').sender, 'Swiggy')

const { readableSnippet } = await import('../lib/agent/appointment-research')
assert.match(readableSnippet('our premier women and men&#39;s hair salon'), /men's hair/)
assert.doesNotMatch(readableSnippet('A &amp; B'), /&amp;/)

const { detectIntent } = await import('../lib/bot/detect-intent') as any
const comp = await detectIntent('My IndiGo flight 6E 2134 on 20 October was delayed 4 hours. Check if I qualify for compensation or a refund and prepare the request for my review.')
assert.notEqual(comp?.meta?.flightStatus, true, 'a compensation claim is not a live status lookup')
const status = await detectIntent('Is 6E 6453 delayed today?')
assert.equal(status?.meta?.flightStatus, true, 'live status still routes')
console.log('✓ 28 Oct use-case run: AI names, Gmail time filters, snippet entities, compensation routing')

const { parseTypedTimeRequest } = await import('../lib/agent/typed-time-routing')
assert.equal(parseTypedTimeRequest('Make a grocery list with milk, eggs and bread and remind me to buy them at 6 pm today'), null)
assert.ok(parseTypedTimeRequest('Move the standup to 5 pm'), 'real time changes still parse')
const { extractCheckItemText } = await import('../lib/bot/process-message') as any
assert.equal(extractCheckItemText('Tick off eggs from my grocery list'), 'eggs')
assert.equal(extractCheckItemText('check milk'), 'milk')
assert.equal(extractCheckItemText('mark bread as done'), 'bread')
console.log('✓ 28 Oct use-case run: list+reminder not a time move; "tick off X from my list"')

const { parseSplitIntent } = await import('../lib/splitwise/split-parser') as any
const split = parseSplitIntent('Split 2400 dinner between me, Divya and Nithin')
assert.equal(split.description, 'dinner', JSON.stringify(split))
console.log('✓ 28 Oct use-case run: split description')
const remParse = await import('../lib/bot/handlers/reminders') as any
// The bare ordinal means the next future 1st at 9:00 AM IST. Pin the test clock:
// this used to assume November forever and broke CI after 9:00 AM IST on Nov 1.
const monthlyRentText = "Remind me to pay rent on the 1st and also what's the weather tomorrow?"
const monthlyRentBoundaries = [
  ['2026-10-31T03:29:00.000Z', '2026-11-01T03:30:00.000Z', 'previous month'],
  ['2026-11-01T03:29:00.000Z', '2026-11-01T03:30:00.000Z', 'first day before 9 AM IST'],
  ['2026-11-01T03:30:00.000Z', '2026-12-01T03:30:00.000Z', 'first day at 9 AM IST'],
  ['2026-12-01T03:29:00.000Z', '2026-12-01T03:30:00.000Z', 'December first before deadline'],
  ['2026-12-01T03:30:00.000Z', '2027-01-01T03:30:00.000Z', 'December first at deadline'],
  ['2026-12-31T18:29:00.000Z', '2027-01-01T03:30:00.000Z', 'year rollover'],
  ['2027-01-01T03:30:00.000Z', '2027-02-01T03:30:00.000Z', 'new-year first at deadline'],
] as const
mock.timers.enable({ apis: ['Date'], now: new Date(monthlyRentBoundaries[0][0]) })
try {
  for (const [now, expected, caseName] of monthlyRentBoundaries) {
    mock.timers.setTime(Date.parse(now))
    const rent = remParse.parseReminderIntent(monthlyRentText)
    assert.ok(rent && rent.kind === 'one_time', caseName)
    assert.equal(rent.message, 'pay rent', caseName + ': question excluded from task')
    assert.equal(rent.remindAtIso, expected, caseName + ': next future 9 AM IST first-of-month')
    assert.ok(Date.parse(rent.remindAtIso) > Date.now(), caseName + ': never schedule in past')
  }
} finally {
  mock.timers.reset()
}
assert.equal(remParse.stripTrailingQuestion('remind me to buy milk and check the oven at 6pm'), 'remind me to buy milk and check the oven at 6pm')
console.log('✓ 29 Oct: a trailing question is not part of the reminder')
