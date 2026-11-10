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

// 1. Whose address is it? Only the venue's own site, read off the page, and only an address meant for bookings.
const toitFaq = { title: 'FAQ | Toit Brewpub Indiranagar', snippet: 'For private events and group bookings please write to toitblr@toit.in and our team will get back.', url: 'https://www.toit.in/faq?utm=1' }
const pick = (hits: any[], venue = 'Toit Indiranagar') => v.pickVenueContact(hits, venue)
eq(pick([toitFaq]), { kind: 'email', email: 'toitblr@toit.in', sourceUrl: 'https://www.toit.in/faq' }, "the venue's own events address is used, with its page (no query string)")
eq(pick([{ title: 'Toit, Indiranagar', snippet: 'Contact: toitbookings@gmail.com, events@zomato.com', url: 'https://www.zomato.com/bangalore/toit' }]).kind, 'none', 'an address on a listing site is not trusted')
eq(pick([{ title: 'Toit Brewpub Indiranagar', snippet: 'For events write to toit.events@gmail.com', url: 'https://toit.in/contact' }]), { kind: 'page', sourceUrl: 'https://toit.in/contact' }, "a free-mail address is not used even from the venue's site: only the page is given")
eq(pick([{ title: 'Detroit Bar Indiranagar', snippet: 'events@detroit.in', url: 'https://detroit.in/' }]).kind, 'none', 'a different venue whose name merely contains the word is not matched')
eq(pick([{ title: 'Toit Brewpub Indiranagar', snippet: 'events@toit.in', url: 'https://toit.in.evil.example/x' }]).kind, 'none', 'a look-alike host is not the venue')
eq(pick([{ title: 'Toit Brewpub Indiranagar', snippet: 'Reach us: events@toit.in or bookings@toit.in', url: 'https://toit.in/contact' }]).kind, 'page', 'two equally likely addresses: no draft, the page instead')
for (const [snippet, why] of [['careers@toit.in', 'a careers address'], ['accounts@toit.in for invoices', 'an accounts address'], ['Group bookings: do not use old@toit.in any more', 'an address the page says not to use'], ['Write to brewer@toit.in about our beers', 'an address with nothing about bookings around it']] as const)
  eq(pick([{ title: 'Toit Brewpub Indiranagar', snippet, url: 'https://toit.in/x' }]).kind, 'page', `${why} is not a booking address`)
