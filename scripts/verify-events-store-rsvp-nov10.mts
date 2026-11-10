// AskGogo Events: the organizer store and the guest flow, run against real SQL (PGlite) through the same code the
// app uses. Covers mandatory tests 2, 5, 6, 7, 8, 10, 12, 13, 14, 27, 28 (data side), 29, 30 at the store level.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteSupabase } from './lib/pglite-supabase.mts'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service-role-key-0123456789'
process.env.GOGO_EVENTS_TOKEN_SECRET = 'fixture-events-token-secret-0123456789abcdef'
const store = await import('../lib/events/store.ts')
const core = await import('../lib/events/core.ts')

let checks = 0
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++ }
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++ }
const fails = async (p: Promise<unknown>, code: string, msg: string) => { await assert.rejects(p, (e: any) => e?.code === code, msg); checks++ }

const pg = new PGlite()
await pg.exec('create role anon; create role authenticated; create role service_role;')
await pg.exec(readFileSync(new URL('../supabase/migrations/20261110150000_gogo_events.sql', import.meta.url), 'utf8'))
await pg.exec(readFileSync(new URL('../supabase/migrations/20261110170000_gogo_events_v2.sql', import.meta.url), 'utf8'))
const key = (n: number) => `client-key-${String(n).padStart(8, '0')}`
const db = pgliteSupabase(pg) as any
const ME = '9007199254740993', OTHER = '-884501501'
const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
const tokenOf = (url: string) => url.split('/rsvp/')[1]

// 1. Create a draft; nothing essential is guessed (test 27).
const draft = await store.createEvent(ME, { title: "  Divya's   birthday ", kind: 'birthday', capacity: 20, maxPlusOnes: 2, hostName: 'Gogo' }, db)
eq([draft.title, draft.status, draft.starts_at, draft.owner_telegram_id], ["Divya's birthday", 'draft', null, ME], 'a draft is created with a tidy title, no invented date, and the exact 64-bit owner')
eq(await store.publishEvent(ME, draft.id, db), { event: null, missing: ['date_time', 'place'], shareUrl: null }, 'publishing reports what is missing instead of guessing')
await fails(store.createEvent(ME, { title: '   ' }, db), 'title_required', 'a title is required')
await fails(store.createEvent(ME, { title: 'X', capacity: 0 }, db), 'invalid_event_fields', 'invalid fields are refused')
await fails(store.createEvent('12abc', { title: 'X' }, db), 'invalid_owner', 'an owner id that is not a decimal string is refused')
eq(await store.invitationFor(store.derivedToken('share', draft.id, 0), db), null, 'a draft has no public invitation')

// 2. Edit, then publish (tests 5, 6).
const edited = await store.updateEvent(ME, draft.id, { startsAt: future(96), venueName: 'Toit', venueAddress: '298, 100 Feet Road, Indiranagar', dressCode: 'Something colourful' }, db)
eq([edited.revision, edited.venue_name], [2, 'Toit'], 'an edit bumps the revision')
const pub = await store.publishEvent(ME, draft.id, db)
ok(pub.event?.status === 'published' && pub.event.revision === 3 && core.TOKEN_RE.test(tokenOf(pub.shareUrl!)), 'publishing returns a share link with a 256-bit token and bumps the revision')
eq(await store.shareLink(ME, draft.id, db), pub.shareUrl, 'the organizer can get the same link again later')
const stored = (await pg.query('select share_token_hash from gogo_events where id=$1', [draft.id])).rows[0] as any
ok(stored.share_token_hash === core.eventTokenHash(tokenOf(pub.shareUrl!)) && !JSON.stringify(stored).includes(tokenOf(pub.shareUrl!)), 'only the hash of the link is stored')
await fails(store.updateEvent(ME, draft.id, { venueName: '' , onlineUrl: '' }, db), 'would_unpublish', 'a published event cannot lose its place')
await fails(store.updateEvent(ME, draft.id, { startsAt: new Date(Date.now() - 1000).toISOString() }, db), 'would_unpublish', 'or be moved into the past')

