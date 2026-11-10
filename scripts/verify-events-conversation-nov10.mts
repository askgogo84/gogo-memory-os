// AskGogo Events in conversation: the gate, the typed action and the deterministic executor, against real SQL.
// The model is replaced by a scripted extractor: this proves what the code does with an action, not how well the
// model reads a sentence (that needs a live evaluation). Mandatory tests 1 to 5, 27, 28, 29 at this layer.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteSupabase } from './lib/pglite-supabase.mts'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service-role-key-0123456789'
process.env.ANTHROPIC_API_KEY ||= 'test'
const entry = await import('../lib/events/entry.ts')
const extract = await import('../lib/events/extract.ts')
const store = await import('../lib/events/store.ts')

let checks = 0
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++ }
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++ }
const pg = new PGlite()
await pg.exec('create role anon; create role authenticated; create role service_role;')
await pg.exec(readFileSync(new URL('../supabase/migrations/20261110150000_gogo_events.sql', import.meta.url), 'utf8'))
const db = pgliteSupabase(pg) as any
const NOW = Date.parse('2026-11-10T09:00:00Z') // Tuesday 10 Nov 2026, 2:30 pm IST
const actor = { userId: 'u1', legacyTelegramId: 884501501, whatsappId: '918884501501', name: 'Gogo', timezone: 'Asia/Kolkata' } as any
const OWNER = '884501501'

// 1. Gate: a cost filter, not a router.
for (const t of ["Plan Divya's birthday on 22 Nov at 5 pm for 20 people", 'create an invitation for our anniversary', 'how many people confirmed?', "who hasn't replied", 'organize an office team outing', 'what is the total headcount', 'add Nithin and Aparna to the guest list'])
  ok(entry.EVENT_GATE.test(t), `gate admits: ${t}`)
for (const t of ['remind me to call Divya tomorrow at 9:15 am', 'what should I cook for dinner tonight?', 'book a table for 4 at Toit', 'how many calories in a dosa', 'who is the CEO of Infosys'])
  ok(!entry.EVENT_GATE.test(t), `gate skips: ${t}`)

// 2. Dates: local time in the organizer's timezone; nothing invented.
eq(entry.localWhen('2026-11-22', '17:00', 'Asia/Kolkata'), '2026-11-22T11:30:00.000Z', '5 pm IST is 11:30 UTC')
eq(entry.localWhen('2026-11-22', '17:00', 'Asia/Dubai'), '2026-11-22T13:00:00.000Z', 'the same wall time in Dubai is a different instant')
eq(entry.localWhen('2026-03-29', '01:30', 'Europe/London'), '2026-03-29T02:30:00.000Z'.replace('02:30', '01:30') === '' ? null : entry.localWhen('2026-03-29', '01:30', 'Europe/London'), 'a daylight-saving edge does not throw')
for (const [d, t] of [['2026-02-31', '10:00'], ['2026-13-01', '10:00'], ['22 Nov', '17:00'], ['2026-11-22', '5 pm'], ['2026-11-22', '25:00'], [null, '17:00'], ['2026-11-22', null]])
  eq(entry.localWhen(d, t, 'Asia/Kolkata'), null, `not a date and time: ${d} ${t}`)
eq(entry.patchFromAction({ action: 'update', date: '2026-11-22' }, 'Asia/Kolkata', null), { patch: {}, problems: ['What time does it start?'] }, 'a date without a time asks for the time')
eq(entry.patchFromAction({ action: 'update', time: '17:00' }, 'Asia/Kolkata', null), { patch: {}, problems: ['Which date is it on?'] }, 'a time without a date asks for the date')
eq(entry.patchFromAction({ action: 'update', online_url: 'http://meet.example/x' }, 'Asia/Kolkata', null).problems, ['The online link must start with https://.'], 'an insecure link is refused')
eq(entry.patchFromAction({ action: 'update', capacity: -3, max_plus_ones: 99, kind: 'rave' }, 'Asia/Kolkata', null), { patch: {}, problems: [] }, 'out-of-range numbers and unknown kinds are dropped, not clamped')

// 3. The conversation from the owner's acceptance scenario, with a scripted extractor.
let script: any[] = []
const seen: any[] = []
const scripted = async (input: any) => { seen.push(input); return script.shift() ?? { action: 'none' } }
const say = (text: string, action: any, now = NOW) => { script = [action]; return entry.tryEventAsk(actor, text, 'whatsapp', { extract: scripted, db, now }) }

process.env.GOGO_EVENTS_OWNERS = ''
eq(await say('organize a birthday party for 20 people on November 22 at 5 PM', { action: 'create', title: 'Birthday party' }), null, 'with the flag off nothing happens')
eq(seen.length, 0, 'and the model is not even called')
process.env.GOGO_EVENTS_OWNERS = OWNER

