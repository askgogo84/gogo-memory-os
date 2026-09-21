import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const chat=readFileSync('components/dashboard/gogo-chat.tsx','utf8')
const agent=readFileSync('app/dashboard/(app)/agent/page.tsx','utf8')

assert.match(chat,/bg-[#f2efea] text-[#0b0b0b]/,'user bubble must be dark text on a light bubble')
assert.match(chat,/bg-[#161616] text-[#f2efea]/,'assistant bubble must be light text on a dark bubble')
assert.doesNotMatch(chat,/bg-gogo-ink text-white/,'Final-Dark user bubble must not resolve to white-on-white')

assert.match(agent,/Describe the outcome you want Gogo to keep moving, then press Create/)
assert.match(agent,/onKeyDown=.*Enter/s)
assert.match(agent,/Prepare my New York trip and keep checking what needs my attention/)
assert.match(agent,/Goal created:/)
assert.match(agent,/disabled={busy==='goal'}/)
assert.match(agent,/A Goal is an outcome Gogo should keep moving over time/)

console.log('Final-Dark chat contrast + Goals UX verification passed')
