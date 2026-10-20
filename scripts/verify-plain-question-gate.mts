// The plain-question fast path must only skip duplicated matchers for pure information questions.
// Every command, follow-up, personal or account message from the REA/Instinct/Wajo use cases and the
// live tests must keep the full chain.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { isPlainInfoQuestion } = await import('../lib/agent/plain-question.ts')

const plain = [
  'Best coworking space in Indiranagar',
  'Who directed Jailer 2?',
  'What is the capital of Australia?',
  'How does a diffusion language model work?',
  'Which is better for a 5 day trip, Goa or Gokarna?',
  'Latest news on ISRO',
  'Cheapest coworking near Koramangala?',
]
const notPlain = [
  'Book a table for 2 at Toit Indiranagar tomorrow at 7pm',
  'Alert me when 22K gold in Bangalore drops 10%',
  'What are you working on?',
  'Any update on the Jailer 2 task?',
  'When is Jailer 2 releasing and add it to my calendar',
  'When does Pushpa 3 release and add it to my calendar',
  'Jailer qr code',
  'My bookings',
  'What do you remember about my Jailer booking?',
  'plan my weekend',
  'Compare iPhone 16 256GB prices',
  'cancel that task',
  'show all tasks',
  'Remind me to call mom at 6pm',
  'What is on my calendar today?',
  'Is my flight on time?',
  'When is my dentist appointment?',
  'What did I spend on food this month?',
  'Watch Sony WH-1000XM5 below ₹24,000',
  'Where is my order?',
  'yes',
  'approve',
  'Goverdhan',
  '24k',
  'What is the status of the iPhone watch?',
  'How much is my credit card bill?',
  'Send an email to Divya about the launch',
  'What time should we leave for PVR?',
  'Who is free tomorrow? Schedule a call.',
  "What's the time in Dubai?",
  'What time is it in London?',
  'What is the weather in Bangalore?',
  'What is the date today?',
]
for (const t of plain) assert.equal(isPlainInfoQuestion(t), true, `should be plain: ${t}`)
for (const t of notPlain) assert.equal(isPlainInfoQuestion(t), false, `must keep the full chain: ${t}`)
console.log(`PASS ${plain.length} plain questions skip duplicates; ${notPlain.length} commands/personal asks keep the full chain`)

const fi = readFileSync(new URL('../lib/feature-intents.ts', import.meta.url), 'utf8')
assert.match(fi, /if \(!hasCalendarNoun && !isPlainInfoQuestion\(text\)\) \{\n\s+const agent = await tryRunWhatsAppAgent/)
const route = readFileSync(new URL('../app/api/dashboard/chat/route.ts', import.meta.url), 'utf8')
// r4-memory (20 Oct): a plain reminder read also skips the planner; plain questions still do.
assert.match(route, /const mission = isPlainInfoQuestion\(text\)(?: \|\| isReminderReadOnlyAsk\(text\))? \? null : await tryRunGeneralPlan\(/)
const ri = route.indexOf('const mission = isPlainInfoQuestion'), pi = route.lastIndexOf('const result = await processIncomingMessage(')
assert.ok(pi > ri, 'the message still reaches processIncomingMessage')
console.log('PLAIN_QUESTION_GATE_OK')

// Plain questions go straight to the web answer in processIncomingMessage (no chat-model "should I search" pass).
const pm = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
assert.match(pm, /baseIntent\.type === 'general_chat' && !understood && isPlainInfoQuestion\(incomingText\) && !worldTimeReply\(incomingText\)\n\s+\? \{ type: 'web_search', confidence: 'medium', meta: \{ plainQuestion: true \} \}/)
assert.match(pm, /isPlainInfoQuestion\(incomingText\) && !worldTimeReply\(incomingText\)/)
assert.ok(pm.indexOf("const intent = (baseIntent.type === 'general_chat'") < pm.indexOf("if (intent.type === 'web_search') {"))
console.log('PLAIN_QUESTION_DIRECT_WEB_OK')
