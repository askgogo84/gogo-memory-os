// 20 Nov (handoff section 8, owner screenshots and a production log):
//  - "Fill petrol morning": the part of day beside the day word stayed in the reminder text, and "tomorrow evening" fired at 9 am.
//  - A reminder carried a model's scheduling note ("…included the note Time is not specified, so use Asia/Kolkata").
//  - "Stop this reminder" (19 Nov) was read as chat.
//  - "Can you call … and book …" was not picked up.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const rem: any = await import('../lib/bot/handlers/reminders')
const edit: any = await import('../lib/bot/handlers/edit-reminder')
const { detectIntent }: any = await import('../lib/bot/detect-intent')
const voice: any = await import('../lib/agent/voice-call')
const istHour = (iso: string) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date(iso)))
const parse = (t: string) => rem.parseReminderIntent(t)

// Part of day beside the day word sets the time and leaves the text.
for (const [t, msg, hour] of [
  ['remind me to fill petrol tomorrow morning', 'fill petrol', 9],
  ['remind me tomorrow morning to fill petrol', 'fill petrol', 9],
  ['fill petrol tomorrow morning remind me', 'fill petrol', 9],
  ['remind me to call Nithin tomorrow evening', 'call Nithin', 18],
  ['remind me to take the bins out tomorrow night', 'take the bins out', 21],
  ['remind me tomorrow afternoon to pay the electrician', 'pay the electrician', 14],
] as const) {
  const p = parse(t); assert.ok(p, t)
  assert.equal(String(p.message).toLowerCase(), msg.toLowerCase(), t)
  assert.equal(istHour(p.remindAtIso), hour, `${t} → ${p.remindAtIso}`)
}
// A clock time still wins over the part of day; a "morning" that belongs to the task stays.
{ const p = parse('remind me to fill petrol tomorrow morning at 7:30am'); assert.equal(istHour(p.remindAtIso), 7); assert.doesNotMatch(p.message, /morning/i) }
assert.match(parse('remind me tomorrow at 8am to buy the morning newspaper').message, /morning newspaper/i)
assert.match(parse('remind me tomorrow at 6pm to book the evening show').message, /evening show/i)
assert.equal(rem.dropDayPart('send the good morning message tomorrow'), 'send the good morning message tomorrow')
{ const p = parse('remind me on Sunday evening to call Divya'); assert.ok(p); assert.doesNotMatch(p.message, /evening/i); assert.match(p.message, /call Divya/i); assert.equal(istHour(p.remindAtIso), 18) }
console.log('✓ "tomorrow morning" / "Sunday evening" set the time and stay out of the reminder text')

// A model's scheduling note never becomes reminder text.
assert.equal(rem.stripSchedulingNote('Submit Jeevan Praman and included the note Time is not specified, so use Asia/Kolkata'), 'Submit Jeevan Praman')
assert.equal(rem.stripSchedulingNote('Submit Jeevan Praman. Time is not specified, so use Asia/Kolkata.'), 'Submit Jeevan Praman.')
assert.equal(rem.stripSchedulingNote('Renew passport (timezone: Asia/Kolkata)'), 'Renew passport')
assert.equal(rem.stripSchedulingNote('Check the time zone for the Dubai call'), 'Check the time zone for the Dubai call')
assert.equal(rem.stripSchedulingNote('Note: buy milk'), 'Note: buy milk')
{ const p = parse('remind me tomorrow at 10am to submit Jeevan Praman and included the note Time is not specified, so use Asia/Kolkata'); assert.ok(p); assert.doesNotMatch(p.message, /not specified|Kolkata|included the note/i, p.message); assert.match(p.message, /Jeevan Praman/i) }
console.log('✓ a scheduling note is dropped; ordinary text that mentions a time zone is kept')

// "Stop this reminder" is a reminder command, for one reminder only.
for (const t of ['Stop this reminder', 'stop this reminder.', 'stop reminder', 'stop that reminder', 'please stop the water reminder', 'stop my drink water reminder']) {
  assert.equal(edit.isCancelReminderCommand(t), true, t)
  assert.equal(detectIntent(t).type, 'edit_reminder', `detectIntent: ${t}`)
}
assert.equal(edit.isDeicticReminderRef('stop this reminder'), true, '"this" means the reminder just shown, never the newest row')
assert.equal(edit.extractCancelQuery('stop the water reminder'), 'water')
for (const t of ['stop all reminders', 'stop reminders', 'stop sending me reminders', 'stop reminding me', 'stop', 'stop the music', 'stop this', 'stop every reminder', 'stop this reminder and tell me a joke about it too because I am bored and want a laugh today']) {
  assert.equal(edit.isStopOneReminder(t), false, t)
}
// The widened rule adds nothing for the plural or "all": those route exactly as they did before this change.
for (const t of ['stop all reminders', 'stop sending me reminders', 'stop reminding me', 'stop the music']) assert.notEqual(detectIntent(t).type === 'edit_reminder' && !/^stop reminder\b/.test(t) && edit.isStopOneReminder(t), true, t)
console.log('✓ "stop this reminder" reaches the reminder handler; plural, "all" and bare stop do not')

// A polite lead-in before call is dropped; the rules after it are unchanged.
assert.equal(voice.callLead('Can you call Novotel on 8310441698 and book a room for 2 nights?'), 'call Novotel on 8310441698 and book a room for 2 nights')
for (const t of ['Can you call Novotel on 8310441698 and book a room for 2 nights on Saturday under name Divya?', 'could you please call Toit Indiranagar and book a table for 2 at 9pm on Saturday', 'Hey Gogo, can you call Toit Indiranagar and book a table for 2 at 9pm', 'I want you to call Novotel on 8310441698 and ask about parking', 'kindly call Toit Indiranagar and reserve a table for 4'])
  assert.equal(voice.parseCallCommand(t)?.kind, 'book', t)
assert.match(voice.parseCallCommand('Can you call Novotel on 8310441698 and book a room?').text, /^call Novotel/)
// Still not a business call: family, a note to self, a question about calling, and an approval needs its exact words.
for (const t of ['can you call mom and ask about lunch tomorrow', 'can you call the dentist tomorrow to confirm', 'can you call?', 'can you make calls?', 'should I call Nithin and ask about the deck?', 'can you remind me to call Novotel and book a room'])
  assert.notEqual(voice.parseCallCommand(t)?.kind, 'book', t)
assert.equal(voice.parseCallCommand('can you call them')?.kind ?? null, voice.parseCallCommand('call them')?.kind ?? null, 'a lead-in changes nothing else')
assert.equal(voice.parseCallCommand('yes call')?.kind, 'approve')
// The two surface gates let the lead-in through to the parser.
const fs = await import('node:fs')
for (const f of ['../app/api/webhooks/whatsapp/route.ts', '../app/api/dashboard/chat/route.ts']) {
  const gate = fs.readFileSync(new URL(f, import.meta.url), 'utf8').match(/\/\^\\s\*\(\?:\[a-z,!'\]\+\\s\+\)\{0,6\}\(\?:call\|phone\|ring\)\\s\/i/)
  assert.ok(gate, f)
  assert.ok(/^\s*(?:[a-z,!']+\s+){0,6}(?:call|phone|ring)\s/i.test('Hey Gogo, can you please call Novotel on 8310441698 and book a room'))
}
console.log('✓ "Can you call … and book …" is a call request; family, notes to self and questions are not')
