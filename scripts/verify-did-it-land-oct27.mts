// 27 Oct live: "Did it land?" after tracking QF67 replied "Marked done: it land?".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const { isPronounFlightQuestion, describeTrackedFlight } = await import('../lib/agent/flight-track.ts')
for (const q of ['Did it land?', 'did it land', 'Has it landed?', 'Has the flight taken off?', 'Is it delayed?', 'When will it land?', 'Where is it now?', 'So did my flight land?', 'Did she land?'])
  assert.ok(isPronounFlightQuestion(q), q)
for (const q of ['Did QF67 land?', 'did groceries', 'Did you send the email?', 'Is it raining?', 'done milk', 'what did I spend today'])
  assert.ok(!isPronounFlightQuestion(q), q)
const legacy = readFileSync(new URL('../lib/feature-intents-legacy.ts', import.meta.url), 'utf8')
assert.ok(legacy.includes('const doneMatch = doneQuestion ? null'), 'questions never mark done')
const doneQuestion = (t: string) => /\?\s*$/.test(t) || /^did\s+(?:it|you|he|she|they|we|i|this|that|the|my|your|his|her|their|our)\b/.test(t)
assert.ok(doneQuestion('did it land?') && doneQuestion('did it land') && doneQuestion('done milk?'))
assert.ok(!doneQuestion('did groceries') && !doneQuestion('done 1'))
const todos = readFileSync(new URL('../app/api/todos/route.ts', import.meta.url), 'utf8')
assert.ok(todos.includes("if (!updated?.length) return NextResponse.json({ ok: false, reply: null })"), 'no blind Marked done')
const landed = describeTrackedFlight({ active: false, condition_json: { adHocFlight: { flightNo: 'QF67', from: 'SYD', to: 'JNB', departAt: '2026-10-27T00:00:00Z', arriveAt: '2026-10-27T12:30:00Z' } }, last_state_json: { tracking: { state: 'landed', actualArrival: '2026-10-27T12:35:00Z' } } }, Date.parse('2026-10-27T12:40:00Z'))
assert.match(landed, /QF67 \(SYD → JNB\) landed in JNB/)
console.log('DID_IT_LAND_OK')
const { isFlightFollowUp } = await import('../lib/agent/flight-track.ts')
assert.ok(isFlightFollowUp('Msg me when it lands and keep monitoring'), '27 Oct live: "Msg me when it lands" starts tracking')
console.log('MSG_ME_WHEN_LANDS_OK')
const { conversationalFlightAnswer } = await import('../lib/agent/flight-track.ts')
const air = conversationalFlightAnswer({ flightNo: 'QF1', airline: 'Qantas', from: { iata: 'SYD', name: 'Sydney' }, to: { iata: 'SIN', name: 'Singapore' }, depLocal: '2026-10-27 16:30+11:00', arrLocal: '2026-10-27 21:35+08:00', depUtc: '2026-10-27T05:30:00Z', arrUtc: '2026-10-27T13:35:00Z', arrRevisedLocal: '2026-10-27 22:32+08:00', status: { state: 'departed', delayMinutes: 15, revisedArrival: '2026-10-27T14:32:00Z' } as any })
assert.match(air, /^Not yet\. QF1 is in the air, about 15 min late, landing around 22:32 Singapore time \(8:02 pm IST\)/)
const down = conversationalFlightAnswer({ flightNo: 'QF67', from: { iata: 'SYD', name: 'Sydney' }, to: { iata: 'BLR', name: 'Bengaluru' }, depUtc: '2026-10-26T23:56:00Z', arrLocal: '2026-10-27 15:45+05:30', arrRevisedLocal: '2026-10-27 17:38+05:30', status: { state: 'landed' } as any })
assert.match(down, /^Yes, QF67 has landed in Bengaluru, at 17:38 Bengaluru time\./)
console.log('DID_IT_LAND_LIVE_OK')
