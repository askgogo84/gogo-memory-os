// 20 Oct 2026 ~23:00 IST dashboard live failures (R4):
//  1) "Train from Bangalore to Mysore tomorrow morning" -> chat model listed invented trains/times/fares, no source.
//  2) "Best coworking space in Indiranagar" -> raw "(sources 2, 3, 4)" / "(source 3)" markers in the answer.
//  3) "Translate good morning to Kannada" -> "ಕನ್ನಡಕ್ಕೆ ಶುಭೋದಯ" ("to Kannada" translated too) + italic footer.
//  4) "..., boss." in a recall reply; "1 transactions" in expenses.
//  5) "Latest news on ISRO" -> "No clearly dated ISRO news": search dates were parsed but never shown to the model.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'

const claude = await import('../lib/services/claude.ts')
const train = await import('../lib/agent/train-research.ts')
const uf = await import('../lib/agent/understand-first.ts')
const tr = await import('../lib/services/translator.ts')
const ws = await import('../lib/web-search.ts')

// ── 1. Train route questions go to the train specialist; times are never model-recalled ──
const LIVE_TRAIN = 'Train from Bangalore to Mysore tomorrow morning'
assert.equal(train.isTrainResearchRequest(LIVE_TRAIN), true, 'the live phrasing is a train request')
for (const t of ['trains from Bengaluru to Chennai on 25th', 'train from SBC to MYS', 'find trains from bangalore to mysore']) {
  assert.equal(train.isTrainResearchRequest(t), true, t)
}
for (const t of ['train a model from scratch to classify images', 'Train my dog to sit', 'how do I train from home to run a marathon', 'what is the weather in Mysore tomorrow']) {
  assert.equal(train.isTrainResearchRequest(t), false, `not a train request: ${t}`)
}
console.log('PASS 1a: train route phrasing reaches the train specialist')

// understand-first must not read (and so cannot answer) a rail route: the model call would throw.
const noModel = async () => { throw new Error('understand-first must not spend a reading on a rail route') }
const handlers = { pendingAnswerers: [], retrieveDocument: async () => null, taskStatus: async () => null, assistant: async () => { throw new Error('must not dispatch') } }
const actor: any = { legacyTelegramId: 1, userId: 'u', timezone: 'Asia/Kolkata' }
const out = await uf.runUnderstandFirst({ actor, surface: 'web', text: LIVE_TRAIN, eventId: 'e1', handlers: handlers as any, deps: { callModel: noModel as any, record: async () => {}, background: () => {} } })
assert.equal(out.reply, null)
assert.equal(out.decision.reason, 'train_specialist')
console.log('PASS 1b: understand-first leaves train routes to the specialist')

// The dashboard still calls the train specialist before the general planner and feature router.
const dash = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
assert.ok(dash.indexOf("tryRunTrainResearch({ actor, surface:'web', text })") < dash.indexOf('tryRunGeneralPlan({'))

