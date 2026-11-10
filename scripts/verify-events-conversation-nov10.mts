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
process.env.GOGO_EVENTS_TOKEN_SECRET = 'fixture-events-token-secret-0123456789abcdef'
const entry = await import('../lib/events/entry.ts')
const extract = await import('../lib/events/extract.ts')
const store = await import('../lib/events/store.ts')

let checks = 0
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++ }
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++ }
const pg = new PGlite()
await pg.exec('create role anon; create role authenticated; create role service_role;')
await pg.exec(readFileSync(new URL('../supabase/migrations/20261110150000_gogo_events.sql', import.meta.url), 'utf8'))
await pg.exec(readFileSync(new URL('../supabase/migrations/20261110170000_gogo_events_v2.sql', import.meta.url), 'utf8'))
const db = pgliteSupabase(pg) as any
const NOW = Date.parse('2037-11-10T09:00:00Z') // Tuesday 10 Nov 2037, 2:30 pm IST
const actor = { userId: 'u1', legacyTelegramId: 884501501, whatsappId: '918884501501', name: 'Gogo', timezone: 'Asia/Kolkata' } as any
const OWNER = '884501501'
// The scenario runs on its own clock in 2037 (the same calendar as 2026, so weekdays match), far enough ahead that
// its fixed dates stay in the future whenever CI runs. The store writes timestamps from the same clock.
let clock = 0
store.setEventsClockForTests(() => clock)
const tryAt: typeof entry.tryEventAsk = (a, t, s, d = {}) => { if (d.now) clock = d.now; return entry.tryEventAsk(a, t, s, d) }
const tokenOf = (url: string) => url.split('/rsvp/')[1]

// 1. Gate: a cost filter, not a router.
for (const t of ["Plan Divya's birthday on 22 Nov at 5 pm for 20 people", 'create an invitation for our anniversary', 'how many people confirmed?', "who hasn't replied", 'organize an office team outing', 'what is the total headcount', 'add Nithin and Aparna to the guest list', 'Plan a family dinner for 15 people', 'organise a farewell lunch for the team'])
  ok(entry.EVENT_GATE.test(t), `gate admits: ${t}`)
for (const t of ['remind me to call Divya tomorrow at 9:15 am', 'what should I cook for dinner tonight?', 'book a table for 4 at Toit', 'how many calories in a dosa', 'who is the CEO of Infosys', 'plan my day', 'cancel it', 'what is for dinner'])
  ok(!entry.EVENT_GATE.test(t), `gate skips: ${t}`)

// 2. Dates: local time in the organizer's timezone; nothing invented.
eq(entry.localWhen('2037-11-22', '17:00', 'Asia/Kolkata'), '2037-11-22T11:30:00.000Z', '5 pm IST is 11:30 UTC')
eq(entry.localWhen('2037-11-22', '17:00', 'Asia/Dubai'), '2037-11-22T13:00:00.000Z', 'the same wall time in Dubai is a different instant')
eq(entry.localWhen('2037-03-29', '01:30', 'Europe/London'), '2037-03-29T02:30:00.000Z'.replace('02:30', '01:30') === '' ? null : entry.localWhen('2037-03-29', '01:30', 'Europe/London'), 'a daylight-saving edge does not throw')
for (const [d, t] of [['2037-02-31', '10:00'], ['2037-13-01', '10:00'], ['22 Nov', '17:00'], ['2037-11-22', '5 pm'], ['2037-11-22', '25:00'], [null, '17:00'], ['2037-11-22', null]])
  eq(entry.localWhen(d, t, 'Asia/Kolkata'), null, `not a date and time: ${d} ${t}`)
eq(entry.patchFromAction({ action: 'update', date: '2037-11-22' }, 'Asia/Kolkata', null), { patch: {}, problems: ['What time does it start?'] }, 'a date without a time asks for the time')
eq(entry.patchFromAction({ action: 'update', time: '17:00' }, 'Asia/Kolkata', null), { patch: {}, problems: ['Which date is it on?'] }, 'a time without a date asks for the date')
eq(entry.patchFromAction({ action: 'update', online_url: 'http://meet.example/x' }, 'Asia/Kolkata', null).problems, ['The online link must start with https://.'], 'an insecure link is refused')
eq(entry.patchFromAction({ action: 'update', capacity: -3, max_plus_ones: 99, kind: 'rave' }, 'Asia/Kolkata', null), { patch: {}, problems: [] }, 'out-of-range numbers and unknown kinds are dropped, not clamped')