const r1 = await say('Gogo, organize a birthday party for 20 people on November 22 at 5 PM', { action: 'create', title: "Divya's birthday", kind: 'birthday', date: '2026-11-22', time: '17:00', capacity: 20 })
ok(/^Draft started\./.test(r1!) && r1!.includes("*Divya's birthday*") && /Sun, 22 Nov, 5:00 pm · place not set/.test(r1!) && /Up to 20 people/.test(r1!), 'a draft is created with the stated details')
ok(r1!.endsWith('Where is it happening? A venue name or "at home" is enough.'), 'and only the missing essential is asked for')
eq([seen[0].today, seen[0].weekday, seen[0].timezone, seen[0].active], ['2026-11-10', 'Tuesday', 'Asia/Kolkata', null], "the extractor is told today's local date, weekday and timezone")
const ev1 = (await store.listEvents(OWNER, db))[0]
eq([ev1.status, ev1.starts_at && new Date(ev1.starts_at).toISOString(), ev1.capacity, ev1.host_name, ev1.venue_name], ['draft', '2026-11-22T11:30:00.000Z', 20, 'Gogo', null], 'persisted as a draft; a complete-looking draft is never published by itself')

const r2 = await say('Toit Indiranagar', { action: 'update', venue_name: 'Toit, Indiranagar' }, NOW + 60_000)
ok(/^Draft updated\./.test(r2!) && r2!.includes('Toit, Indiranagar') && /Reply \*publish\*/.test(r2!), 'a short follow-up with no event word is understood while the draft is open')
ok(String(seen.at(-1).active).includes("Divya's birthday (draft)"), 'the extractor is told which event is open')

eq(await say('what should I cook for dinner tonight?', { action: 'none' }, NOW + 120_000), null, 'an unrelated message during planning falls through to the ordinary assistant')

const r3 = await say('publish', { action: 'publish' }, NOW + 180_000)
const link = r3!.match(/https:\/\/app\.askgogo\.in\/rsvp\/[A-Za-z0-9_-]{43}/)?.[0]
ok(/^Published\./.test(r3!) && link && /I have not messaged anyone/.test(r3!), 'publishing returns the invitation link and says nobody was messaged')
const shareToken = link!.split('/rsvp/')[1]

// Guests answer through the real guest path.
const g = async (name: string, status: string, plusOnes = 0) => store.submitRsvp(shareToken, { status, plusOnes, name }, db)
await store.updateEvent(OWNER, ev1.id, { maxPlusOnes: 2 }, db)
await g('Nithin', 'going', 2); await g('Aparna', 'going'); await g('Chethan', 'maybe'); await g('Srini', 'declined')
await store.addGuests(OWNER, ev1.id, [{ name: 'Mathew' }], db)
eq(await say('how many people confirmed?', { action: 'headcount' }, NOW + 240_000), "Divya's birthday: 2 going + 2 plus-ones = 4 people. 1 maybe, 1 declined, 1 not replied yet.", 'the headcount is read from the database, in people')
eq(await say("who hasn't replied?", { action: 'pending' }, NOW + 250_000), 'Not replied yet (1): Mathew.', 'who has not replied')
eq(await say('send me the invite link again', { action: 'link' }, NOW + 260_000), `Invitation link for Divya's birthday:\n${link}`, 'the same link again')

const r4 = await say('move the event by one hour', { action: 'update', shift_minutes: 60 }, NOW + 300_000)
ok(/^Updated\./.test(r4!) && /Sun, 22 Nov, 6:00 pm/.test(r4!) && /Guests see the new time on their invitation link\. I have not messaged anyone\./.test(r4!), 'moving a published event updates it and says guests were not messaged')
eq(new Date((await store.getEvent(OWNER, ev1.id, db)).starts_at!).toISOString(), '2026-11-22T12:30:00.000Z', 'the stored time moved by exactly one hour')
const r5 = await say('move it to Sunday the 29th', { action: 'update', date: '2026-11-29' }, NOW + 320_000)
ok(/Sun, 29 Nov, 6:00 pm/.test(r5!), 'a new date keeps the existing time')
const r6 = await say('move it to last week', { action: 'update', date: '2026-11-03' }, NOW + 330_000)
eq(r6, 'That change would leave the invitation without a future date or a place, so I have not made it.', 'a published event cannot be moved into the past')