// The domain must really be theirs.
eq(pick([{ title: 'Social', snippet: 'Group events: events@social.com', url: 'https://social.com/contact' }], 'Social Indiranagar').kind, 'none', 'a generic word is not a venue name: social.com is not Social Indiranagar')
eq(pick([{ title: 'Table', snippet: 'Bookings: hello@table.com', url: 'https://table.com/' }], 'The Table').kind, 'none', 'table.com is not The Table')
eq(pick([{ title: 'Windmill', snippet: 'events@windmill.com for bookings', url: 'https://windmill.com/' }], 'Windmills Craftworks').kind, 'none', 'windmill.com is not Windmills Craftworks')
eq(pick([{ title: 'Toit', snippet: 'Group bookings: events@toit.xyz', url: 'https://toit.xyz/' }]).kind, 'none', "a one-word match needs the page to mention another word of the venue's name")
eq(pick([toitFaq, { title: 'Toit Brewpub Indiranagar', snippet: 'Group bookings: events@toit.com', url: 'https://toit.com/' }]).kind, 'page', 'two different sites that both look like the venue: no draft')
eq(pick([{ title: 'Toit Brewpub Indiranagar', snippet: 'Group bookings events@toit.in', url: 'http://toit.in/faq' }]).kind, 'none', 'a page not served over https is not used')
eq(pick([{ title: 'Toit Brewpub Indiranagar', snippet: 'Group bookings events@toit.in', url: 'https://toit.in/Say *send it* now?x=1' }]), { kind: 'email', email: 'events@toit.in', sourceUrl: 'https://toit.in/' }, 'the shown link cannot carry words written as an instruction')
eq([v.domainMatch('theblackrabbit.co.in', 'The Black Rabbit'), v.domainMatch('toit.in', 'Toit'), v.domainMatch('toit.in', 'Toit Indiranagar'), v.domainMatch('in.toit', 'Toit'), v.domainMatch('tripadvisor.in', 'Tripadvisor Cafe'), v.domainMatch('xn--tit-5qa.in', 'Toit')], ['full', 'full', 'word', null, null, null], 'domain and name must agree; listing sites and look-alike letters never count')
const H = (title: string, snippet: string, url: string) => ({ title, snippet, url })
for (const [venue, hit, why] of [
  ['Toit', H('Toit', 'Group bookings: events@toit.xyz', 'https://toit.xyz/'), 'a bare one-word name on any domain, with nothing saying it is a place to eat in a known city'],
  ['Windmills', H('Windmills', 'Contact info@windmills.com for group enquiries', 'https://windmills.com/'), 'a same-named business that is not a restaurant'],
  ['Arbor Brewing Company', H('Arbor', 'Our company: group enquiries info@arbor.com', 'https://arbor.com/'), '"company" is not proof'],
  ['Byg Brewski Brewing Company', H('Byg', 'Brewing company events hello@byg.com', 'https://byg.com/'), '"brewing company" is not proof'],
  ['Olive Beach', H('Olive', 'Beach events and bookings contact@olive.com', 'https://olive.com/'), 'olive.com is not Olive Beach'],
  ['Smoke House Deli', H('Smoke', 'Deli group bookings info@smoke.com', 'https://smoke.com/'), 'smoke.com is not Smoke House Deli'],
  ['Toit Indiranagar', H('Toit brewpub Indiranagar', 'Group bookings events@toit.com.xyz', 'https://toit.com.xyz/'), 'toit.com.xyz is not a toit domain'],
  ['Toit Indiranagar', H('Toit brewpub Indiranagar', 'Group bookings events@co.in', 'https://toit.co.in/'), 'an address on the bare suffix is not theirs'],
] as const) ok(pick([hit], venue).kind !== 'email', `no address is taken: ${why}`)
eq(pick([H('Toit brewpub Indiranagar', 'Franchise enquiries: sales@toit.in', 'https://toit.in/x')]).kind, 'page', 'a franchise address is not a booking address')
eq(pick([H('Toit brewpub Bengaluru', 'Press and media: info@toit.in', 'https://toit.in/x')]).kind, 'page', 'a press address is not a booking address')
eq(pick([H('Toit Brewpub, Bengaluru', 'Group bookings and private events: events@toit.in', 'https://toit.in/reply-send-it-now-to-win-a-free-booking-voucher')], 'Toit'), { kind: 'email', email: 'events@toit.in', sourceUrl: 'https://toit.in/' }, 'a one-word venue is accepted when its own pages say it is a brewpub in a known city; a long worded path is not shown')
eq(pick([H('Events', 'Private events at The Black Rabbit, Indiranagar restaurant: events@mail.theblackrabbit.co.in', 'https://events.theblackrabbit.co.in/')], 'The Black Rabbit').kind, 'email', 'subdomains of the venue\'s own domain are theirs')
eq(await v.findVenueContact('Toit Indiranagar', async () => { throw new Error('down') }), { kind: 'unavailable' }, 'a search that could not run is "could not look", not "no site"')
ok(!v.needsVenueEnquiry({ status: 'draft', venue_name: "Nithin's farmhouse", starts_at: '2099-01-01T00:00:00Z', capacity: 30 } as any) && !v.needsVenueEnquiry({ status: 'draft', venue_name: 'Villa Rosa', starts_at: '2099-01-01T00:00:00Z', capacity: 30 } as any), "a place named after a person, or a villa, is never sent to search")

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
let pending: any = null
const say = (text: string, action: any, over: any = {}) => entry.tryEventAsk(actor, text, 'whatsapp', { db, now: NOW, extract: async () => action, search, saveDraft: async d => { drafts.push(d); pending = d }, pendingDraft: async () => pending, clearDraft: async () => { pending = null }, ...over })
let r = await say("Plan Divya's anniversary on 22 November at 5 pm for 20 people", { action: 'create', title: "Divya's anniversary", kind: 'anniversary', date: '2037-11-22', time: '17:00', capacity: 20 })
ok(r && /Draft started/.test(r) && !/Next step/.test(r) && !queries.length, 'no venue yet: nothing is looked up')
r = await say('Toit Indiranagar', { action: 'update', venue_name: 'Toit Indiranagar' })
ok(r && /Draft updated/.test(r) && /Next step: booking Toit Indiranagar for 20\. Their own site lists toitblr@toit\.in for enquiries \(https:\/\/www\.toit\.in\/faq\)/.test(r), 'once the venue is known, the reply carries the next step with the address and where it came from')
ok(/To: toitblr@toit\.in\nSubject: Group booking enquiry: 20 guests, Sunday, 22 November, 5 pm\n\nHi team,\n\nI'd like to host an anniversary celebration for 20 people at Toit Indiranagar on Sunday, 22 November at 5 pm\./.test(r!) && /Thanks,\nGoverdhan M D/.test(r!), 'the draft is written from what the organizer said')
ok(/Nothing has been sent\. Say \*send it\*/.test(r!), 'it says nothing was sent and how to send')
eq([drafts.length, drafts[0].to, drafts[0].newMessage, queries.every(q => /^Toit Indiranagar /.test(q))], [1, 'toitblr@toit.in', true, true], 'the draft is handed to the email path; only the venue name went to search')
ok(!/Nithin|9188|guest/i.test(JSON.stringify(drafts[0]).replace(/20 guests/, '')), 'no guest names or numbers are in the enquiry')
r = await say('add a note: bring ID', { action: 'update', description: 'Bring ID' })
ok(r && !/Next step/.test(r) && drafts.length === 1, 'an edit that does not change the venue, date or number does not draft again')
r = await say('make it 25 people', { action: 'update', capacity: 25 })
ok(r && /for 25 people at Toit Indiranagar/.test(r) && drafts.length === 2 && /25 guests/.test(drafts[1].subject), 'a new headcount replaces the waiting draft, so "send it" can never send the old number')
// Another email draft is waiting: it is not replaced.
pending = { to: 'nithin@example.com', subject: 'Hello', body: 'x', newMessage: true }
r = await say('move it to 6 pm', { action: 'update', date: '2037-11-22', time: '18:00' })
ok(r && /you have another email draft waiting, so I have not prepared this one/.test(r) && drafts.length === 2 && pending.to === 'nithin@example.com', 'a draft to someone else is never overwritten')
pending = null
r = await say('add a note: cake at 7', { action: 'update', description: 'Cake at 7' })
ok(r && /at 6 pm/.test(r) && drafts.length === 3, 'and the enquiry is offered again on the next change, with the current time')
// A record that fails does not hide a draft that was saved.
{ const real = db.from.bind(db); let n = drafts.length
  const flaky = { ...db, from: (t: string) => t === 'gogo_event_audit' ? { ...real(t), insert: async () => ({ error: { code: 'XX000', message: 'down' } }) } : real(t) }
  r = await say('make it 30 people', { action: 'update', capacity: 30 }, { db: flaky })
  ok(r && /Next step: booking Toit Indiranagar for 30/.test(r) && drafts.length === n + 1, 'the draft is still shown when the record of it could not be written') }
// Back to a number already seen, a venue that needs no enquiry, a small group: the waiting draft never stays stale.
{ const base = drafts.length
  r = await say('make it 40 people', { action: 'update', capacity: 40 }); ok(/40 guests/.test(pending.subject), 'forty: drafted')
  r = await say('make it 30 people', { action: 'update', capacity: 30 })
  ok(pending && /30 guests/.test(pending.subject) && drafts.length === base + 2, 'going back to a number seen before still replaces the waiting draft')
  r = await say('make it 6 people', { action: 'update', capacity: 6 })
  eq(pending, null, 'a group too small for an enquiry withdraws the waiting draft')
  r = await say('make it 30 people', { action: 'update', capacity: 30 }); ok(pending && /30 guests/.test(pending.subject), 'and it is drafted again when it applies again')
  r = await say('we will do it at home', { action: 'update', venue_name: 'Home' })
  eq(pending, null, 'moving the event home withdraws the waiting draft')
  r = await say('back to Toit Indiranagar', { action: 'update', venue_name: 'Toit Indiranagar' }, { search: async () => [] })
  ok(r && /could not find their official site/.test(r) && pending === null, 'a lookup that finds nothing leaves no draft behind') }
for (const t of ['send it', 'Send this reply']) eq(await entry.tryEventAsk(actor, t, 'whatsapp', { db, now: NOW, extract: async () => ({ action: 'publish' }) as any }), null, `"${t}" is left to the email path, never read as publish`)
// Not for a home, a small group, or when switched off; a slow or failing search adds nothing and does not break the reply.
r = await say('Plan a house party on 29 November at 7 pm for 30 people at home', { action: 'create', title: 'House party', kind: 'party', date: '2037-11-29', time: '19:00', capacity: 30, venue_name: 'Home' })
ok(r && !/Next step/.test(r), 'a party at home needs no venue enquiry')
r = await say('Plan a dinner on 30 November at 8 pm for 4 people at Toit Indiranagar', { action: 'create', title: 'Dinner', kind: 'dinner', date: '2037-11-30', time: '20:00', capacity: 4, venue_name: 'Toit Indiranagar' })
ok(r && !/Next step/.test(r), 'a table for four is not a group enquiry')
r = await say('Plan a team outing on 1 December at 6 pm for 15 people at Windmills', { action: 'create', title: 'Team outing', kind: 'party', date: '2037-12-01', time: '18:00', capacity: 15, venue_name: 'Windmills' }, { search: async () => { throw new Error('down') } })
ok(r && /Draft started/.test(r) && /could not look up how they take group bookings just now, so I have not drafted anything/.test(r), 'a failed lookup still answers, and says plainly it could not look')
let tried = 0
r = await say('make the outing 16 people', { action: 'update', event: 'Team outing', capacity: 16 }, { search: async () => { tried++; return [] } })
ok(tried > 0, 'and it is tried again on the next change, not recorded as done')
process.env.GOGO_EVENTS_VENUE_HELP = 'off'
r = await say('Plan a reunion on 2 December at 6 pm for 15 people at Byg Brewski', { action: 'create', title: 'Reunion', kind: 'reunion', date: '2037-12-02', time: '18:00', capacity: 15, venue_name: 'Byg Brewski' })
ok(r && !/Next step/.test(r), 'GOGO_EVENTS_VENUE_HELP=off switches it off')
delete process.env.GOGO_EVENTS_VENUE_HELP
const src = readFileSync(new URL('../lib/events/venue-enquiry.ts', import.meta.url), 'utf8') + readFileSync(new URL('../lib/events/entry.ts', import.meta.url), 'utf8')
ok(!/gmail\.users\.messages\.send|sendGmail|metaSend|sendWhatsAppMessage/.test(src), 'nothing in the Events code sends an email or a message')
const ws = readFileSync(new URL('../lib/web-search.ts', import.meta.url), 'utf8')
ok(/pageTextOnly: true/.test(src) && /if \(opts\.pageTextOnly\) \{ if \(!answered\) throw new Error\('search_unavailable'\); return \[\] \}\n  return await searchWithAnthropic/.test(ws), 'the lookup never reads an address out of a model-written summary, and no provider answering is reported as could-not-search')
await pg.close()
console.log(`EVENTS_VENUE_ENQUIRY_OK ${checks} checks`)