// 3. The conversation from the owner's acceptance scenario, with a scripted extractor.
let script: any[] = []
const seen: any[] = []
const scripted = async (input: any) => { seen.push(input); return script.shift() ?? { action: 'none' } }
const say = (text: string, action: any, now = NOW) => { script = [action]; return tryAt(actor, text, 'whatsapp', { extract: scripted, db, now }) }
const status = async (title: string) => (await store.listEvents(OWNER, db)).find(e => e.title === title)?.status ?? 'gone'

process.env.GOGO_EVENTS_OWNERS = ''
eq(await say('organize a birthday party for 20 people on November 22 at 5 PM', { action: 'create', title: 'Birthday party' }), null, 'with the flag off nothing happens')
eq(seen.length, 0, 'and the model is not even called')
process.env.GOGO_EVENTS_OWNERS = OWNER

const r1 = await say('Gogo, organize a birthday party for 20 people on November 22 at 5 PM', { action: 'create', title: "Divya's birthday", kind: 'birthday', date: '2037-11-22', time: '17:00', capacity: 20 })
ok(/^Draft started\./.test(r1!) && r1!.includes("*Divya's birthday*") && /Sun, 22 Nov, 5:00 pm · place not set/.test(r1!) && /Up to 20 people/.test(r1!), 'a draft is created with the stated details')
ok(r1!.endsWith('Where is it happening? A venue name or "at home" is enough.'), 'and only the missing essential is asked for')
eq([seen[0].today, seen[0].weekday, seen[0].timezone, seen[0].active], ['2037-11-10', 'Tuesday', 'Asia/Kolkata', null], "the extractor is told today's local date, weekday and timezone")
const ev1 = (await store.listEvents(OWNER, db))[0]
eq([ev1.status, ev1.starts_at && new Date(ev1.starts_at).toISOString(), ev1.capacity, ev1.host_name, ev1.venue_name], ['draft', '2037-11-22T11:30:00.000Z', 20, 'Gogo', null], 'persisted as a draft; a complete-looking draft is never published by itself')

const r2 = await say('Toit Indiranagar', { action: 'update', venue_name: 'Toit, Indiranagar' }, NOW + 60_000)
ok(/^Draft updated\./.test(r2!) && r2!.includes('Toit, Indiranagar') && /Reply \*publish\*/.test(r2!), 'a short follow-up with no event word fills in the draft being planned')
ok(String(seen.at(-1).active).includes(`"Divya's birthday" (draft;`), 'the extractor is told which events are open')
eq(await say('what should I cook for dinner tonight?', { action: 'none' }, NOW + 120_000), null, 'an unrelated message during planning falls through to the ordinary assistant')
eq(await say('cancel it', { action: 'cancel' }, NOW + 130_000), null, 'a bare "cancel it" during planning is NOT taken as cancelling the event, whatever the model says')
eq(await status("Divya's birthday"), 'draft', 'and the draft is untouched')

