// "Build me one page…" (9 Nov): only page requests match; trip words pick the Trip Board; a name is kept; replies are honest.
import assert from 'node:assert/strict'
import { parsePageAsk, pageReply } from '../lib/spaces/from-chat'
assert.deepEqual(parsePageAsk('Build me one page I can check every morning. Is the business healthy, and where should I look?'), { template: 'my_day', title: null })
assert.deepEqual(parsePageAsk('make me a dashboard for my Goa trip, call it Goa Board'), { template: 'trip_board', title: 'Goa Board' })
assert.deepEqual(parsePageAsk('create a page named "Daily Pulse"'), { template: 'my_day', title: 'Daily Pulse' })
assert.equal(parsePageAsk('book a page 3 taxi'), null)
assert.equal(parsePageAsk('remind me to check the page tomorrow'), null)
assert.equal(parsePageAsk('what is on my calendar'), null)
assert.match(pageReply({ created: true, title: 'Daily Pulse', slug: 'my_day', refreshMinutes: 15 }), /Here's \*Daily Pulse\*\. It refreshes every 15 min[\s\S]*\/dashboard\/spaces\/my_day[\s\S]*Nothing on it sends/)
assert.match(pageReply({ created: false, title: 'My Day & Open Loops', slug: 'my_day', refreshMinutes: 15 }), /You already have/)
console.log('verify-space-from-chat-nov9: 8 passed')