// 3. Isolation (tests 13, 14).
await fails(store.getEvent(OTHER, draft.id, db), 'not_found', "another owner cannot read the event")
await fails(store.updateEvent(OTHER, draft.id, { title: 'Hijack' }, db), 'not_found', 'or edit it')
await fails(store.cancelEvent(OTHER, draft.id, db), 'not_found', 'or cancel it')
await fails(store.addGuests(OTHER, draft.id, [{ name: 'Mallory' }], db), 'not_found', 'or add guests')
await fails(store.listGuests(OTHER, draft.id, db), 'not_found', 'or see the guest list')
await fails(store.headcount(OTHER, draft.id, db), 'not_found', 'or the headcount')
await fails(store.shareLink(OTHER, draft.id, db), 'not_found', 'or the share link')
await fails(store.getEvent(ME, 'not-a-uuid', db), 'not_found', 'a malformed id finds nothing')
eq((await store.listEvents(OTHER, db)).length, 0, "another owner's list is empty")
const mine2 = await store.createEvent(ME, { title: 'Team outing' }, db)
eq((await store.listEvents(ME, db)).map(e => e.title).sort(), ["Divya's birthday", 'Team outing'], 'several events at once (test 29)')

// 4. Guests the organizer names (test 8).
const added = await store.addGuests(ME, draft.id, [{ name: 'Nithin', phone: '9900000001' }, { name: 'Nithin K', phone: '+91 99000 00001' }, { name: 'Aparna' }, { name: 'Bad', phone: 'abc' }], db)
eq([added.added.map(a => a.name), added.duplicates, added.invalid], [['Nithin', 'Aparna'], ['Nithin K'], ['Bad']], 'guests are added once; duplicates and invalid entries are reported')
eq((await store.addGuests(ME, draft.id, [{ name: 'Someone', phone: '9900000001' }, { name: 'aparna' }], db)).duplicates, ['Someone', 'aparna'], 'adding the same phone or name again later is also caught')
const nithinToken = tokenOf(added.added[0].link)
const guestsBefore = await store.listGuests(ME, draft.id, db)
eq(guestsBefore.map(g => [g.name, g.hasPhone, g.rsvp]), [['Nithin', true, 'none'], ['Aparna', false, 'none']], 'the organizer sees guests; the phone number itself is not returned')
ok(!JSON.stringify(guestsBefore).includes('919900000001'), 'no phone number leaves the store in the guest list')

// 5. A guest with a personal link (tests 7, 10).
const seen = await store.invitationFor(nithinToken, db)
eq([seen?.mode, seen?.view?.guest?.name, seen?.view?.venueName, seen?.view?.venueAddress, seen?.view?.placeHidden], ['guest', 'Nithin', 'Toit', null, true], 'the guest sees their invitation without the exact address')
eq(await store.submitRsvp(nithinToken, { status: 'going', plusOnes: 2, dietary: 'Vegetarian' }, db), { ok: true, personalToken: undefined }, 'going with two plus-ones')
eq((await store.invitationFor(nithinToken, db))?.view?.venueAddress, '298, 100 Feet Road, Indiranagar', 'the address appears once they are going')
eq(await store.headcount(ME, draft.id, db), { invited: 2, going: 1, plus_ones: 2, attendees: 3, maybe: 0, declined: 0, no_reply: 1 }, 'headcount counts people')
eq((await store.submitRsvp(nithinToken, { status: 'declined' }, db)).ok, true, 'the answer can be changed')
eq((await store.headcount(ME, draft.id, db)).attendees, 0, 'and the headcount follows')
eq(await store.submitRsvp(nithinToken, { status: 'yes' }, db), { ok: false, error: 'invalid_status' }, 'an unknown answer is refused')
eq(await store.submitRsvp(core.newEventToken(), { status: 'going' }, db), { ok: false, error: 'not_found' }, 'an unknown link is refused')
eq(await store.submitRsvp('../../etc/passwd', { status: 'going' }, db), { ok: false, error: 'not_found' }, 'a malformed link is refused')

