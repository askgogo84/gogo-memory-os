// Plain words for the event-draft status header (lib/agent/voice.ts). By rule, in code: no model.
import assert from 'node:assert/strict'
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, e: unknown, m: string) => { assert.deepEqual(a, e, m); checks++ }
const v = await import('../lib/agent/voice')

eq([v.voiceEnabledFor('-884501501', {}), v.voiceEnabledFor('-884501501', { GOGO_VOICE: 'on' }), v.voiceEnabledFor('-884501501', { GOGO_VOICE: '-884501501, 12' }), v.voiceEnabledFor('884501501', { GOGO_VOICE: '-884501501' }), v.voiceEnabledFor('', { GOGO_VOICE: '-884501501' })], [false, true, true, false, false], 'off unless switched on, for exact owner ids')

// The owner's two live replies (11 Nov), and each combination of what is known.
const NEXT_Q = 'Where is it happening? A venue name or "at home" is enough.', NEXT_P = 'Reply *publish* to get the invitation link, or tell me what to change.'
const cases: [string, string][] = [
  [`Draft started.\n\n*Divya’s birthday*\nSun, 22 Nov, 5:00 pm · place not set\n\n${NEXT_Q}`, `I’ve started planning *Divya’s birthday* for Sun, 22 Nov, 5:00 pm.\n\n${NEXT_Q}`],
  [`Draft updated.\n\n*Divya’s birthday*\nSun, 22 Nov, 5:00 pm · Dali and Gala Bangalore\n\n${NEXT_P}`, `Noted. *Divya’s birthday*: Sun, 22 Nov, 5:00 pm at Dali and Gala Bangalore.\n\n${NEXT_P}`],
  [`Draft started.\n\n*Team dinner*\nFri, 4 Dec, 8:00 pm · Toit Indiranagar\n\n${NEXT_P}`, `I’ve started planning *Team dinner*: Fri, 4 Dec, 8:00 pm at Toit Indiranagar.\n\n${NEXT_P}`],
  [`Draft started.\n\n*Team dinner*\ndate not set · Toit Indiranagar\n\nWhat time does it start?`, `I’ve started planning *Team dinner* at Toit Indiranagar.\n\nWhat time does it start?`],
  [`Draft started.\n\n*Team dinner*\ndate not set · place not set\n\nWhat time does it start?`, `I’ve started planning *Team dinner*.\n\nWhat time does it start?`],
  [`Draft updated.\n\n*Team dinner*\nFri, 4 Dec, 8:00 pm · place not set\n\n${NEXT_Q}`, `Noted. *Team dinner*: Fri, 4 Dec, 8:00 pm. The place is still open.\n\n${NEXT_Q}`],
  [`Draft updated.\n\n*Team dinner*\ndate not set · Toit Indiranagar\n\nWhich date is it on?`, `Noted. *Team dinner* at Toit Indiranagar. The date is still open.\n\nWhich date is it on?`],
  [`Draft updated.\n\n*Team dinner*\ndate not set · place not set\n\nWhich date is it on?`, `Noted. *Team dinner*: the date and place are still open.\n\nWhich date is it on?`],
  // Extra lines (people, dress code) and everything after the blank line are kept exactly.
  [`Draft updated.\n\n*Team dinner*\nFri, 4 Dec, 8:00 pm · Toit Indiranagar\n20 people · smart casual\n\n${NEXT_P}\n\nNext step: booking Toit Indiranagar for 20. I could not find their official site, so I have not drafted anything.`, `Noted. *Team dinner*: Fri, 4 Dec, 8:00 pm at Toit Indiranagar.\n20 people · smart casual\n\n${NEXT_P}\n\nNext step: booking Toit Indiranagar for 20. I could not find their official site, so I have not drafted anything.`],
]
for (const [o, want] of cases) eq(v.eventDraftInPlainWords(o), want, `said plainly: ${want.split('\n')[0]}`)

// Nothing is lost: every word of the name, when, where and everything after them is still there, in order.
for (const [o] of cases) {
  const out = v.eventDraftInPlainWords(o), body = o.replace(/^Draft (?:started|updated)\.\n\n/, '')
  const [first, ...rest] = body.split('\n\n')
  const [name, line, ...extras] = first.split('\n'), [when, where] = line.split(' · ')
  ok(out.includes(name) && (when === 'date not set' || out.includes(when)) && (where === 'place not set' || out.includes(where)) && extras.every(x => out.includes(x)) && out.endsWith(rest.join('\n\n')), 'name, when, where, extra lines and the whole next step survive exactly')
  ok(!/Draft (?:started|updated)\.|not set/.test(out.split('\n\n')[0]), 'and the status words are gone')
}

