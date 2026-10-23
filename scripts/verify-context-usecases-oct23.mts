// 23 Oct live dashboard run (context memory): follow-ups lost their subject, tracked-flight questions went to
// web search, "make it shorter" became a reminder, and a calendar time came back as raw ISO.
// Run: npx tsx scripts/verify-context-usecases-oct23.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
const fq = await import('../lib/agent/follow-up-query.ts')
const { isWatcherStatusQuery } = await import('../lib/agent/watch-command.ts')
const { isFlightStatusQuestion } = await import('../lib/agent/flight-track.ts')
const { detectIntent } = await import('../lib/bot/detect-intent.ts')
const { readableStart } = await import('../lib/agent/typed-time-routing.ts')

// C9a: "what did I ask you to track" lists the watches.
for (const t of ['What did I ask you to track today?', 'what have I asked you to monitor', 'Which flights did I ask you to track?']) assert.ok(isWatcherStatusQuery(t), t)
for (const t of ['what should I track for my health?', 'track EK500']) assert.ok(!isWatcherStatusQuery(t), t)

// C1a: a status question naming a flight is answered from the tracker (only when that flight is tracked).
for (const t of ['How is EK500 doing?', 'has EK 500 landed', 'EK500 status', 'Is VS354 delayed?']) assert.ok(isFlightStatusQuestion(t), t)
for (const t of ['Track EK500', 'alert me once it lands', 'stop tracking EK500', 'book EK500']) assert.ok(!isFlightStatusQuestion(t), t)
const wc = readFileSync('lib/agent/watch-command.ts', 'utf8')
assert.match(wc, /flightTrackStatusReply\(tg,params\.text,new Date\(\),'Asia\/Kolkata',\{onlyTracked:true\}\)/)
const ft = readFileSync('lib/agent/flight-track.ts', 'utf8')
assert.match(ft, /if \(opts\.onlyTracked && \(!codes\.length \|\| missing\.length\)\) return null/, 'untracked flights fall through to the live lookup')

// C3b / C8b / C4b / C7b: follow-ups are searched as standalone queries.
for (const t of ['which of those is open late?', 'how old is he?', 'and on Flipkart?', 'which one is cheaper in India?', 'what about Croma?']) assert.ok(fq.isFollowUpQuery(t), t)
for (const t of ['Who is the CEO of Zomato?', 'petrol price in Bengaluru today', 'Suggest 3 good South Indian restaurants in Rajajinagar']) assert.ok(!fq.isFollowUpQuery(t), t)
const history = [
  { role: 'user' as const, content: 'Who is the CEO of Zomato?' },
  { role: 'assistant' as const, content: 'Deepinder Goyal is the CEO of Zomato.' },
  { role: 'user' as const, content: 'how old is he?' },
]
let seen = ''
const q = await fq.standaloneSearchQuery('how old is he?', history, async p => { seen = p; return '"Deepinder Goyal age"' })
assert.equal(q, 'Deepinder Goyal age', 'model rewrite used, quotes stripped')
assert.match(seen, /Assistant: Deepinder Goyal is the CEO of Zomato\./); assert.ok(!/User: how old is he\?\nUser/.test(seen), 'current turn not duplicated')
assert.equal(await fq.standaloneSearchQuery('how old is he?', history, async () => { throw new Error('down') }), 'Who is the CEO of Zomato. how old is he?', 'deterministic fallback')
assert.equal(await fq.standaloneSearchQuery('how old is he?', [], async () => 'x y z w'), 'how old is he?', 'no history: unchanged')
assert.equal(await fq.standaloneSearchQuery('Who is the CEO of Zomato?', history, async () => 'nope'), 'Who is the CEO of Zomato?', 'not a follow-up: unchanged')
const pm = readFileSync('lib/bot/process-message.ts', 'utf8')
assert.match(pm, /const searchContext = await searchWeb\(searchQuery\)/)
assert.match(pm, /await standaloneSearchQuery\(incomingText, await getConversationHistory\(resolvedUser\.telegramId\)/)

// C6b: "make it shorter" is a draft edit, not a reminder; time edits still are.
for (const t of ['make it shorter', 'make it more formal', 'make it friendlier']) assert.notEqual(detectIntent(t).type, 'set_reminder', t)
for (const t of ['make it 10am', 'make it tomorrow', 'make it at 9', 'make it every monday']) assert.equal(detectIntent(t).type, 'set_reminder', t)

// C5b: readable times.
const now = Date.parse('2026-10-23T13:00:00Z')
assert.equal(readableStart('2026-10-24T11:30:00+05:30', 'Asia/Kolkata', false, now), '11:30 am, Sat, 24 Oct')
assert.equal(readableStart('2026-10-08T11:30:00+05:30', 'Asia/Kolkata', true, now), '11:30 am (repeats)')
assert.match(readableStart('2026-10-25', 'Asia/Kolkata'), /^all day, /)
assert.ok(!/T\d\d:/.test(readableStart('2026-10-24T11:30:00+05:30', 'Asia/Kolkata')), 'no raw ISO')
console.log('verify-context-usecases-oct23: ok')
