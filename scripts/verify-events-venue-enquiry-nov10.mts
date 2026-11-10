// AskGogo Events: the step after the plan. 10 Nov: a competitor answered "Toit Indiranagar" with the venue's own
// private-events address and a drafted enquiry; AskGogo saved the event and stopped. Search is faked: no network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteSupabase } from './lib/pglite-supabase.mts'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service-role-key-0123456789'
process.env.ANTHROPIC_API_KEY ||= 'test'
process.env.GOGO_EVENTS_TOKEN_SECRET = 'fixture-events-token-secret-0123456789abcdef'
process.env.GOGO_EVENTS_OWNERS = '884501501'
const entry = await import('../lib/events/entry.ts')
const store = await import('../lib/events/store.ts')
const v = await import('../lib/events/venue-enquiry.ts')
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }

// 1. Whose address is it? Only the venue's own domain, word for word from a result.
const toitFaq = { title: 'FAQ | Toit Brewpub', snippet: 'For private events and group bookings please write to toitblr@toit.in and our team will get back.', url: 'https://www.toit.in/faq' }
eq(v.pickVenueContact([toitFaq], 'Toit Indiranagar'), { kind: 'email', email: 'toitblr@toit.in', sourceUrl: 'https://www.toit.in/faq' }, "the venue's own events address is used, with its source")
eq(v.pickVenueContact([{ title: 'Toit, Indiranagar', snippet: 'Contact: toitbookings@gmail.com, events@zomato.com', url: 'https://www.zomato.com/bangalore/toit' }], 'Toit Indiranagar').kind, 'none', 'an address on a listing site is not trusted')
eq(v.pickVenueContact([{ title: 'Toit', snippet: 'Write to toit.events@gmail.com', url: 'https://toit.in/contact' }], 'Toit Indiranagar'), { kind: 'page', sourceUrl: 'https://toit.in/contact' }, "a free-mail address is not used even from the venue's site: only the page is given")
eq(v.pickVenueContact([{ title: 'Detroit Bar', snippet: 'events@detroit.in', url: 'https://detroit.in/' }], 'Toit Indiranagar').kind, 'none', 'a different venue whose name merely contains the word is not matched')
eq(v.pickVenueContact([{ title: 'Toit', snippet: 'events@toit.in', url: 'https://toit.in.evil.example/x' }], 'Toit Indiranagar').kind, 'none', 'a look-alike host is not the venue')
eq(v.pickVenueContact([{ title: 'Toit', snippet: 'Reach us: events@toit.in or bookings@toit.in', url: 'https://toit.in/contact' }], 'Toit Indiranagar').kind, 'page', 'two equally likely addresses: no draft, the page instead')
eq(v.pickVenueContact([{ title: 'Toit careers', snippet: 'careers@toit.in', url: 'https://toit.in/careers' }], 'Toit Indiranagar').kind, 'page', 'a careers address is not a booking address')
ok(v.domainIsVenue('theblackrabbit.co.in', 'The Black Rabbit') && !v.domainIsVenue('in.toit', 'Toit') && !v.domainIsVenue('tripadvisor.in', 'Tripadvisor Cafe'), 'domain and name must agree; listing sites never count')