const fabricated = 'Here are morning trains from Bengaluru to Mysuru tomorrow:\n1. Shatabdi Exp 12007 — 06:00 → 08:00 · ₹560\n2. Chamundi Exp 16215 — 06:15 → 08:45\n3. Tippu Exp 16591 — 07:10'
const chat = claude.finishChatReply(LIVE_TRAIN, fabricated)
assert.doesNotMatch(chat, /06:00|06:15|07:10|12007|16215|Chamundi|Tippu/)
assert.match(chat, /couldn't verify train timings/)
assert.match(chat, /https:\/\/www\.irctc\.co\.in\/nget\/train-search/)
assert.match(chat, /https:\/\/www\.confirmtkt\.com/)
// A SEARCH directive is left for the parser (the search path then grounds against results).
assert.equal(claude.finishChatReply(LIVE_TRAIN, 'SEARCH: Bengaluru to Mysuru trains morning'), 'SEARCH: Bengaluru to Mysuru trains morning')
// Bus and flight timetables get their own honest pointers.
assert.match(claude.finishChatReply('bus from Bangalore to Mysore tonight', 'KSRTC Airavat at 9:30 pm'), /redbus\.in/)
assert.match(claude.finishChatReply('flights from Bangalore to Delhi tomorrow', 'IndiGo 6E 2131 departs 06:05'), /couldn't verify flight timings/)
// Not a timetable question: untouched. The user's own saved trip: untouched.
assert.equal(claude.finishChatReply('Remind me what time the meeting is', 'Your meeting is at 4:30 pm.'), 'Your meeting is at 4:30 pm.')
assert.equal(claude.finishChatReply('when does my flight to Delhi land?', 'Your flight lands at 10:40 IST.'), 'Your flight lands at 10:40 IST.')

// Web answers: times must appear in the fetched results.
const ctx = '1. Bengaluru Mysuru trains\nKSR Bengaluru – Mysuru Express departs 06:20, arrives 09:00.\nSource: https://www.railyatri.in/sbc-to-mys'
assert.match(claude.finishWebAnswer(LIVE_TRAIN, 'Express departs 06:20 and reaches 09:00. https://www.railyatri.in/sbc-to-mys', ctx), /06:20/)
const cited = claude.finishWebAnswer(LIVE_TRAIN, 'Express departs 06:20 and reaches 09:00.', ctx)
assert.match(cited, /Source: https:\/\/www\.railyatri\.in\/sbc-to-mys/, 'sourced times without a link get the result link')
assert.match(claude.finishWebAnswer(LIVE_TRAIN, 'Shatabdi 12007 departs 06:00.', ctx), /couldn't verify train timings/, 'a time absent from results is replaced')
console.log('PASS 1c: train/bus/flight times only from fetched sources, otherwise IRCTC/ConfirmTkt pointers')

// ── 2. Citation markers stripped, links kept ──
const cw = claude.stripSearchPreamble('Bhive Workspace is consistently listed among the best in Indiranagar (sources 2, 3, 4). WeWork Galaxy is popular too (source 3). See https://bhiveworkspace.com [1].')
assert.equal(cw, 'Bhive Workspace is consistently listed among the best in Indiranagar. WeWork Galaxy is popular too. See https://bhiveworkspace.com.')
assert.equal(claude.stripSearchPreamble('Petrol is ₹102.92 [2][3] today (Source: 1).'), 'Petrol is ₹102.92 today.')
assert.equal(claude.stripSearchPreamble('Source: [IMDb](https://www.imdb.com/title/tt1/)'), 'Source: IMDb: https://www.imdb.com/title/tt1/')
assert.equal(claude.stripSearchPreamble('Open 24 hours (10 seats) at ₹500.'), 'Open 24 hours (10 seats) at ₹500.', 'ordinary parentheses stay')
assert.equal(claude.finishWebAnswer('best coworking in Indiranagar', 'Bhive is top-rated (sources 2, 3).', ''), 'Bhive is top-rated.')
console.log('PASS 2: (source N) / [N] markers removed from web answers')

// ── 3. Translation text excludes the instruction; plain footer ──
assert.equal(tr.extractTextToTranslate('Translate good morning to Kannada'), 'good morning')
assert.equal(tr.extractTextToTranslate('translate good morning into hindi please'), 'good morning')
assert.equal(tr.extractTextToTranslate('Translate to Kannada: good morning'), 'good morning')
assert.equal(tr.extractTextToTranslate('translate: how are you'), 'how are you')
assert.equal(tr.extractTextToTranslate('How do you say thank you in Tamil?'), 'thank you')
assert.equal(tr.extractTextToTranslate('translate "I am going to the market" to French'), 'I am going to the market')
assert.equal(tr.parseTargetLanguage('Translate good morning to Kannada'), 'Kannada')
assert.equal(tr.parseTargetLanguage('translate this hindi line to english'), 'English')
const reply = tr.buildTranslationReply({ translation: 'ಶುಭೋದಯ', detectedLanguage: 'English', targetLanguage: 'Kannada', transliteration: 'Shubhodaya' })
assert.match(reply, /\nಶುಭೋದಯ\n\(Shubhodaya\)\n/)
assert.doesNotMatch(reply, /ಕನ್ನಡಕ್ಕೆ/)
assert.doesNotMatch(reply, /(^|\s)_[^_\n]+_(\s|$)/, 'no underscore italics')
assert.doesNotMatch(tr.buildImageTranslationReply('x', false), /_/)
console.log('PASS 3: "Translate good morning to Kannada" translates only "good morning"; no italics')

// ── 4. No unrequested "boss"; correct pluralisation ──
assert.equal(claude.stripUnrequestedAddress('Your car is parked at *B2 slot 14*, boss.'), 'Your car is parked at *B2 slot 14*.')
assert.equal(claude.stripUnrequestedAddress('Got it, boss. Reminder set.'), 'Got it. Reminder set.')
assert.equal(claude.stripUnrequestedAddress('Boss, your meeting is at 4.'), 'Your meeting is at 4.')
assert.equal(claude.stripUnrequestedAddress('Your boss called at 4.'), 'Your boss called at 4.', 'a real boss stays')
assert.equal(claude.stripUnrequestedAddress('Send the deck to your boss.'), 'Send the deck to your boss.', 'a real boss at sentence end stays')
assert.equal(claude.stripUnrequestedAddress('Got it boss. Done.'), 'Got it. Done.')
assert.equal(claude.stripUnrequestedAddress('Parked at B2, boss.', 'Standing preferences:\n- address me as boss'), 'Parked at B2, boss.', 'an explicit preference keeps it')
assert.equal(claude.finishChatReply('where did I park', 'Your car is parked at *B2 slot 14*, boss.'), 'Your car is parked at *B2 slot 14*.')
const exp = readFileSync('app/api/expenses/route.ts', 'utf8')
assert.doesNotMatch(exp, /\$\{(?:today|data)\.count\} transactions/, 'no unconditional plural')
assert.match(exp, /function transactionCount\(n: number\) \{ return `\$\{n\} transaction\$\{n === 1 \? '' : 's'\}` \}/)
assert.doesNotMatch(exp, /export function transactionCount/, 'route files export only handlers')
assert.doesNotMatch(readFileSync('lib/bot/services/expense-analyzer.ts', 'utf8'), /\$\{summary\.count\} transactions/)
assert.doesNotMatch(readFileSync('lib/agent/watch-command.ts', 'utf8'), /track it, boss/)
console.log('PASS 4: no "boss" address; "1 transaction"')

// ── 5. Search context carries the published date ──
const news = ws.formatSearchContext([
  { title: 'ISRO launches PSLV-C62', snippet: 'ISRO launched ...', url: 'https://example.org/isro', publishedDate: new Date(Date.parse('2026-10-19T12:00:00Z')).toISOString() },
  { title: 'Undated explainer', snippet: 'About ISRO', url: 'https://example.org/x' },
])
assert.match(news, /^1\. ISRO launches PSLV-C62 \(published 2026-10-19\)\nISRO launched \.\.\.\nSource: https:\/\/example\.org\/isro/)
assert.match(news, /2\. Undated explainer\nAbout ISRO\nSource: https:\/\/example\.org\/x$/)
assert.equal(ws.serperDate('2 days ago', Date.parse('2026-10-20T12:00:00Z'))?.slice(0, 10), '2026-10-18')
console.log('PASS 5: dated results reach the news answer')

console.log('R4_ANSWERS_OK')