// 6. A guest with the share link.
const shareTok = tokenOf(pub.shareUrl!)
eq((await store.invitationFor(shareTok, db))?.mode, 'share', 'the share link shows the invitation with no guest')
eq((await store.submitRsvp(shareTok, { status: 'going', clientKey: key(1) }, db)).error, 'name_required', 'a name is needed to answer through the share link')
eq((await store.submitRsvp(shareTok, { status: 'going', name: 'Srini' }, db)).error, 'invalid_client_key', 'and the browser key that makes retries safe')
eq((await store.listGuests(ME, draft.id, db)).length, 2, 'neither refused attempt created a guest')
const joined = await store.submitRsvp(shareTok, { status: 'going', plusOnes: 1, name: ' Sri\u202Eni\u0007 ', clientKey: key(1) }, db)
const again = await store.submitRsvp(shareTok, { status: 'going', plusOnes: 1, name: 'Srini', clientKey: key(1) }, db)
eq([again.ok, again.personalToken], [true, joined.personalToken], 'the same first answer sent twice (a retry) lands on the same guest')
eq((await store.listGuests(ME, draft.id, db)).filter(g => g.source === 'share_link').length, 1, 'and creates one guest, not two')
eq((await store.headcount(ME, draft.id, db)).attendees, 2, 'so the headcount is not doubled')
ok(joined.ok && core.TOKEN_RE.test(joined.personalToken!) && joined.personalToken !== shareTok, 'answering through the share link returns a personal link')
eq((await store.invitationFor(joined.personalToken!, db))?.view?.guest, { name: 'Sri ni', rsvp: 'going', plusOnes: 1, dietary: null, comment: null }, 'which shows that guest, with control and direction-override characters removed from the name')
eq((await store.submitRsvp(joined.personalToken!, { status: 'maybe' }, db)).ok, true, 'editing through the personal link changes the same guest')
eq((await store.listGuests(ME, draft.id, db)).filter(g => g.source === 'share_link').map(g => [g.rsvp, g.plusOnes]), [['maybe', 0]], 'one guest row, not two')

// 7. Capacity through the store.
const small = await store.createEvent(ME, { title: 'Small dinner', startsAt: future(48), venueName: 'Home', capacity: 2, maxPlusOnes: 3 }, db)
const smallPub = await store.publishEvent(ME, small.id, db)
const first = await store.submitRsvp(tokenOf(smallPub.shareUrl!), { status: 'going', plusOnes: 1, name: 'One', clientKey: key(10) }, db)
const second = await store.submitRsvp(tokenOf(smallPub.shareUrl!), { status: 'going', name: 'Two', clientKey: key(11) }, db)
eq([first.ok, second.ok, second.error, second.placesLeft, second.personalToken], [true, false, 'full', 0, undefined], 'a full event refuses the next guest')
eq((await store.listGuests(ME, small.id, db)).length, 1, 'and the refused answer leaves no guest behind')
for (let i = 0; i < 60; i++) await store.submitRsvp(tokenOf(smallPub.shareUrl!), { status: 'going', name: `Bot ${i}`, clientKey: key(100 + i) }, db)
eq((await store.listGuests(ME, small.id, db)).length, 1, 'sixty refused attempts still leave one guest: the link cannot be filled with junk')
eq((await store.submitRsvp(tokenOf(smallPub.shareUrl!), { status: 'maybe', name: 'Two', clientKey: key(11) }, db)).ok, true, 'the refused guest can answer maybe instead')
// The organizer's own list never switches the share link off.
const big = await store.createEvent(ME, { title: 'Big list', startsAt: future(48), venueName: 'Hall', capacity: 10 }, db)
await store.addGuests(ME, big.id, Array.from({ length: 60 }, (_, i) => ({ name: `Named ${i}` })), db)
const bigPub = await store.publishEvent(ME, big.id, db)
eq((await store.submitRsvp(tokenOf(bigPub.shareUrl!), { status: 'maybe', name: 'Walk-in', clientKey: key(20) }, db)).ok, true, 'sixty named guests do not block a share-link guest')
await assert.rejects(store.addGuests(ME, big.id, Array.from({ length: 201 }, (_, i) => ({ name: `X ${i}` })), db), (e: any) => e.code === 'too_many_at_once'); checks++
// Repeats and the change bound.
const rep1 = await store.submitRsvp(tokenOf(bigPub.shareUrl!), { status: 'going', name: 'Repeater', clientKey: key(21) }, db)
for (let i = 0; i < 30; i++) await store.submitRsvp(rep1.personalToken!, { status: 'going' }, db)
eq(((await pg.query('select rsvp_changes, (select count(*)::int from gogo_event_rsvp_history h where h.guest_id = g.id) as history from gogo_event_guests g where token_hash = $1', [core.eventTokenHash(rep1.personalToken!)])).rows[0]), { rsvp_changes: 1, history: 1 }, 'thirty identical repeats are not counted and write no history')
for (let i = 0; i < 25; i++) await store.submitRsvp(rep1.personalToken!, { status: i % 2 ? 'going' : 'maybe' }, db)
eq((await store.submitRsvp(rep1.personalToken!, { status: 'maybe', comment: 'x' }, db)).error, 'too_many_changes', 'real changes are bounded per link')
eq((await store.submitRsvp(rep1.personalToken!, { status: 'declined' }, db)).ok, true, 'but declining is always allowed, so nobody is stuck holding a place')

