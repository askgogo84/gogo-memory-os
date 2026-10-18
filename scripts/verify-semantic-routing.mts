import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// Phases 1-4 of semantic-first routing. Runs the real detectIntent + the real semantic gate over a corpus of
// real phone messages and look-alike sentences, with a stand-in classifier reading (see the corpus note).
// Run: npx tsx scripts/verify-semantic-routing.mts            (add --table to print every row)
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.OPENAI_API_KEY ||= 'dummy-key'
const { detectIntent }: any = await import('../lib/bot/detect-intent')
const gate: any = await import('../lib/agent/semantic-gate')
const corpus = JSON.parse(readFileSync(new URL('./data/routing-corpus.json', import.meta.url), 'utf8')).cases as Array<{ text: string; jev: [string, number]; expect: string[] }>

const fakeJev = (intent: string, confidence: number): any => ({
  ok: true, version: 'stub', model: 'stub', latencyMs: 1, contextual: false,
  intent: { choice: intent, confidence, probabilities: {} },
  actionMode: { choice: 'read', confidence: 0.9, probabilities: {} },
  referentKind: { choice: 'none', confidence: 1, probabilities: {} },
  attentionState: { choice: 'none', confidence: 0.9, probabilities: {} },
  decisionReadiness: { choice: 'ready', confidence: 0.9, probabilities: {} },
})

const rows: Array<{ text: string; rules: string; gated: string; ok: boolean; rulesOk: boolean }> = []
const failures: string[] = []
for (const c of corpus) {
  const rule = detectIntent(c.text)
  const jev = fakeJev(c.jev[0], c.jev[1])
  const gated = gate.gateDetectedIntent(rule, c.text, jev)
  const failOpen = gate.gateDetectedIntent(rule, c.text, null)
  assert.equal(failOpen.type, rule.type, `without the classifier the rules decide unchanged: "${c.text}"`)
  const ok = c.expect.includes(gated.type)
  rows.push({ text: c.text, rules: rule.type, gated: gated.type, ok, rulesOk: c.expect.includes(rule.type) })
  if (!ok) failures.push(`"${c.text}": rules=${rule.type} gated=${gated.type} expected one of ${c.expect.join('|')}`)
}
const total = rows.length, rulesOnlyRight = rows.filter(r => r.rulesOk).length, gatedRight = rows.filter(r => r.ok).length
if (process.argv.includes('--table')) for (const r of rows) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.text.padEnd(58)} rules=${r.rules.padEnd(16)} gated=${r.gated}`)
console.log(`corpus ${total}: rules alone right ${rulesOnlyRight}, with semantic gate right ${gatedRight}`)
assert.deepEqual(failures, [], failures.join('\n'))
assert.ok(gatedRight >= rulesOnlyRight, 'the gate must never make routing worse on the corpus')

// Contract: exact commands and very short messages are never blocked, however confident the classifier is
for (const t of ['my reminders', 'done 2', '1', 'yes', 'cancel', 'hi', 'dashboard', 'weather', 'news']) {
  assert.equal(gate.ruleMayClaim({ text: t, capability: 'nutrition', jev: fakeJev('travel_research', 0.99) }).allow, true, `"${t}" is never reinterpreted`)
}
// Contract: low confidence and unspecific answers never block
assert.equal(gate.ruleMayClaim({ text: 'track divya flight now', capability: 'nutrition', jev: fakeJev('travel_research', 0.6) }).allow, true)
assert.equal(gate.ruleMayClaim({ text: 'track divya flight now', capability: 'nutrition', jev: fakeJev('general_reasoning', 0.99) }).allow, true)
assert.equal(gate.ruleMayClaim({ text: 'track divya flight now', capability: 'nutrition', jev: { ...fakeJev('travel_research', 0.99), ok: false } }).allow, true)
assert.equal(gate.ruleMayClaim({ text: 'track divya flight now', capability: 'nutrition', jev: fakeJev('travel_research', 0.99) }).allow, false)
// Contract: the generic search fallback is not blocked, but a bare hint word is
assert.equal(gate.ruleMayClaim({ text: 'latest score of the match now', capability: 'search', jev: fakeJev('reminder_mutation', 0.99) }).allow, true)
assert.equal(gate.gateDetectedIntent({ type: 'web_search', confidence: 'medium' }, 'remind me about the news at five', fakeJev('reminder_mutation', 0.95)).type, 'general_chat')
assert.equal(gate.gateDetectedIntent({ type: 'web_search', confidence: 'high', meta: { flightStatus: true } }, 'has KL879 landed yet', fakeJev('reminder_mutation', 0.95)).type, 'web_search')

// Phase 4: deterministic tightening needs no classifier
for (const [t, notType] of [
  ['I want product recommendations for a gift', 'notify_me'],
  ['read the newsletter from Anthropic', 'web_search'],
  ['she scored well in the exam', 'web_search'],
  ['currently reading a book', 'web_search'],
  ['Track Divya flight', 'nutrition_log'],
  ['I ate too much today', 'nutrition_log'],
  ['I ate too much today', 'web_search'],
  ['clear my head, what\'s the plan for the day', 'list_clear'],
  ['my sister\'s birthday is on Sunday, what should I gift', 'set_reminder'],
  ['today I met the Flipkart team and it went well', 'web_search'],
  ['track my order', 'nutrition_log'],
] as const) assert.notEqual(detectIntent(t).type, notType, `"${t}" must not be ${notType}`)
for (const [t, type] of [['had 2 rotis with dal', 'nutrition_log'], ['clear groceries', 'list_clear'], ['who is playing in the match today', 'web_search'], ['remind me on Sunday to buy a gift', 'set_reminder'], ['I want pro', 'notify_me'], ['i want the pro plan', 'notify_me'], ['latest news on RBI', 'web_search']] as const) assert.equal(detectIntent(t).type, type, `"${t}" stays ${type}`)

// Wiring: the gate sits on the claim sites, and the classifier now always sees the recent conversation
const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
assert.match(src('../lib/bot/process-message.ts'), /const detectedIntent=detectIntent\(incomingText\)/)
assert.match(src('../lib/bot/process-message.ts'), /gateDetectedIntent\(detectedIntent, incomingText, params\.semantic\)/)
assert.match(src('../app/api/webhooks/whatsapp/route.ts'), /semantic: brainObservation\?\.jev \}\)\n/, 'WhatsApp passes the reading to the rules')
assert.match(src('../app/api/dashboard/chat/route.ts'), /semantic: webObservation\?\.jev/)
const legacy = src('../lib/feature-intents-legacy.ts')
for (const rule of ['legacy_nutrition', 'legacy_split', 'legacy_expense_log', 'legacy_contact_recall', 'legacy_followup', 'legacy_list_add', 'legacy_done']) assert.match(legacy, new RegExp(`may\\('[a-z]+', '${rule}'\\)`), `${rule} is gated`)
assert.match(src('../lib/typesafe/jev-shadow.ts'), /const rawRecent = String\(params\.recentContext \|\| ''\)/, 'recent conversation always goes with the sentence')
const q = src('../lib/typesafe/questions.ts')
for (const label of ['nutrition_log', 'live_info', 'money_tracking', 'account_settings']) assert.match(q, new RegExp(`${label}:`), `label ${label} exists`)
console.log('Semantic routing: rules stay as the fast path, a confident different reading stops a keyword claim, no classifier means unchanged behaviour')