const r3 = await say('publish', { action: 'publish' }, NOW + 180_000)
const link = r3!.match(/https:\/\/app\.askgogo\.in\/rsvp\/[A-Za-z0-9_-]{43}/)?.[0]
ok(/^Published \*Divya's birthday\*\./.test(r3!) && link && /I have not messaged anyone/.test(r3!), 'publishing returns the invitation link and says nobody was messaged')
const shareToken = link!.split('/rsvp/')[1]

const g = async (name: string, status: string, plusOnes = 0) => store.submitRsvp(shareToken, { status, plusOnes, name, clientKey: `client-key-for-${name.toLowerCase()}-0001` }, db)
await store.updateEvent(OWNER, ev1.id, { maxPlusOnes: 2 }, db)
await g('Nithin', 'going', 2); await g('Aparna', 'going'); await g('Chethan', 'maybe'); await g('Srini', 'declined')
await store.addGuests(OWNER, ev1.id, [{ name: 'Mathew' }], db)
const T = NOW + 3600_000 // an hour later: no draft is being planned any more
eq(await say('how many people confirmed?', { action: 'headcount' }, T), "Divya's birthday: 2 going + 2 plus-ones = 4 people. 1 maybe, 1 declined, 1 not replied yet.", 'the headcount is read from the database, in people')
eq(await say("who hasn't replied?", { action: 'pending' }, T), `Not replied yet for Divya's birthday (1): "Mathew".`, 'who has not replied (names are quoted)')
eq(await say('send me the invite link again', { action: 'link' }, T), `Invitation link for Divya's birthday:\n${link}`, 'the same link again')
eq(await say('Toit Indiranagar', { action: 'update', venue_name: 'Elsewhere' }, T), null, 'with no draft being planned, a message with no event word is not even looked at')
eq(await say('cancel it', { action: 'cancel' }, T), null, 'and neither is a bare "cancel it"')

// Time changes and cancellation of a published event wait for an explicit yes.
const r4 = await say('move the event by one hour', { action: 'update', shift_minutes: 60 }, T + 1000)
eq(r4, "Move *Divya's birthday* from Sun, 22 Nov, 5:00 pm to Sun, 22 Nov, 6:00 pm? Guests will see the new time on their invitation link. Reply *yes* to confirm.", 'moving a published event asks first')
eq(new Date((await store.getEvent(OWNER, ev1.id, db)).starts_at!).toISOString(), '2037-11-22T11:30:00.000Z', 'and nothing has moved yet')
script = []
const r4b = await tryAt(actor, 'yes', 'whatsapp', { extract: scripted, db, now: T + 60_000 })
eq(r4b, "*Divya's birthday* is now Sun, 22 Nov, 6:00 pm. Guests see this on their invitation link. I have not messaged anyone.", 'an explicit yes applies it and says nobody was messaged')
eq(new Date((await store.getEvent(OWNER, ev1.id, db)).starts_at!).toISOString(), '2037-11-22T12:30:00.000Z', 'the stored time moved by exactly one hour')
eq(await tryAt(actor, 'yes', 'whatsapp', { extract: scripted, db, now: T + 70_000 }), null, 'a second yes does nothing: the confirmation is used once')
await say('move it to Sunday the 29th', { action: 'update', date: '2037-11-29' }, T + 80_000)
eq(await tryAt(actor, 'yes', 'whatsapp', { extract: scripted, db, now: T + 80_000 + 11 * 60_000 }), null, 'a yes that arrives more than ten minutes later is not accepted')
eq(new Date((await store.getEvent(OWNER, ev1.id, db)).starts_at!).toISOString(), '2037-11-22T12:30:00.000Z', 'so the event did not move')
eq(await say('move the party to last week', { action: 'update', date: '2037-11-03' }, T + 2 * 3600_000), 'That time is in the past, so I have not changed anything.', 'a published event cannot be moved into the past')
const r5 = await say('change the venue of the party to Home', { action: 'update', venue_name: 'Home' }, T + 2 * 3600_000)
ok(/^Updated\./.test(r5!) && r5!.includes('Home') && r5!.endsWith('Guests see this on their invitation link. I have not messaged anyone.'), 'a place change on a published event applies and says guests were not messaged')

const r7 = await say('add Divya 9900000002 and Mathew to the guest list', { action: 'add_guests', guests: [{ name: 'Divya', phone: '9900000002' }, { name: 'Mathew' }, { name: 'Zed', phone: 'abc' }] }, T + 2 * 3600_000)
ok(/^Added 1 to \*Divya's birthday\*: Divya\./.test(r7!) && /Already on the list: Mathew\./.test(r7!) && /I could not read: Zed\./.test(r7!) && /Divya: https:\/\/app\.askgogo\.in\/rsvp\//.test(r7!) && /I have not messaged anyone\.$/.test(r7!), 'guests are added once, problems are named, personal links are returned, nobody is messaged')
ok(!r7!.includes('9900000002') && !/dashboard/.test(r7!), 'the phone number is not echoed and no page that does not exist is promised')
const many = await say('add these guests to the party', { action: 'add_guests', guests: Array.from({ length: 25 }, (_, i) => ({ name: `Guest ${i + 1}` })) }, T + 2 * 3600_000)
ok((many!.match(/\/rsvp\//g) || []).length === 20 && /For the other 5, ask me "link for" and the name\./.test(many!), 'for a long list twenty links are shown and the rest are available by name')
const one = await say('link for Guest 25 on the guest list', { action: 'link', guests: [{ name: 'Guest 25' }] }, T + 2 * 3600_000)
ok(/^Personal link for "Guest 25":\nhttps:\/\/app\.askgogo\.in\/rsvp\//.test(one!), "one guest's personal link can be shown again")
eq(await say('link for Nithin on the guest list', { action: 'link', guests: [{ name: 'Nithin' }] }, T + 2 * 3600_000), '"Nithin" joined through the shared link and holds their own personal link. I cannot issue it again.', 'a share-link guest holds their own link')
const rem = await say('remove Chethan from the guest list', { action: 'remove_guest', guests: [{ name: 'chethan' }] }, T + 2 * 3600_000)
ok(/^"Chethan" is removed from \*Divya's birthday\* and their link no longer works\./.test(rem!) && /Say "new invitation link"/.test(rem!), 'a guest can be removed, with the honest note that the shared link would let them back in')
eq(await say('remove Guest 1 from the guest list', { action: 'remove_guest', guests: [{ name: 'Guest 1' }] }, T + 2 * 3600_000), '"Guest 1" is removed from *Divya\'s birthday* and their link no longer works.', 'an exact name wins over longer names that contain it')
const newLink = await say('give me a new invitation link', { action: 'new_link' }, T + 2 * 3600_000)
ok(/^New invitation link for Divya's birthday:\nhttps:\/\/app\.askgogo\.in\/rsvp\//.test(newLink!) && !newLink!.includes(shareToken) && (await store.invitationFor(shareToken, db)) === null, 'the shared link can be replaced; the old one stops working')
eq(await say('turn off the invitation link', { action: 'link_off' }, T + 2 * 3600_000), "The shared link for Divya's birthday is switched off. Guests who already replied keep their own links.", 'or switched off')

// Two open events: the one that is named is the one that is touched.
const T2 = T + 4 * 3600_000
const r8 = await say('plan a family dinner for 15 people', { action: 'create', title: 'Family dinner', kind: 'dinner', capacity: 15 }, T2)
ok(/^Draft started\./.test(r8!) && r8!.endsWith('What date and time is it?'), 'a second event starts as its own draft and asks for the date')
const hc = await say("how many are coming to Divya's birthday party?", { action: 'headcount', event: "Divya's birthday" }, T2 + 1000)
ok(/^Divya's birthday: /.test(hc!), 'a named event is the one answered about, not the one touched last')
const up = await say("change the venue of Divya's birthday party to Toit", { action: 'update', event: "Divya's birthday", venue_name: 'Toit' }, T2 + 2000)
ok(/^Updated\./.test(up!) && (await store.getEvent(OWNER, ev1.id, db)).venue_name === 'Toit', 'a named event is the one changed')
eq((await store.listEvents(OWNER, db)).map(e => e.title).sort(), ["Divya's birthday", 'Family dinner'], 'and naming an event never renames another one')
const which = await say('how many guests are coming?', { action: 'headcount' }, T2 + 3 * 3600_000)
ok(/^Which event do you mean\?\n• /.test(which!) && which!.includes('Family dinner') && which!.includes("Divya's birthday"), 'with two open events and none named, Gogo asks which')
const whichCancel = await say('cancel the event', { action: 'cancel' }, T2 + 3 * 3600_000)
ok(/^Which event do you mean\?/.test(whichCancel!), 'cancel with two open events and none named asks which; nothing is cancelled')
const r9 = await say('list my events', { action: 'list' }, T2 + 3 * 3600_000)
ok(r9!.includes('Family dinner') && r9!.includes("Divya's birthday") && r9!.includes('open'), 'both are listed')
eq(await say('cancel the family dinner event', { action: 'cancel', event: 'family dinner' }, T2 + 3 * 3600_000), 'The draft *Family dinner* is discarded. It was never published, so no guest saw it.', 'a draft is discarded with a truthful reply (no link ever existed)')
const r10 = await say("cancel Divya's birthday party and notify confirmed guests", { action: 'cancel' }, T2 + 4 * 3600_000)
ok(/^Cancel \*Divya's birthday\* \(Sun, 22 Nov, 6:00 pm\)\? .* this cannot be undone\. Reply \*yes\* to confirm\.$/.test(r10!), 'cancelling a published event asks first')
eq(await status("Divya's birthday"), 'published', 'and it is still published')
eq(await tryAt(actor, 'yes, cancel it', 'whatsapp', { extract: scripted, db, now: T2 + 4 * 3600_000 + 30_000 }), "*Divya's birthday* is cancelled. Anyone who opens their invitation link now sees that it is cancelled. I have not messaged any guests.", 'yes cancels it and does not claim guests were notified')
eq(await status("Divya's birthday"), 'cancelled', 'and it is stored as cancelled')

// 3b. Third review: targeting, stray confirmations, partial names, guest-supplied text.
const OWNER2 = '990000002'
const actor2 = { ...actor, legacyTelegramId: 990000002 }
process.env.GOGO_EVENTS_OWNERS = `${OWNER},${OWNER2}`
const R = NOW + 30 * 3600_000
const say2 = (text: string, action: any, now = R) => { script = [action]; return tryAt(actor2, text, 'whatsapp', { extract: scripted, db, now }) }
const mk = async (title: string, extra: any = {}) => { const e = await store.createEvent(OWNER2, { title, startsAt: new Date(R + 72 * 3600_000).toISOString(), venueName: 'Home', timezone: 'Asia/Kolkata', ...extra }, db); await store.publishEvent(OWNER2, e.id, db); return e }
const kn = await mk('ದೀಪಾವಳಿ ಹಬ್ಬ'), dd = await mk('Diwali dinner')
eq(entry.norm('ದೀಪಾವಳಿ ಹಬ್ಬ'), 'ದೀಪಾವಳಿ ಹಬ್ಬ', 'names in any script are kept for matching')
const nomatch = await say2('turn off the invitation link for the birthday party', { action: 'link_off', event: 'birthday party' })
ok(/^I could not find an event with that name\./.test(nomatch!) && (await store.shareLink(OWNER2, kn.id, db)) && (await store.shareLink(OWNER2, dd.id, db)), 'a name that matches no event changes nothing, even when another event is written in another script')
eq((await say2('change the venue of the ದೀಪಾವಳಿ ಹಬ್ಬ event to Toit', { action: 'update', event: 'ದೀಪಾವಳಿ ಹಬ್ಬ', venue_name: 'Toit' }))?.startsWith('Updated.'), true, 'a name in Kannada selects that event')
eq([(await store.getEvent(OWNER2, kn.id, db)).venue_name, (await store.getEvent(OWNER2, dd.id, db)).venue_name], ['Toit', 'Home'], 'and only that one changed')
const party = await mk('Party')
ok(/^I could not find an event with that name\./.test((await say2('add Nithin to the office farewell party', { action: 'add_guests', event: 'office farewell party', guests: [{ name: 'Nithin' }] }))!), 'a longer name is not matched to a short event name it happens to contain')
eq((await store.listGuests(OWNER2, party.id, db)).length, 0, 'so nobody was added to "Party"')
await store.cancelEvent(OWNER2, kn.id, db); await store.cancelEvent(OWNER2, party.id, db)
ok(/^I could not find an event with that name\./.test((await say2("change the venue of Nithin's farewell party to Toit", { action: 'update', event: "Nithin's farewell", venue_name: 'Toit' }))!), 'with one open event, a different name is still not applied to it')
eq((await store.getEvent(OWNER2, dd.id, db)).venue_name, 'Home', 'the only open event is untouched')

// A stray "yes": the question is withdrawn by any other message.
ok(/^Cancel \*Diwali dinner\*/.test((await say2('cancel the Diwali dinner event', { action: 'cancel', event: 'Diwali dinner' }))!), 'cancel asks first')
eq(await say2('remind me to call Divya at 5', { action: 'none' }, R + 60_000), null, 'another message goes on to the ordinary assistant')
script = []
eq(await tryAt(actor2, 'Yes', 'whatsapp', { extract: scripted, db, now: R + 9 * 60_000 }), null, 'and a "yes" after it does not cancel anything')
eq((await store.getEvent(OWNER2, dd.id, db)).status, 'published', 'the event is still published')
ok(/^Move \*Diwali dinner\*/.test((await say2('move the Diwali dinner event by an hour', { action: 'update', event: 'Diwali dinner', shift_minutes: 60 }, R + 10 * 60_000))!), 'move asks first')
eq(await tryAt(actor2, 'yes, cancel it', 'whatsapp', { extract: scripted, db, now: R + 11 * 60_000 }), 'That does not match what I asked (moving *Diwali dinner*), so I have done nothing. Ask again if you want it.', 'a yes that names the other action does neither')
eq([(await store.getEvent(OWNER2, dd.id, db)).status, new Date((await store.getEvent(OWNER2, dd.id, db)).starts_at!).toISOString()], ['published', new Date(R + 72 * 3600_000).toISOString()], 'nothing moved and nothing was cancelled')
eq(entry.confirmVerb('yes, cancel it'), 'cancel', 'the verb is read from the yes')
// A move plus another field: the reply says what changed now and what waits.
const both = await say2('move the Diwali dinner event to 8 pm and change the venue to Toit', { action: 'update', event: 'Diwali dinner', time: '20:00', venue_name: 'Toit' }, R + 12 * 60_000)
ok(/^Updated now: place\. Guests see this on their invitation link\. I have not messaged anyone\.\n\nMove \*Diwali dinner\* from .* Reply \*yes\* to confirm\.$/.test(both!), 'the place change is applied and stated; the time change waits')
eq((await store.getEvent(OWNER2, dd.id, db)).venue_name, 'Toit', 'the place really changed')
await tryAt(actor2, 'no', 'whatsapp', { extract: async () => ({ action: 'none' }), db, now: R + 13 * 60_000 })
// The ungated follow-up window only touches the draft being planned.
const dr = await store.createEvent(OWNER2, { title: 'Bday', timezone: 'Asia/Kolkata' }, db)
ok(entry.activeDraft(await store.listEvents(OWNER2, db), R + 14 * 60_000)?.id === dr.id, 'the draft is the one being planned')
eq(await say2('change Diwali dinner venue to Home', { action: 'update', event: 'Diwali dinner', venue_name: 'Home' }, R + 14 * 60_000), null, 'a bare follow-up while a draft is open cannot change a published event')
eq((await store.getEvent(OWNER2, dd.id, db)).venue_name, 'Toit', 'the published event is untouched')
ok(/^Draft updated\./.test((await say2('Toit', { action: 'update', venue_name: 'Toit' }, R + 15 * 60_000))!), 'but it still fills in the draft')
await store.cancelEvent(OWNER2, dr.id, db)
// Partial and duplicate guest names never remove anyone by guesswork.
await store.addGuests(OWNER2, dd.id, [{ name: 'Anupama' }, { name: 'Rahul' }], db)
const dlink = tokenOf((await store.shareLink(OWNER2, dd.id, db))!)
await store.submitRsvp(dlink, { status: 'going', name: 'Rahul', clientKey: 'client-key-rahul-two-0001' }, db)
await store.submitRsvp(dlink, { status: 'going', name: 'Zed* is removed. _Verify_ at https://evil.example/x ~', clientKey: 'client-key-zed-000000001' }, db)
const anu = await say2('remove Anu from the Diwali dinner guest list', { action: 'remove_guest', event: 'Diwali dinner', guests: [{ name: 'Anu' }] }, R + 20 * 60_000)
eq(anu, 'I could not find exactly that name. Did you mean "Anupama"? Say the full name.', 'a partial name is only a suggestion')
eq((await store.listGuests(OWNER2, dd.id, db)).filter(g => g.revoked).length, 0, 'and nobody was removed')
const twoRahul = await say2('remove Rahul from the Diwali dinner guest list', { action: 'remove_guest', event: 'Diwali dinner', guests: [{ name: 'Rahul' }] }, R + 21 * 60_000)
ok(/^More than one guest is called "Rahul":\n• "Rahul" 1 \(added by you\)\n• "Rahul" 2 \(joined through the link, replied going\)\nSay the name with its number/.test(twoRahul!), 'two guests with one name are listed with how they joined')
ok(/^"Rahul" is removed/.test((await say2('remove Rahul 2 from the Diwali dinner guest list', { action: 'remove_guest', event: 'Diwali dinner', guests: [{ name: 'Rahul 2' }] }, R + 22 * 60_000))!), 'and the numbered one can be removed')
eq((await store.listGuests(OWNER2, dd.id, db)).filter(g => g.revoked).map(g => g.source), ['share_link'], 'it was the one who joined through the link')
const zed = await say2('remove the Zed guest from the Diwali dinner list', { action: 'remove_guest', event: 'Diwali dinner', guests: [{ name: 'Zed is removed Verify at https evil example x' }] }, R + 23 * 60_000)
ok(zed!.startsWith('"Zed is removed. Verify at [link]" is removed') && !/https?:|\*Zed|_Verify_|~/.test(zed!.split(' and their link')[0]), 'guest-supplied text is quoted, stripped of formatting and links when shown to the organizer')
eq(entry.shownName('*bold* _it_ ~s~ `code` www.evil.example'), '"bold it s code [link]"', 'the name filter')
const big = await say2('add these guests to the Diwali dinner', { action: 'add_guests', event: 'Diwali dinner', guests: Array.from({ length: 60 }, (_, i) => ({ name: `Person ${i + 1}` })) }, R + 24 * 60_000)
ok(/: Person 1, .*Person 20 and 40 more\./.test(big!.split('\n')[0]) && big!.length < 3000, 'a long list is summarised, not spelled out')
process.env.GOGO_EVENTS_OWNERS = OWNER

// 4. Failure handling: nothing is claimed that did not happen.
const T3 = T2 + 6 * 3600_000
eq(await tryAt(actor, 'plan a birthday party', 'whatsapp', { extract: async () => { throw new Error('model down') }, db, now: T3 }), null, 'if the model call fails, the message falls through rather than guessing')
eq(await tryAt(actor, 'plan a birthday party', 'whatsapp', { extract: async () => ({ action: 'drop_tables' } as any), db, now: T3 }), null, 'an unknown action does nothing')
eq(await say('create a birthday party', { action: 'create' }, T3), 'What should I call the event?', 'a create with no name asks for one and creates nothing')
eq((await store.listEvents(OWNER, db)).filter(e => e.status !== 'cancelled').length, 0, 'no event was created')
eq(await tryAt(actor, 'yes', 'whatsapp', { extract: scripted, db, now: T3 }), null, 'a "yes" with nothing waiting is not an events message')
const other = { ...actor, legacyTelegramId: 990000001 }
process.env.GOGO_EVENTS_OWNERS = `${OWNER},990000001`
script = [{ action: 'headcount' }]
eq(await tryAt(other, 'how many people confirmed?', 'whatsapp', { extract: scripted, db, now: T3 }), 'You have no open event. Tell me what you are planning, for example "plan a birthday on 22 November at 5 pm".', "another owner never sees this owner's event")
for (const t of ['yes', 'Yes!', 'confirm', 'yes, cancel it', 'go ahead', 'yes please']) ok(entry.CONFIRM_RE.test(t), `counts as a yes: ${t}`)
for (const t of ['yes but make it 7 pm', 'yesterday was fun', 'no', 'cancel it', 'yes cancel my reminder for tomorrow']) ok(!entry.CONFIRM_RE.test(t), `does not count as a yes: ${t}`)

// 5. Extractor contract.
eq(extract.actionFromToolInput({ action: 'publish' }), { action: 'publish' }, 'a known action passes')
eq([extract.actionFromToolInput({ action: 'rm -rf' }), extract.actionFromToolInput(null), extract.actionFromToolInput('publish')], [null, null, null], 'anything else is rejected')
const sys = extract.extractionSystem({ today: '2037-11-10', weekday: 'Tuesday', timezone: 'Asia/Kolkata', active: null })
ok(/Never invent a date, time, place, name or number/.test(sys) && /Booking a restaurant table[^\n]+action "none"/.test(sys) && sys.includes('Tuesday, 2037-11-10 in Asia/Kolkata'), 'the instructions forbid invention and send non-event requests to "none"')
const src = readFileSync(new URL('../lib/events/extract.ts', import.meta.url), 'utf8') + readFileSync(new URL('../lib/events/entry.ts', import.meta.url), 'utf8')
ok(/tool_choice: \{ type: 'tool' as const, name: EVENT_TOOL\.name \}/.test(src) && /forModel\(/.test(src), 'the model is forced to answer with the typed action')
ok(!/sendWhatsApp|sendGmail|createCalendarEvent|resend\./.test(src), 'nothing in the conversation path can message a guest or touch a calendar')
const logLines = [...src.matchAll(/console\.(?:log|error|warn)\(([^\n]*?\)\))/g)].map(m => m[1])
ok(logLines.length === 7 && logLines.every(l => !/message|\btext\b|actor|guest|phone|input\b/.test(l)), 'the log lines carry an action, an outcome or an error code only: no message text, names or phone numbers')

store.setEventsClockForTests(null)
await pg.close()
console.log(`EVENTS_CONVERSATION_OK ${checks} checks`)