// 8. Revoke, disable the share link (test 12).
const nithin = (await store.listGuests(ME, draft.id, db)).find(g => g.name === 'Nithin')!
await store.revokeGuest(ME, draft.id, nithin.id, db)
eq((await store.invitationFor(nithinToken, db))?.mode, 'revoked', 'a revoked link shows as no longer active')
eq((await store.submitRsvp(nithinToken, { status: 'going' }, db)).error, 'revoked', 'and cannot answer')
await fails(store.revokeGuest(ME, mine2.id, nithin.id, db), 'not_found', "a guest cannot be revoked through a different event")
const readded = await store.addGuests(ME, draft.id, [{ name: 'Nithin', phone: '9900000001' }], db)
ok(readded.added.length === 1 && tokenOf(readded.added[0].link) !== nithinToken, 'a revoked guest can be added again and gets a new link')
await store.disableShareLink(ME, draft.id, db)
eq([await store.shareLink(ME, draft.id, db), await store.invitationFor(shareTok, db)], [null, null], 'a disabled share link stops working')
const republished = await store.publishEvent(ME, draft.id, db)
ok(republished.shareUrl && republished.shareUrl !== pub.shareUrl && (await store.invitationFor(shareTok, db)) === null, 'publishing again gives a new link; the disabled one never comes back')
const rotated = await store.rotateShareLink(ME, draft.id, db)
ok(rotated && rotated !== republished.shareUrl && (await store.invitationFor(tokenOf(republished.shareUrl!), db)) === null && (await store.invitationFor(tokenOf(rotated!), db))?.mode === 'share', 'rotating replaces the link')
ok((await store.invitationFor(joined.personalToken!, db))?.view, 'personal links keep working after the share link is disabled')

// 9. Cancel (test 28, data side) and closed events.
const cancelled = await store.cancelEvent(ME, draft.id, db)
eq([cancelled.status, (await store.cancelEvent(ME, draft.id, db)).status], ['cancelled', 'cancelled'], 'cancelling is idempotent')
eq((await store.invitationFor(joined.personalToken!, db))?.view?.status, 'cancelled', 'guests see that it is cancelled')
eq((await store.submitRsvp(joined.personalToken!, { status: 'going' }, db)).error, 'cancelled', 'and can no longer answer')
await fails(store.updateEvent(ME, draft.id, { title: 'New' }, db), 'event_closed', 'a cancelled event is not edited')
await fails(store.addGuests(ME, draft.id, [{ name: 'Late' }], db), 'event_closed', 'or given new guests')

