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
// Review (20 Nov): a part of day that belongs to the task keeps its place and never moves the time.
for (const [t, keep] of [
  ['remind me tomorrow to watch Saturday Night Live', /night live/i],
  ['remind me tomorrow to buy tickets for the Saturday night show', /night show/i],
  ['remind me to book Friday evening show tickets tomorrow', /evening show tickets/i],
] as const) { const p = parse(t); assert.ok(p, t); assert.match(p.message, keep, `${t} → ${p.message}`); assert.equal(istHour(p.remindAtIso), 9, t) }
assert.equal(rem.dropDayPart('in 2 hours to cancel the Friday night table'), 'in 2 hours to cancel the Friday night table')
assert.equal(rem.dropDayPart('call Nithin in the evening tomorrow'), 'call Nithin tomorrow')
{ const p = parse('remind me on Friday to prepare for Monday morning standup'); assert.ok(p); assert.match(p.message, /morning standup/i, p.message) }
console.log('✓ "tomorrow morning" / "Sunday evening" set the time and stay out of the reminder text')

// A model's scheduling note never becomes reminder text.
assert.equal(rem.stripSchedulingNote('Submit Jeevan Praman and included the note Time is not specified, so use Asia/Kolkata'), 'Submit Jeevan Praman')
assert.equal(rem.stripSchedulingNote('Submit Jeevan Praman. Time is not specified, so use Asia/Kolkata.'), 'Submit Jeevan Praman')
assert.equal(rem.stripSchedulingNote('Renew passport (timezone: Asia/Kolkata)'), 'Renew passport')
assert.equal(rem.stripSchedulingNote('Check the time zone for the Dubai call'), 'Check the time zone for the Dubai call')
assert.equal(rem.stripSchedulingNote('Note: buy milk'), 'Note: buy milk')
{ const p = parse('remind me tomorrow at 10am to submit Jeevan Praman and included the note Time is not specified, so use Asia/Kolkata'); assert.ok(p); assert.doesNotMatch(p.message, /not specified|Kolkata|included the note/i, p.message); assert.match(p.message, /Jeevan Praman/i) }
for (const t of ['check that Divya included the note about pricing in the deck', 'tell Nithin the time is not specified in the invite and ask him to fix it', 'set the Vercel cron to use Asia/Kolkata instead of UTC and redeploy', 'change the config timezone: Asia/Kolkata and redeploy the app', 'fix the bug where no time is specified for all-day events', 'reply to Nithin, note: time zone for the Dubai call is GST, and send the agenda'])
  assert.equal(rem.stripSchedulingNote(t), t, t)
