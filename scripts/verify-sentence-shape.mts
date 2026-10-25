import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 13 Oct 23:14 live test of the semantic gate. Four sentences were claimed by a keyword rule while the classifier
// was below the gate's confidence floor (or absent), so the rule alone has to read the sentence:
//   "Skip lunch today, I'm fasting"                  -> reminder editor ("Which reminder should I skip?")
//   "Remove duplicates from my grocery list"          -> reminder editor ("I couldn't find that reminder")
//   "Rain or shine, I'll be at the gym at 6am tomorrow" -> weather card
//   "Can you remind me what Srini told me about ..."   -> new reminder with a garbled label
// Run: npx tsx scripts/verify-sentence-shape.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.OPENAI_API_KEY ||= 'dummy-key'
const d: any = await import('../lib/bot/detect-intent')
const type = (t: string) => d.detectIntent(t).type

// --- cancel / delete / remove / skip open the reminder editor only for reminders ---
for (const t of ["Skip lunch today, I'm fasting", 'Remove duplicates from my grocery list', 'Cancel my Netflix subscription',
  'Delete the draft I wrote to Rahul', "skip dinner because I'm travelling", 'delete the email from Rahul', 'Cancel my flight booking',
  'Remove the duplicates in my shopping list', "Cancel the order, I've changed my mind"]) {
  assert.notEqual(type(t), 'edit_reminder', `"${t}" is not a reminder edit`)
}
for (const t of ['cancel 1', 'cancel water reminder', 'skip', 'skip it', 'skip water reminder today', 'delete my gym reminder',
  'remove reminder 2', 'cancel gym', 'skip the gym today', 'cancel', 'delete 3', 'snooze 2 for 10 mins', 'done 1', 'my reminders']) {
  assert.equal(type(t), 'edit_reminder', `"${t}" is still a reminder edit`)
}

// --- a weather word is a weather question only when the sentence asks ---
for (const t of ["Rain or shine, I'll be at the gym at 6am tomorrow", "I'll be at the gym tomorrow, rain or shine",
  "I'm running at 6am tomorrow whatever the weather", 'Let me take a rain check on dinner', 'direct trains from Bangalore to Mysuru']) {
  assert.notEqual(type(t), 'weather_live', `"${t}" is not a weather question`)
}
for (const t of ['weather in Bangalore', 'will it rain tomorrow', 'is it going to rain today', "what's the temperature", 'forecast for Mumbai',
  'rain today?', "I'm going to Goa tomorrow, how's the weather there", "I'll be in Pune on Friday, what is the weather like",
  'do I need an umbrella, is it raining', 'weather', 'Bangalore weather tomorrow']) {
  assert.equal(type(t), 'weather_live', `"${t}" is still a weather question`)
}

// --- a statement of the user's own plans is not a reminder request, an explicit ask still is ---
for (const t of ["Rain or shine, I'll be at the gym at 6am tomorrow", "I'll be at the airport tomorrow morning", "We'll meet on Friday at 5pm"]) {
  assert.notEqual(type(t), 'set_reminder', `"${t}" is a plan, not a reminder request`)
}
for (const t of ["Remind me I'll be at the gym at 6am tomorrow", 'remind me tomorrow at 6am to go to the gym', 'Gym tomorrow at 6am', 'call mom tomorrow at 8 pm']) {
  assert.equal(type(t), 'set_reminder', `"${t}" is still a reminder`)
}

// --- "remind me what ..." recalls; "remind me to ..." schedules ---
for (const t of ['Can you remind me what Srini told me about the Flipkart launch', 'remind me who I spoke to yesterday',
  'could you remind me where I parked', 'remind me how much I paid for the tickets', 'Remind me which hotel we booked']) {
  assert.notEqual(type(t), 'set_reminder', `"${t}" asks for a recall, it is not a reminder`)
}
for (const t of ['remind me to call mom tomorrow at 8 pm', 'Remind me what to buy at 5pm', 'remind me how to reset the router at 6pm',
  'remind me about the meeting at 5', 'remind me tomorrow to pay rent', 'remind me to check what Srini said at 4 pm']) {
  assert.equal(type(t), 'set_reminder', `"${t}" is still a reminder`)
}

// --- remove duplicates: pure dedupe + wiring ---
const core: any = await import('../lib/data/lists-core')
const item = (text: string, done = false) => ({ text, done, added_at: '2026-10-13T00:00:00Z' })
let r = core.dedupeListItems([item('milk'), item('Milk '), item('bread'), item('milk'), item('eggs')])
assert.deepEqual(r.items.map((i: any) => i.text), ['milk', 'bread', 'eggs'])
assert.equal(r.removed, 2)
r = core.dedupeListItems([item('rice', true), item('rice', true)])
assert.equal(r.items.length, 1); assert.equal(r.items[0].done, true, 'all copies done -> stays done')
r = core.dedupeListItems([item('rice', true), item('rice', false)])
assert.equal(r.items[0].done, false, 'a pending copy keeps it pending: never hide something still to buy')
assert.equal(core.dedupeListItems([item('a'), item('b')]).removed, 0)

const legacy = readFileSync(new URL('../lib/feature-intents-legacy.ts', import.meta.url), 'utf8')
assert.match(legacy, /legacy_list_dedupe/, 'dedupe is gated like every other list rule')
const literal = legacy.match(/const dedupeMatch = t\.match\((\/.*\/)\)/)
assert.ok(literal, 'dedupe matcher present')
const re = new Function(`return ${literal![1]}`)() as RegExp
for (const t of ['remove duplicates from my grocery list', 'delete the duplicates in groceries', 'clean up duplicates from my weekend list', 'please remove all duplicates from my todo list']) {
  assert.ok(re.test(t), `"${t}" is a de-duplicate request`)
}
for (const t of ['remove milk from my grocery list', 'remove reminder 2', 'cancel my subscription']) {
  assert.ok(!re.test(t), `"${t}" is not a de-duplicate request`)
}
const pim = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
assert.match(pim, /'PIM:intent', intent, 'semantic:'/, 'the gate input is logged next to its result')
console.log('reminder editor, weather and reminder-create read the whole sentence; remove-duplicates works on lists')