// Every other reply is returned exactly as written: published changes, confirmations, guest lists, links, errors.
const untouched = [
  'Updated.\n\n*Divya’s birthday*\nSun, 22 Nov, 5:00 pm · Dali and Gala Bangalore',
  'Published *Divya’s birthday*. Forward this link to your guests:\nhttps://askgogo.in/e/abc123\n\nI have not messaged anyone.',
  'Cancel *Divya’s birthday* (Sun, 22 Nov, 5:00 pm)? Guests who open their invitation link will see it is cancelled, and this cannot be undone. Reply *yes* to confirm.',
  'Move *Divya’s birthday* from Sun, 22 Nov, 5:00 pm to Mon, 23 Nov, 7:00 pm? Reply *yes* to confirm.',
  'Divya’s birthday: 12 going + 3 plus-ones = 15 people. 4 maybe, 2 declined, 6 not replied yet.',
  'Added 2 to *Divya’s birthday*: Nithin, Asha.\nNithin: https://askgogo.in/g/aaa\nAsha: https://askgogo.in/g/bbb\nI have not messaged anyone.',
  'What should I call the event?', 'That did not work, so nothing was changed. Please try again.', '',
  'Draft started.', 'Draft updated.\n\n*X*', 'Draft started.\n\n*X*\nno separator here\n\nNext',
  'draft started.\n\n*X*\nSun, 22 Nov, 5:00 pm · Y\n\nNext', ' Draft started.\n\n*X*\nSun, 22 Nov, 5:00 pm · Y\n\nNext',
  'Draft started.\n\nX without bold\nSun, 22 Nov, 5:00 pm · Y\n\nNext',
]
for (const t of untouched) eq(v.eventDraftInPlainWords(t), t, `unchanged: ${t.slice(0, 44) || '(empty)'}`)

// Review: a partly failed update is not "Noted."; an online event is "online".
eq(v.eventDraftInPlainWords('Draft updated.\n\n*X*\nSun, 22 Nov, 5:00 pm · Toit\n\nI could not read that date and time.'), 'Saved the rest. *X*: Sun, 22 Nov, 5:00 pm at Toit.\n\nI could not read that date and time.', 'a part that could not be used is not acknowledged as done')
eq(v.eventDraftInPlainWords(`Draft started.\n\n*Team call*\nFri, 4 Dec, 8:00 pm · Online\n\n${NEXT_P}`), `I’ve started planning *Team call*: Fri, 4 Dec, 8:00 pm online.\n\n${NEXT_P}`, 'an online event reads "online"')
// The switch and the kind.
const env = { GOGO_VOICE: '-884501501' }, D = cases[1][0]
eq(v.inGogosVoice({ owner: '-884501501', reply: D, kind: 'events' }, { env }), cases[1][1], 'on for the owner: the plain version')
eq(v.inGogosVoice({ owner: '999', reply: D, kind: 'events' }, { env }), D, 'another person: unchanged')
eq(v.inGogosVoice({ owner: '-884501501', reply: D, kind: 'events' }, { env: {} }), D, 'switch unset: unchanged')
eq(v.inGogosVoice({ owner: '-884501501', reply: D, kind: 'goal_plan' }, { env }), D, 'only Events replies are touched')
eq(v.inGogosVoice(null as any), '', 'bad input never throws')

// Wiring and the rule that no model is involved.
{ const { readFileSync } = await import('node:fs')
  const rd = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const src = rd('../lib/agent/voice.ts'), wa = rd('../app/api/webhooks/whatsapp/route.ts'), pm = rd('../lib/bot/process-message.ts'), dash = rd('../app/api/dashboard/chat/route.ts')
  ok(!/^import /m.test(src) && !/anthropic|openai|messages\.create|fetch\(/i.test(src.replace(/^\/\/.*$/gm, '')), 'the voice file imports nothing and calls no model or network')
  ok(/const eventSaid = process\.env\.GOGO_VOICE \? await import\('@\/lib\/agent\/voice'\)[^\n]+\(\) => eventReply\) : eventReply\n\s+await saveConversation\(resolvedUser\.telegramId, 'user', text\)\n\s+await saveConversation\(resolvedUser\.telegramId, 'assistant', eventSaid\)\n\s+await sendWhatsAppMessage\(from, eventSaid\)/.test(wa), 'WhatsApp Events: not loaded without the variable, original on failure, and the same words are saved and sent')
  ok(/const eventSaid=eventsEnv\.GOGO_VOICE\?await import\('@\/lib\/agent\/voice'\)[^\n]+\(\)=>eventReply\):eventReply/.test(pm), 'the later Events hook is wired the same way')
  ok(/const eventSaid=process\.env\.GOGO_VOICE\?/.test(dash) && /text:eventSaid,handledBy:'events'/.test(dash), 'and the dashboard chat')
  ok(!/inGogosVoice/.test(rd('../lib/events/entry.ts')) && !/inGogosVoice|voice\b/.test(rd('../lib/agent/goal-intake.ts')), 'Events and goal intake themselves are untouched, so goal intake still reads "Draft started."') }
console.log(`GOGO_VOICE_OK ${checks} checks`)