// 10. Audit trail and missing tables.
eq(((await pg.query('select action from gogo_event_audit where event_id=$1 order by id', [draft.id])).rows as any[]).map(r => r.action),
  ['event.created', 'event.updated', 'event.published', 'guests.added', 'guest.revoked', 'guests.added', 'share_link.disabled', 'event.published', 'share_link.rotated', 'event.cancelled'], 'organizer actions are recorded in order')
const empty = new PGlite()
await fails(store.listEvents(ME, pgliteSupabase(empty) as any), 'events_not_enabled', 'before the migration is applied the store says events are not enabled')
await empty.close()

// 11. Tokens are derived, stable and keyed.
eq(store.derivedToken('guest', nithin.id), store.derivedToken('guest', nithin.id), 'a derived token is stable')
ok(store.derivedToken('guest', nithin.id) !== store.derivedToken('share', nithin.id, 0) && store.derivedToken('share', nithin.id, 0) !== store.derivedToken('share', nithin.id, 1) && store.derivedToken('guest', nithin.id, '', { GOGO_EVENTS_TOKEN_SECRET: 'another-events-token-secret-0123456789ab' }) !== store.derivedToken('guest', nithin.id), 'it depends on its kind, its rotation number and the events key')
assert.throws(() => store.derivedToken('guest', nithin.id, '', { SUPABASE_SERVICE_ROLE_KEY: 'a-long-service-role-key-that-must-not-be-used-0000' }), (e: any) => e.code === 'events_token_key_missing'); checks++ // no fallback to another credential
assert.throws(() => store.derivedToken('join', nithin.id, 'short'), (e: any) => e.code === 'invalid_client_key'); checks++
// A real database error is not reported as "events are not enabled".
await assert.rejects(pg.query(`insert into gogo_events (owner_telegram_id, title, capacity) values ('1','x',0)`)); checks++
const broken = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { code: '23514', message: 'new row for relation "gogo_events" violates check constraint' } }) }) }) }) }), rpc: async () => ({ data: null, error: null }) }
const realConsoleError = console.error; const logged: string[] = []; console.error = (...a: any[]) => { logged.push(a.join(' ')) }
await fails(store.listEvents(ME, broken as any), 'events_store_failed', 'a constraint error is a store failure, not "not enabled"')
console.error = realConsoleError
ok(logged.some(l => /EVENTS_STORE_FAILED/.test(l) && /23514/.test(l)), 'and it is logged with the database code so it can be diagnosed')

