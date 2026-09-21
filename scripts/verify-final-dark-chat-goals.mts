import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const chat=readFileSync('components/dashboard/gogo-chat.tsx','utf8')
const agent=readFileSync('app/dashboard/(app)/agent/page.tsx','utf8')

assert.ok(chat.includes("bg-[#1c1c1c]"),'user message bubble must use the Final-Dark dark surface')
assert.ok(chat.includes("text-[#f2efea]"),'chat must use readable Final-Dark light text')
assert.ok(chat.includes("One conversation, across here and WhatsApp."),'chat must match the supplied Final-Dark conversation frame')
assert.ok(chat.includes("In this conversation"),'chat must include the supplied right-side conversation context rail')
assert.doesNotMatch(chat,/bg-gogo-ink text-white/,'chat must not regress to theme-dependent white-on-white bubbles')

assert.match(agent,/Describe the outcome you want Gogo to keep moving, then press Create/)
assert.match(agent,/onKeyDown=.*Enter/s)
assert.match(agent,/Prepare my New York trip and keep checking what needs my attention/)
assert.match(agent,/Goal created:/)
assert.match(agent,/A Goal is an outcome Gogo should keep moving over time/)

console.log('Final-Dark chat parity + Goals UX verification passed')
