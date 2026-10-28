// 28 Oct live use-case run: routing and formatting failures found on production.
import assert from 'node:assert/strict'
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