// 2. In the conversation: the event reply, then the next step, once.
const pg = new PGlite()
await pg.exec('create role anon; create role authenticated; create role service_role;')
for (const f of ['20261110150000_gogo_events.sql', '20261110170000_gogo_events_v2.sql']) await pg.exec(readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8'))
const db = pgliteSupabase(pg) as any
const NOW = Date.parse('2037-11-10T09:00:00Z'); let clock = NOW
store.setEventsClockForTests(() => clock)
const actor = { userId: 'u1', legacyTelegramId: 884501501, whatsappId: '918884501501', name: 'Goverdhan M D', timezone: 'Asia/Kolkata' } as any
const queries: string[] = []; const drafts: any[] = []
const search = async (q: string) => { queries.push(q); return [toitFaq] }
const say = (text: string, action: any, over: any = {}) => entry.tryEventAsk(actor, text, 'whatsapp', { db, now: NOW, extract: async () => action, search, saveDraft: async d => { drafts.push(d) }, ...over })
let r = await say("Plan Divya's anniversary on 22 November at 5 pm for 20 people", { action: 'create', title: "Divya's anniversary", kind: 'anniversary', date: '2037-11-22', time: '17:00', capacity: 20 })
ok(r && /Draft started/.test(r) && !/Next step/.test(r) && !queries.length, 'no venue yet: nothing is looked up')
r = await say('Toit Indiranagar', { action: 'update', venue_name: 'Toit Indiranagar' })
ok(r && /Draft updated/.test(r) && /Next step: booking Toit Indiranagar for 20\. Their own site lists toitblr@toit\.in for enquiries \(https:\/\/www\.toit\.in\/faq\)/.test(r), 'once the venue is known, the reply carries the next step with the address and where it came from')
ok(/To: toitblr@toit\.in\nSubject: Group booking enquiry: 20 guests, Sunday, 22 November, 5 pm\n\nHi team,\n\nI'd like to host an anniversary celebration for 20 people at Toit Indiranagar on Sunday, 22 November at 5 pm\./.test(r!) && /Thanks,\nGoverdhan M D/.test(r!), 'the draft is written from what the organizer said')
ok(/Nothing has been sent\. Say \*send it\*/.test(r!), 'it says nothing was sent and how to send')
eq([drafts.length, drafts[0].to, drafts[0].newMessage, queries.every(q => /^Toit Indiranagar /.test(q))], [1, 'toitblr@toit.in', true, true], 'the draft is handed to the email path; only the venue name went to search')
ok(!/Nithin|9188|guest/i.test(JSON.stringify(drafts[0]).replace(/20 guests/, '')), 'no guest names or numbers are in the enquiry')
r = await say('make it 25 people', { action: 'update', capacity: 25 })
ok(r && !/Next step/.test(r) && drafts.length === 1, 'the same venue is not looked up or drafted twice')
eq(await entry.tryEventAsk(actor, 'send it', 'whatsapp', { db, now: NOW, extract: async () => ({ action: 'publish' }) as any }), null, '"send it" is left to the email path, never read as publish')
// Not for a home, a small group, or when switched off; a slow or failing search adds nothing and does not break the reply.
r = await say('Plan a house party on 29 November at 7 pm for 30 people at home', { action: 'create', title: 'House party', kind: 'party', date: '2037-11-29', time: '19:00', capacity: 30, venue_name: 'Home' })
ok(r && !/Next step/.test(r), 'a party at home needs no venue enquiry')
r = await say('Plan a dinner on 30 November at 8 pm for 4 people at Toit Indiranagar', { action: 'create', title: 'Dinner', kind: 'dinner', date: '2037-11-30', time: '20:00', capacity: 4, venue_name: 'Toit Indiranagar' })
ok(r && !/Next step/.test(r), 'a table for four is not a group enquiry')
r = await say('Plan a team outing on 1 December at 6 pm for 15 people at Windmills', { action: 'create', title: 'Team outing', kind: 'party', date: '2037-12-01', time: '18:00', capacity: 15, venue_name: 'Windmills' }, { search: async () => { throw new Error('down') } })
ok(r && /Draft started/.test(r) && /could not find their official site, so I have not drafted anything/.test(r), 'a failed lookup still answers, and says plainly nothing was drafted')
process.env.GOGO_EVENTS_VENUE_HELP = 'off'
r = await say('Plan a reunion on 2 December at 6 pm for 15 people at Byg Brewski', { action: 'create', title: 'Reunion', kind: 'reunion', date: '2037-12-02', time: '18:00', capacity: 15, venue_name: 'Byg Brewski' })
ok(r && !/Next step/.test(r), 'GOGO_EVENTS_VENUE_HELP=off switches it off')
delete process.env.GOGO_EVENTS_VENUE_HELP
const src = readFileSync(new URL('../lib/events/venue-enquiry.ts', import.meta.url), 'utf8') + readFileSync(new URL('../lib/events/entry.ts', import.meta.url), 'utf8')
ok(!/gmail\.users\.messages\.send|sendGmail|metaSend|sendWhatsAppMessage/.test(src), 'nothing in the Events code sends an email or a message')
ok(/EVENT_VENUE_STEP:', JSON\.stringify\(\{ found: step\.found, ms/.test(src), 'the log carries only the outcome and the time')
await pg.close()
console.log(`EVENTS_VENUE_ENQUIRY_OK ${checks} checks`)