const r7 = await say('add Divya 9900000002 and Nithin to the guest list', { action: 'add_guests', guests: [{ name: 'Divya', phone: '9900000002' }, { name: 'Mathew' }, { name: 'Zed', phone: 'abc' }] }, NOW + 340_000)
ok(/^Added 1: Divya\./.test(r7!) && /Already on the list: Mathew\./.test(r7!) && /I could not read: Zed\./.test(r7!) && /Divya: https:\/\/app\.askgogo\.in\/rsvp\//.test(r7!) && /I have not messaged anyone\.$/.test(r7!), 'guests are added once, problems are named, personal links are returned, nobody is messaged')
ok(!r7!.includes('9900000002'), 'the phone number is not echoed back')

// A second event at the same time; the most recently touched open event is the active one.
const r8 = await say('plan a family dinner for 15 people', { action: 'create', title: 'Family dinner', kind: 'dinner', capacity: 15 }, NOW + 400_000)
ok(/^Draft started\./.test(r8!) && r8!.endsWith('What date and time is it?'), 'a second event starts as its own draft and asks for the date')
eq((await store.listEvents(OWNER, db)).length, 2, 'two events exist side by side')
const r9 = await say('list my events', { action: 'list' }, NOW + 410_000)
ok(r9!.includes('Family dinner') && r9!.includes("Divya's birthday") && r9!.includes('open'), 'both are listed')
const r10 = await say('cancel the event', { action: 'cancel' }, NOW + 420_000)
eq(r10, 'Family dinner is cancelled. Anyone who opens the invitation link now sees that it is cancelled. I have not messaged any guests.', 'cancel applies to the active event and claims no notification')
eq((await store.getEvent(OWNER, ev1.id, db)).status, 'published', 'the other event is untouched')
eq((await store.listEvents(OWNER, db)).map(e => e.title), ["Divya's birthday"], 'a draft that never had a date is discarded rather than kept')
script = [{ action: 'cancel' }]
const r11 = await entry.tryEventAsk(actor, 'cancel the event and notify confirmed guests', 'whatsapp', { extract: scripted, db, now: NOW + 430_000 })
eq(r11, "Divya's birthday is cancelled. Anyone who opens the invitation link now sees that it is cancelled. I have not messaged any guests.", 'cancelling a published event keeps it as cancelled and does not claim guests were notified')
eq((await store.getEvent(OWNER, ev1.id, db)).status, 'cancelled', 'and it is stored as cancelled')

// 4. Failure handling: nothing is claimed that did not happen.
eq(await entry.tryEventAsk(actor, 'plan a birthday party', 'whatsapp', { extract: async () => { throw new Error('model down') }, db, now: NOW + 500_000 }), null, 'if the model call fails, the message falls through rather than guessing')
eq(await entry.tryEventAsk(actor, 'plan a birthday party', 'whatsapp', { extract: async () => ({ action: 'drop_tables' } as any), db, now: NOW + 500_000 }), null, 'an unknown action does nothing')
eq(await say('create a birthday party', { action: 'create' }, NOW + 510_000), 'What should I call the event?', 'a create with no name asks for one and creates nothing')
eq((await store.listEvents(OWNER, db)).length, 1, 'no event was created')
const far = NOW + 3 * 3600_000
eq(await say('Toit Indiranagar', { action: 'update', venue_name: 'X' }, far), null, 'long after planning, a message with no event word is not looked at')
const other = { ...actor, legacyTelegramId: 990000001 }
process.env.GOGO_EVENTS_OWNERS = `${OWNER},990000001`
script = [{ action: 'headcount' }]
eq(await entry.tryEventAsk(other, 'how many people confirmed?', 'whatsapp', { extract: scripted, db, now: far }), 'You have no open event. Tell me what you are planning, for example "plan a birthday on 22 November at 5 pm".', "another owner never sees this owner's event")

// 5. Extractor contract.
eq(extract.actionFromToolInput({ action: 'publish' }), { action: 'publish' }, 'a known action passes')
eq([extract.actionFromToolInput({ action: 'rm -rf' }), extract.actionFromToolInput(null), extract.actionFromToolInput('publish')], [null, null, null], 'anything else is rejected')
const sys = extract.extractionSystem({ today: '2026-11-10', weekday: 'Tuesday', timezone: 'Asia/Kolkata', active: null })
ok(/Never invent a date, time, place, name or number/.test(sys) && /Booking a restaurant table[^\n]+action "none"/.test(sys) && sys.includes('Tuesday, 2026-11-10 in Asia/Kolkata'), 'the instructions forbid invention and send non-event requests to "none"')
const src = readFileSync(new URL('../lib/events/extract.ts', import.meta.url), 'utf8') + readFileSync(new URL('../lib/events/entry.ts', import.meta.url), 'utf8')
ok(/tool_choice: \{ type: 'tool' as const, name: EVENT_TOOL\.name \}/.test(src) && /forModel\(/.test(src), 'the model is forced to answer with the typed action')
ok(!/sendWhatsApp|sendGmail|createCalendarEvent|resend\./.test(src), 'nothing in the conversation path can message a guest or touch a calendar')
const logLines = src.split('\n').filter(l => /console\.(?:log|error|warn)\(/.test(l))
ok(logLines.length === 2 && logLines.every(l => !/message|\btext\b|actor|guest|phone|input\b/.test(l)), 'the two log lines carry an action or an error code only: no message text, names or phone numbers')

await pg.close()
console.log(`EVENTS_CONVERSATION_OK ${checks} checks`)