assert.match((await import('node:fs')).readFileSync(new URL('../lib/agent/mission-tools.ts', import.meta.url), 'utf8'), /return safe\(stripSchedulingNote\(/, 'the plan-step reminder text is cleaned too')
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
// Review (20 Nov): politeness and punctuation never become a reminder name to search for ("now" matched "Let Nithin know").
{
  const phrase: any = await import('../lib/bot/stop-reminder-phrase')
  for (const t of ['stop this reminder now', 'stop this reminder.', 'please stop this reminder', 'pls stop that reminder pls', 'Stop this reminder now!']) {
    const core = phrase.stopReminderCore(t).toLowerCase()
    assert.equal(core.replace(/^stop (?:this|that) reminder$/, 'OK'), 'OK', `${t} → ${core}`)
    assert.equal(edit.isDeicticReminderRef(core), true, t)
  }
  assert.equal(edit.extractCancelQuery(phrase.stopReminderCore('please stop the water reminder').toLowerCase()), 'water')
  assert.equal(edit.extractCancelQuery(phrase.stopReminderCore('pls stop the gym reminder pls').toLowerCase()), 'gym')
  // The older "stop reminder <which>" forms still cancel.
  for (const t of ['stop reminder 3', 'stop reminder drink water']) { assert.equal(edit.isCancelReminderCommand(t), true, t); assert.equal(detectIntent(t).type, 'edit_reminder', t) }
  // One definition: the brain stands aside, and the handler and the intent rule cannot disagree.
  const brain: any = await import('../lib/agent/brain')
  for (const t of ['Stop this reminder', 'stop the water reminder']) assert.equal(brain.isExactCommand(t), true, t)
  for (const t of ['stop the all-hands reminder', 'stop the every-day reminder', 'stop the music', 'stop all reminders']) {
    assert.equal(phrase.isStopOneReminder(t), false, t); assert.equal(brain.isExactCommand(t), false, t)
  }
  // "This" means the reminder that just went off (the job never writes to the chat history), and a deictic stop never
  // falls back to a name search.
  const src = (await import('node:fs')).readFileSync(new URL('../lib/bot/handlers/edit-reminder.ts', import.meta.url), 'utf8')
  assert.match(src, /if \(stopOne && isDeicticReminderRef\(lower\)\) \{\s+const fired = await reminderFiredSinceLastReply\(telegramId\)/)
  assert.match(src, /if \(!reminder && !\(stopOne && isDeicticReminderRef\(lower\)\)\) \{\s+const query = extractCancelQuery/)
  assert.match(src, /\.not\('sent_at', 'is', null\)\.gte\('sent_at', cut\)/)
}
console.log('✓ "stop this reminder" reaches the reminder handler; plural, "all" and bare stop do not')

// A polite lead-in before call is dropped; the rules after it are unchanged.
assert.equal(voice.callLead('Can you call Novotel on 8310441698 and book a room for 2 nights?'), 'call Novotel on 8310441698 and book a room for 2 nights')
for (const t of ['Can you call Novotel on 8310441698 and book a room for 2 nights on Saturday under name Divya?', 'could you please call Toit Indiranagar and book a table for 2 at 9pm on Saturday', 'Hey Gogo, can you call Toit Indiranagar and book a table for 2 at 9pm', 'I want you to call Novotel on 8310441698 and ask about parking', 'kindly call Toit Indiranagar and reserve a table for 4'])
  assert.equal(voice.parseCallCommand(t)?.kind, 'book', t)
assert.match(voice.parseCallCommand('Can you call Novotel on 8310441698 and book a room?').text, /^call Novotel/)
// Still not a business call: family, a note to self, a question about calling, and an approval needs its exact words.
for (const t of ['can you call mom and ask about lunch tomorrow', 'can you call the dentist tomorrow to confirm', 'can you call?', 'can you make calls?', 'should I call Nithin and ask about the deck?', 'can you remind me to call Novotel and book a room'])
  assert.notEqual(voice.parseCallCommand(t)?.kind, 'book', t)
// A question is never the yes to a shown plan, and never a redial.
for (const t of ['can you call?', 'can you call them?', 'could you call now?', 'will you call them', 'can you call again?']) assert.equal(voice.parseCallCommand(t), null, t)
assert.equal(voice.parseCallCommand('call them')?.kind, 'approve')
assert.equal(voice.parseCallCommand('yes call')?.kind, 'approve')
// Both surfaces: the gate lets the lead-in reach the parser, and the line that loads the call flow honours the gate's
// decision (review: the loader had its own anchored test, so the plan never appeared).
const fs = await import('node:fs')
for (const f of ['../app/api/webhooks/whatsapp/route.ts', '../app/api/dashboard/chat/route.ts']) {
  const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8')
  assert.ok(src.includes("/^\\s*(?:[a-z,!']+\\s+){0,6}(?:call|phone|ring)\\s/i.exec(text) !== null"), `${f}: gate`)
  const loader = src.split('\n').find((l: string) => /const voiceMod\s*:\s*any\s*=/.test(l)) || ''
  assert.match(loader, /\.test\(text\) \|\| callCommand \|\| \(/, `${f}: loader honours callCommand`)
  assert.ok(src.indexOf('const callCommand') < src.indexOf(loader) && src.indexOf('const callCommand') > -1, `${f}: callCommand is defined before the loader`)
}
assert.ok(/^\s*(?:[a-z,!']+\s+){0,6}(?:call|phone|ring)\s/i.test('Hey Gogo, can you please call Novotel on 8310441698 and book a room'))
console.log('✓ "Can you call … and book …" is a call request; family, notes to self and questions are not')
