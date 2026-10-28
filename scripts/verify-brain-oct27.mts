// Context-first brain (lib/agent/brain.ts): canary gate, exact-command bypass, consent guard, message shape.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const b = await import('../lib/agent/brain.ts')
assert.ok(b.brainEnabledFor('+918884501501', { VERCEL_ENV: 'production' }))
assert.ok(!b.brainEnabledFor('+918884501501', {}), 'off in tests and previews by default')
assert.ok(!b.brainEnabledFor('+919999999999', { VERCEL_ENV: 'production' }))
assert.ok(!b.brainEnabledFor('+918884501501', { GOGO_BRAIN_USERS: '9999999999' }))
assert.ok(!b.brainEnabledFor('+918884501501', { GOGO_BRAIN: 'off', GOGO_BRAIN_USERS: '8884501501' }))
assert.ok(b.brainEnabledFor('whatsapp:+918310441698', { GOGO_BRAIN_USERS: '8884501501,8310441698' }))
for (const t of ['YES', 'approve', 'Approve.', '1', '2nd', 'book', 'book 2', 'STOP', 'done', 'Snooze 10m', '123456', 'admin find 1']) assert.ok(b.isExactCommand(t), t)
for (const t of ['Did it land?', 'book the 6 am one', 'yes but make it 8pm', 'Msg me when it lands', 'remind me about this tomorrow']) assert.ok(!b.isExactCommand(t), t)
// Consent words can never be introduced by a rewrite.
assert.deepEqual(b.decisionFromToolUse('go ahead with it', 'handle', { instruction: 'Approve the IndiGo booking', keep_original: false }), { kind: 'handle', instruction: 'go ahead with it', rewritten: false })
assert.deepEqual(b.decisionFromToolUse('remind me about it at 8', 'handle', { instruction: 'Remind me about the QF1 landing at 8 pm', keep_original: false }), { kind: 'handle', instruction: 'Remind me about the QF1 landing at 8 pm', rewritten: true })
assert.deepEqual(b.decisionFromToolUse('Mr', 'handle', { instruction: 'Mr', keep_original: true }), { kind: 'handle', instruction: 'Mr', rewritten: false })
assert.deepEqual(b.decisionFromToolUse('Did it land?', 'flight', { flight_no: 'qf 1', track: false }), { kind: 'flight', flightNo: 'QF1', track: false })
assert.equal(b.decisionFromToolUse('x', 'flight', { flight_no: 'land', track: false }).kind, 'handle')
// Strict alternation, ending with the new user turn.
const msgs = b.brainMessages([{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'Track QF1' }, { role: 'assistant', content: 'Tracking QF1' }, { role: 'assistant', content: 'In the air' }], 'Did it land?')
assert.deepEqual(msgs.map(m => m.role), ['user', 'assistant', 'user'])
assert.equal(msgs[2].content, 'Did it land?')
// The model sees tracked flights and the conversation; a fake client returns the flight tool.
let seen: any = null
const client: any = { messages: { create: async (req: any) => { seen = req; return { content: [{ type: 'tool_use', name: 'flight', input: { flight_no: 'QF1', track: false } }] } } } }
const ctx = { turns: [{ role: 'user' as const, content: 'Track QF1' }, { role: 'assistant' as const, content: 'Tracking QF1, in the air' }], trackedFlights: ['QF1 (SYD → SIN)'], sections: { 'Active watches': ['QF1 flight'] }, name: 'Divya', timezone: 'Asia/Kolkata' }
const d = await b.decide({ text: 'Did it land?', ctx, client })
assert.equal(d.kind, 'flight'); assert.match(seen.system, /QF1 \(SYD → SIN\)/); assert.equal(seen.tool_choice.type, 'any'); assert.equal(seen.messages.at(-1).content, 'Did it land?')
const broken: any = { messages: { create: async () => { throw new Error('timeout') } } }
assert.equal((await b.decide({ text: 'hi there', ctx, client: broken })).kind, 'skip', 'any failure falls back to the old pipeline')
assert.deepEqual(b.decisionFromToolUse('Which one is cheapest in the morning?', 'later', { question: 'Which BLR to DEL flight on 5 Nov is cheapest in the morning?' }), { kind: 'later', question: 'Which BLR to DEL flight on 5 Nov is cheapest in the morning?' })
assert.ok(b.BRAIN_TOOLS.some(t => t.name === 'later'))
let opts: any = null
await b.decide({ text: 'hi', ctx, client: { messages: { create: async (_r: any, o: any) => { opts = o; return { content: [{ type: 'tool_use', name: 'reply', input: { text: 'Hi!' } }] } } } } as any })
assert.equal(opts.maxRetries, 0, '27 Oct live: no silent retries (16.9 s decision)'); assert.ok(opts.timeout <= 8000)
const worker = (await import('node:fs')).readFileSync(new URL('../lib/agent/travel-research-worker.ts', import.meta.url), 'utf8')
assert.ok(worker.includes('brain.answerFollowups'), 'questions asked mid-search are answered after delivery')
assert.match(b.BRAIN_SYSTEM(ctx, new Date()), /exactly "book <number>"/, '28 Oct live: "Book the evening one" restated the route and started a new search')
console.log('BRAIN_OK')