// 12. The public route, executed. A fresh published event, the real handlers, the real store, PGlite underneath.
store.setEventsDbForTests(db)
const routeMod = await import('../app/api/rsvp/[token]/route.ts')
const call = async (method: 'GET' | 'POST', token: string, body?: unknown, o: { query?: string; ip?: string; raw?: BodyInit; headers?: Record<string, string> } = {}) => {
  const req = new Request(`https://app.askgogo.in/api/rsvp/${token}${o.query || ''}`, { method, headers: { 'x-forwarded-for': o.ip || '203.0.113.7', ...(o.headers || {}) }, body: method === 'POST' ? (o.raw ?? JSON.stringify(body)) : undefined, ...(method === 'POST' ? { duplex: 'half' } : {}) } as any)
  const res = await (routeMod as any)[method](req, { params: Promise.resolve({ token }) })
  const text = await res.text()
  let data: any = null; try { data = JSON.parse(text) } catch { /* ics */ }
  return { status: res.status, data, text, headers: res.headers }
}
const party = await store.createEvent(ME, { title: 'Route party', startsAt: future(72), venueName: 'Toit', venueAddress: '298, 100 Feet Road', capacity: 3, maxPlusOnes: 2, hostName: 'Gogo' }, db)
const partyLink = tokenOf((await store.publishEvent(ME, party.id, db)).shareUrl!)
const named = tokenOf((await store.addGuests(ME, party.id, [{ name: 'Divya', phone: '9900000002' }], db)).added[0].link)
const leaks = (r: { text: string }) => /owner_telegram_id|9007199254740993|919900000002|share_token|token_hash|"capacity"|"id"|event_id/.test(r.text) || r.text.includes(party.id)
const g1 = await call('GET', partyLink)
eq([g1.status, g1.data.mode, g1.data.invitation.venueName, g1.data.invitation.venueAddress, g1.data.invitation.placeHidden], [200, 'share', 'Toit', null, true], 'GET on the share link shows the invitation without the address')
eq([g1.headers.get('cache-control'), g1.headers.get('referrer-policy'), g1.headers.get('x-robots-tag')], ['no-store', 'no-referrer', 'noindex, nofollow'], 'private, no referrer, not indexed')
ok(!leaks(g1), 'no owner, ids, capacity, phone or hashes in the response')
eq([(await call('GET', core.newEventToken())).status, (await call('GET', 'short')).status, (await call('POST', 'short', { status: 'going' })).status], [404, 404, 404], 'unknown and malformed links are 404')
const p1 = await call('POST', named, { status: 'going', plusOnes: 2 })
eq([p1.status, p1.data.ok, p1.data.invitation.guest.name, p1.data.invitation.venueAddress, p1.data.personalToken], [200, true, 'Divya', '298, 100 Feet Road', null], 'a named guest goes with two more and now sees the address')
const p2 = await call('POST', partyLink, { status: 'going', name: 'Late', clientKey: key(30) })
eq([p2.status, p2.data.ok, p2.data.error, 'invitation' in p2.data], [409, false, 'This event is full.', false], 'a full event answers 409 and returns no invitation data')
ok(!leaks(p2) && !p2.text.includes('100 Feet Road'), 'the refusal leaks neither the address nor anything internal')
eq([(await call('POST', partyLink, { status: 'going', name: 'Late' })).status, (await call('POST', partyLink, { status: 'perhaps', name: 'L', clientKey: key(31) })).status, (await call('POST', named, [1, 2])).status, (await call('POST', named, undefined, { raw: 'not json' })).status], [400, 400, 400, 400], 'bad requests are 400')
const p3 = await call('POST', partyLink, { status: 'maybe', name: 'Aparna', clientKey: key(32) })
ok(p3.status === 200 && core.TOKEN_RE.test(p3.data.personalToken) && p3.data.invitation.guest.name === 'Aparna' && p3.data.invitation.venueAddress === null, 'a share-link maybe gets a personal link and still no address')
eq((await call('POST', named, undefined, { raw: JSON.stringify({ status: 'going', comment: 'x'.repeat(5000) }) })).status, 413, 'an oversized body is refused')
const chunked = new ReadableStream({ start(c) { for (let i = 0; i < 40; i++) c.enqueue(new TextEncoder().encode('x'.repeat(1000))); c.close() } })
eq((await call('POST', named, undefined, { raw: chunked })).status, 413, 'an oversized body with no declared length is refused while it is being read')
const ics = await call('GET', named, undefined, { query: '?format=ics' })
ok(ics.status === 200 && /text\/calendar/.test(ics.headers.get('content-type') || '') && ics.text.includes('SUMMARY:Route party') && ics.text.includes('100 Feet Road'), 'a going guest gets a calendar file with the address')
ok(!ics.text.includes(named.slice(0, 8)) && /UID:[0-9a-f]{32}@askgogo\.in/.test(ics.text), 'the calendar id is a hash: no part of the link is exported')
ok(!(await call('GET', p3.data.personalToken, undefined, { query: '?format=ics' })).text.includes('100 Feet Road'), "a maybe guest's calendar file has no address")
const divyaRow = (await store.listGuests(ME, party.id, db)).find(g => g.name === 'Divya')!
await store.revokeGuest(ME, party.id, divyaRow.id, db)
eq([(await call('GET', named)).status, (await call('POST', named, { status: 'declined' })).data.gone], [404, true], 'a revoked link is 404 to read and tells the page to forget it')
// Rate limits: one counter per address and method; no per-link counter that one person could use to shut others out.
let limited = 0
for (let i = 0; i < 70; i++) if ((await call('POST', p3.data.personalToken, { status: 'maybe' }, { ip: '198.51.100.9' })).status === 429) limited++
eq(limited, 10, 'the sixty-first answer from one address in ten minutes is asked to slow down')
eq((await call('POST', p3.data.personalToken, { status: 'maybe' }, { ip: '198.51.100.10' })).status, 200, 'another address is not affected')
eq((await call('GET', p3.data.personalToken, undefined, { ip: '198.51.100.9' })).status, 200, 'reading is counted separately from answering')
for (let i = 0; i < 40; i++) await call('GET', partyLink, undefined, { ip: '198.51.100.11' })
eq((await call('POST', p3.data.personalToken, { status: 'maybe' }, { ip: '198.51.100.11' })).status, 200, 'forty page loads from one address do not use up its answers')
let forged = 0
for (let i = 0; i < 70; i++) if ((await call('POST', p3.data.personalToken, { status: 'maybe' }, { headers: { 'x-forwarded-for': `10.0.0.${i}, 198.51.100.12` } })).status === 429) forged++
eq(forged, 10, 'a forged first hop in x-forwarded-for does not evade the limit')
for (const ip of ['198.51.100.21', '198.51.100.22', '198.51.100.23', '198.51.100.24']) for (let i = 0; i < 60; i++) await call('POST', partyLink, { status: 'junk' }, { ip })
eq((await call('POST', partyLink, { status: 'maybe', name: 'Real guest', clientKey: key(40) }, { ip: '198.51.100.30' })).status, 200, 'junk from four addresses on the shared link does not lock a real guest out')
eq((await call('POST', p3.data.personalToken, { status: 'maybe' }, { headers: { 'x-vercel-forwarded-for': '198.51.100.31', 'x-forwarded-for': '198.51.100.9' } })).status, 200, "the platform's own address header is preferred")
ok(((await pg.query('select bucket from gogo_event_rate')).rows as any[]).every(r => /^ip[gp]:[0-9a-f]{40}$/.test(r.bucket)), 'the counters hold hashes, not addresses or links')
// Past the change bound, declining works once and cannot be used to keep writing.
const stuck = await store.submitRsvp(tokenOf(bigPub.shareUrl!), { status: 'going', name: 'Changer', comment: 'first', clientKey: key(50) }, db)
for (let i = 0; i < 25; i++) await store.submitRsvp(stuck.personalToken!, { status: i % 2 ? 'going' : 'maybe', comment: 'first' }, db)
const before = (await pg.query('select count(*)::int n from gogo_event_rsvp_history h join gogo_event_guests g on g.id = h.guest_id where g.token_hash = $1', [core.eventTokenHash(stuck.personalToken!)])).rows[0] as any
eq((await store.submitRsvp(stuck.personalToken!, { status: 'declined', comment: 'attacker text 1' }, db)).ok, true, 'past the bound, declining is still allowed once')
for (let i = 0; i < 50; i++) await store.submitRsvp(stuck.personalToken!, { status: 'declined', comment: `attacker text ${i}` }, db)
const after = (await pg.query('select count(*)::int n, max(g.comment) c from gogo_event_rsvp_history h join gogo_event_guests g on g.id = h.guest_id where g.token_hash = $1', [core.eventTokenHash(stuck.personalToken!)])).rows[0] as any
eq([after.n - before.n, after.c], [1, 'first'], 'fifty more declines write nothing more, and the stored note is not replaced')
// Share links: disabling and rotating move the revision on, so a publish that read the old state cannot bring a link back.
const rv = await store.createEvent(ME, { title: 'Revision check', startsAt: future(48), venueName: 'Home' }, db)
const rvPub = await store.publishEvent(ME, rv.id, db)
const staleRevision = (await store.getEvent(ME, rv.id, db)).revision
await store.disableShareLink(ME, rv.id, db)
eq((await store.getEvent(ME, rv.id, db)).revision, staleRevision + 1, 'disabling the link bumps the revision')
const stale = await (db.from('gogo_events').update({ share_token_hash: core.eventTokenHash(tokenOf(rvPub.shareUrl!)) }).eq('id', rv.id).eq('revision', staleRevision).select('id'))
eq([stale.data.length, await store.invitationFor(tokenOf(rvPub.shareUrl!), db)], [0, null], 'a write guarded by the old revision changes nothing: the disabled link stays dead')
// With no capacity, people arriving through the shared link are still bounded.
const open2 = await store.createEvent(ME, { title: 'No capacity', startsAt: future(48), venueName: 'Park', maxPlusOnes: 5 }, db)
const open2Link = tokenOf((await store.publishEvent(ME, open2.id, db)).shareUrl!)
let accepted = 0
for (let i = 0; i < 60; i++) if ((await store.submitRsvp(open2Link, { status: 'going', plusOnes: 5, name: `F ${i}`, clientKey: key(1000 + i) }, db)).ok) accepted++
eq([accepted, (await store.headcount(ME, open2.id, db)).attendees], [50, 300], 'an event with no capacity takes at most 300 people through the shared link')
const open3 = await store.createEvent(ME, { title: 'No capacity 2', startsAt: future(48), venueName: 'Park', maxPlusOnes: 10 }, db)
const open3Link = tokenOf((await store.publishEvent(ME, open3.id, db)).shareUrl!)
const maybes: string[] = []
for (let i = 0; i < 40; i++) { const r = await store.submitRsvp(open3Link, { status: 'maybe', name: `M ${i}`, clientKey: key(2000 + i) }, db); if (r.personalToken) maybes.push(r.personalToken) }
for (const t of maybes) await store.submitRsvp(t, { status: 'going', plusOnes: 10 }, db)
ok((await store.headcount(ME, open3.id, db)).attendees <= 300, 'joining as maybe and then switching to going cannot get round the 300-people bound')
// ICS folding keeps whole characters.
const longView = { ...(await store.invitationFor(p3.data.personalToken, db))!.view!, title: 'a'.repeat(62) + '\u{1F600}\u{1F600}\u{1F600}', description: 'one\rtwo' }
const folded = core.invitationIcs(longView, 'abc')!
ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(folded) && folded.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75) && !/one\rtwo/.test(folded), 'folding never splits a character and a bare carriage return is escaped')
store.setEventsDbForTests(null)

// 13. Source checks for what cannot be executed here.
const route = readFileSync(new URL('../app/api/rsvp/[token]/route.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../app/rsvp/[token]/page.tsx', import.meta.url), 'utf8')
const client = readFileSync(new URL('../app/rsvp/[token]/rsvp-client.tsx', import.meta.url), 'utf8')
ok(!/supabaseAdmin|owner_telegram_id|listGuests|headcount\(/.test(route + page + client), 'the public surface never touches organizer data')
ok(!/console\.(?:log|error|warn)/.test(route + page + client), 'the link and replies are never logged by the public surface')
ok(/robots: \{ index: false, follow: false \}/.test(page) && /referrer: 'no-referrer'/.test(page), 'the page is not indexed and sends no referrer')
ok(/prefers-reduced-motion:no-preference/.test(client) && !/font-style:\s*italic/.test(client), 'animations respect reduced motion; no italics')
ok(!/replaceState|location\.replace/.test(client), 'the shared link stays in the address bar; the personal link is never put there')
ok(/Not you\? Answer as someone else/.test(client), 'a shared phone can answer for a second person')
eq([...route.matchAll(/^export (?:async function|const) (\w+)/gm)].map(m => m[1]).sort(), ['GET', 'POST', 'dynamic'], 'only route exports')
const envBefore = process.env.NODE_ENV; (process.env as any).NODE_ENV = 'production'
assert.throws(() => store.setEventsDbForTests(db), (e: any) => e.code === 'not_allowed'); checks++; (process.env as any).NODE_ENV = envBefore

await pg.close()
console.log(`EVENTS_STORE_RSVP_OK ${checks} checks`)
