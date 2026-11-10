// AskGogo Events (Addendum 4): the migration run on a real Postgres (PGlite, in memory) and the pure rules.
// Offline. Covers mandatory tests 6-14 (tokens, RSVP, duplicates, headcount, closing, revocation, isolation) at the
// data layer, plus rollback.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import * as ev from '../lib/events/core.ts'

let checks = 0
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++ }
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++ }
const UP = readFileSync(new URL('../supabase/migrations/20261110150000_gogo_events.sql', import.meta.url), 'utf8')
const DOWN = readFileSync(new URL('../supabase/migrations/20261110150000_gogo_events.rollback.sql', import.meta.url), 'utf8')

const db = new PGlite()
await db.exec('create role anon; create role authenticated; create role service_role;')
await db.exec(UP)
await db.exec(UP) // idempotent: applying twice is harmless
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as any[]
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0]
const BIG = '9007199254740993' // above 2^53: must survive as text
const OTHER = '-884501501'
const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

const mkEvent = async (o: Record<string, unknown> = {}) => {
  const share = ev.newEventToken()
  const row = { owner: BIG, title: "Divya's birthday", status: 'published', starts_at: future(72), capacity: null, max_plus_ones: 2, rsvp_closes_at: null, ...o }
  const e = await one(`insert into gogo_events (owner_telegram_id, title, kind, status, starts_at, venue_name, venue_address, capacity, max_plus_ones, rsvp_closes_at, share_token_hash)
    values ($1,$2,'birthday',$3,$4,'Toit','100 Feet Road, Indiranagar',$5,$6,$7,$8) returning *`, [row.owner, row.title, row.status, row.starts_at, row.capacity, row.max_plus_ones, row.rsvp_closes_at, ev.eventTokenHash(share)])
  return { e, share }
}
const mkGuest = async (eventId: string, name: string, phone: string | null = null) => {
  const token = ev.newEventToken()
  const g = await one(`insert into gogo_event_guests (event_id, name, phone, token_hash) values ($1,$2,$3,$4) returning *`, [eventId, name, phone, ev.eventTokenHash(token)])
  return { g, token }
}
const rsvp = async (token: string, status: string, plus = 0, dietary: string | null = null, comment: string | null = null) =>
  (await one('select gogo_event_rsvp($1,$2,$3,$4,$5) as r', [ev.eventTokenHash(token), status, plus, dietary, comment])).r
const head = async (id: string) => ev.asHeadcount((await one('select gogo_event_headcount($1) as h', [id])).h)

// 1. Tokens: high entropy, only the hash is stored.
const t1 = ev.newEventToken(), t2 = ev.newEventToken()
ok(ev.TOKEN_RE.test(t1) && t1 !== t2 && t1.length === 43, 'a token is 256 random bits, URL-safe')
ok(/^[0-9a-f]{64}$/.test(ev.eventTokenHash(t1)!) && ev.eventTokenHash(t1) !== ev.eventTokenHash(t2), 'its hash is SHA-256')
for (const bad of ['', 'short', t1 + 'x', t1.slice(0, 42) + '!', null, 12345, { toString: () => t1 }]) eq(ev.eventTokenHash(bad), null, `not a token: ${String(bad).slice(0, 12)}`)
eq(ev.rsvpUrl(t1, {}), `https://app.askgogo.in/rsvp/${t1}`, 'RSVP link')
assert.throws(() => ev.rsvpUrl('../admin', {}), /invalid_event_token/); checks++

// 2. Owner ids are exact text; a 64-bit id is not rounded.
const { e: E1 } = await mkEvent()
eq(E1.owner_telegram_id, BIG, 'a 64-bit owner id is stored exactly')
await assert.rejects(q(`insert into gogo_events (owner_telegram_id, title) values ('12abc','x')`)); checks++
await assert.rejects(q(`insert into gogo_events (owner_telegram_id, title, status) values ($1,'x','published')`, [BIG]), /check/i); checks++ // published needs a date
ok((await one(`insert into gogo_events (owner_telegram_id, title) values ($1,'Draft dinner') returning status`, [BIG])).status === 'draft', 'a draft may have no date yet')

// 3. RSVP, updates, history, headcount in people.
const A = await mkGuest(E1.id, 'Nithin', '919900000001'), B = await mkGuest(E1.id, 'Divya', '919900000002'), C = await mkGuest(E1.id, 'Aparna'), D = await mkGuest(E1.id, 'Chethan')
eq(await head(E1.id), { invited: 4, going: 0, plus_ones: 0, attendees: 0, maybe: 0, declined: 0, no_reply: 4 }, 'nobody has replied')
eq(await rsvp(A.token, 'going', 2, ' Vegetarian ', 'See you!'), { ok: true, status: 'going', plus_ones: 2, changed: true }, 'going with two plus-ones')
eq(await rsvp(B.token, 'going'), { ok: true, status: 'going', plus_ones: 0, changed: true }, 'going alone')
eq(await rsvp(C.token, 'maybe', 3), { ok: true, status: 'maybe', plus_ones: 0, changed: true }, 'a maybe carries no plus-ones')
eq(await head(E1.id), { invited: 4, going: 2, plus_ones: 2, attendees: 4, maybe: 1, declined: 0, no_reply: 1 }, '2 invitations + 2 plus-ones = 4 people')
eq(ev.headcountLine(await head(E1.id)), '2 going + 2 plus-ones = 4 people. 1 maybe, 1 not replied yet.', 'organizer answer counts people')
eq((await rsvp(A.token, 'going', 2, 'Vegetarian', 'See you!')).changed, false, 'the same answer again changes nothing')
eq(await rsvp(A.token, 'going', 9), { ok: true, status: 'going', plus_ones: 2, changed: false }, 'plus-ones are capped at the event limit')
eq(await rsvp(A.token, 'declined', 2), { ok: true, status: 'declined', plus_ones: 0, changed: true }, 'changing to declined removes the plus-ones')
eq((await head(E1.id)).attendees, 1, 'headcount follows the change')
eq((await one('select dietary, comment, rsvp_changes from gogo_event_guests where id=$1', [A.g.id])), { dietary: null, comment: null, rsvp_changes: 4 }, 'optional fields are replaced, edits are counted')
eq((await q('select rsvp_status, plus_ones from gogo_event_rsvp_history where guest_id=$1 order by id', [A.g.id])).map(r => `${r.rsvp_status}:${r.plus_ones}`), ['going:2', 'going:2', 'going:2', 'declined:0'], 'every answer is kept in the history')
eq(await rsvp(A.token, 'yes'), { ok: false, error: 'invalid_status' }, 'an unknown answer is refused')
eq(await rsvp(ev.newEventToken(), 'going'), { ok: false, error: 'not_found' }, 'an unknown token is refused')
await assert.rejects(q(`update gogo_event_guests set plus_ones = 2 where id = $1`, [C.g.id]), /check/i); checks++ // maybe + plus-ones is impossible

// 4. Duplicate guests.
await assert.rejects(mkGuest(E1.id, 'Nithin again', '919900000001'), /unique|duplicate/i); checks++
const E2 = (await mkEvent({ title: 'Team outing' })).e
ok((await mkGuest(E2.id, 'Nithin', '919900000001')).g.id, 'the same person can be a guest of another event')
eq(ev.dedupeGuests([{ name: ' Nithin ', phone: '9900000001' }, { name: 'Nithin K', phone: '+91 99000 00001' }, { name: 'Divya' }, { name: 'divya' }, { name: '', phone: '99' }, { name: 'Bad', phone: 'abc' }]),
  { add: [{ name: 'Nithin', phone: '919900000001' }, { name: 'Divya', phone: null }], duplicates: ['Nithin K', 'divya'], invalid: ['99', 'Bad'] }, 'typed guests are de-duplicated by phone, or by name when there is no phone')
ok(typeof ev.guestPhone('9900000001') === 'string' && ev.guestPhone(9900000001 as any) === null, 'a phone number is a string and a JavaScript number is refused')

// 5. Capacity cannot be oversold. The function locks the event row; real concurrency needs a live database test.
const { e: E3 } = await mkEvent({ title: 'Small dinner', capacity: 3, max_plus_ones: 1 })
const g1 = await mkGuest(E3.id, 'One'), g2 = await mkGuest(E3.id, 'Two'), g3 = await mkGuest(E3.id, 'Three')
eq((await rsvp(g1.token, 'going', 1)).ok, true, 'two places taken')
const race = await Promise.all([rsvp(g2.token, 'going', 1), rsvp(g3.token, 'going', 0)])
eq(race.filter(r => r.ok).length, 1, 'of two answers for the last place only one succeeds (single test connection: ordering, not true concurrency)')
ok((await head(E3.id)).attendees <= 3, 'capacity is never exceeded')
const full = race.find(r => !r.ok)
ok(full.error === 'full' && Number.isInteger(full.places_left) && full.places_left >= 0 && full.places_left <= 1, 'the refused guest is told the event is full and how many places were left')
eq((await rsvp(g1.token, 'going', 0)).ok, true, 'a going guest can reduce their own party when the event is full')

// 6. Closing, cancellation, drafts, revocation.
const { e: E4 } = await mkEvent({ title: 'Closed', rsvp_closes_at: new Date(Date.now() - 60_000).toISOString() })
eq(await rsvp((await mkGuest(E4.id, 'Late')).token, 'going'), { ok: false, error: 'closed' }, 'no answer after the closing time')
const { e: E5 } = await mkEvent({ title: 'Past', starts_at: new Date(Date.now() - 3600_000).toISOString() })
eq((await rsvp((await mkGuest(E5.id, 'Late')).token, 'going')).error, 'closed', 'no answer after the event has started')
const E6 = (await mkEvent({ title: 'Cancelled' })).e; const g6 = await mkGuest(E6.id, 'X')
await q(`update gogo_events set status='cancelled', cancelled_at=now() where id=$1`, [E6.id])
eq((await rsvp(g6.token, 'going')).error, 'cancelled', 'no answer to a cancelled event')
const E7 = (await mkEvent({ title: 'Draft', status: 'draft' })).e
eq((await rsvp((await mkGuest(E7.id, 'Early')).token, 'going')).error, 'not_open', 'no answer to a draft')
await q(`update gogo_event_guests set token_revoked_at=now() where id=$1`, [B.g.id])
eq((await rsvp(B.token, 'declined')).error, 'revoked', 'a revoked link cannot answer')
eq((await head(E1.id)).going, 0, 'a revoked guest no longer counts')
for (let i = 0; i < 20; i++) await rsvp(D.token, i % 2 ? 'going' : 'maybe')
eq((await rsvp(D.token, 'going')).error, 'too_many_changes', 'one link cannot be used to hammer the event')

// 7. Share link: a guest adds themselves and gets a personal link; bounded.
const { e: E8, share } = await mkEvent({ title: 'Open house', capacity: 10 })
const mine = ev.newEventToken()
const join = async (shareTok: string, name: string, tok = ev.newEventToken()) => (await one('select gogo_event_join($1,$2,$3) as r', [ev.eventTokenHash(shareTok), name, ev.eventTokenHash(tok)])).r
eq(await join(share, '  Srini   J ', mine), { ok: true }, 'joining through the share link')
eq((await one('select name, source, phone from gogo_event_guests where token_hash=$1', [ev.eventTokenHash(mine)])), { name: 'Srini J', source: 'share_link', phone: null }, 'the guest is created with a tidy name and no phone')
eq((await rsvp(mine, 'going')).ok, true, 'and can answer with their personal link')
eq(await join(share, '   '), { ok: false, error: 'name_required' }, 'a name is required')
eq(await join(ev.newEventToken(), 'Nobody'), { ok: false, error: 'not_found' }, 'a wrong share link finds nothing')
eq((await one('select gogo_event_join($1,$2,$3) as r', [ev.eventTokenHash(share), 'X', 'not-a-hash'])).r, { ok: false, error: 'invalid_token' }, 'a malformed personal token is refused')
for (let i = 0; i < 60; i++) await join(share, `Guest ${i}`)
eq((await join(share, 'One too many')).error, 'guest_limit', 'a share link cannot create guests without limit')
await q(`update gogo_events set share_token_hash=$2 where id=$1`, [E8.id, ev.eventTokenHash(ev.newEventToken())])
eq((await join(share, 'After rotation')).error, 'not_found', 'rotating the share link disables the old one')

// 8. Isolation: owner-scoped reads, and anon/authenticated have no access at all.
await mkEvent({ owner: OTHER, title: 'Someone else' })
eq((await q('select title from gogo_events where owner_telegram_id=$1 and title=$2', [BIG, 'Someone else'])).length, 0, "another owner's event is not in this owner's rows")
for (const table of ['gogo_events', 'gogo_event_guests', 'gogo_event_rsvp_history', 'gogo_event_notifications', 'gogo_event_audit']) {
  const r = await one(`select relrowsecurity as rls, has_table_privilege('anon','public.${table}','select') as anon, has_table_privilege('authenticated','public.${table}','insert') as authed, has_table_privilege('service_role','public.${table}','select') as service, (select count(*)::int from pg_policies where tablename='${table}') as policies from pg_class where oid='public.${table}'::regclass`)
  eq(r, { rls: true, anon: false, authed: false, service: true, policies: 0 }, `${table}: RLS on, default deny, service role only`)
}
for (const fn of ['gogo_event_rsvp(text,text,integer,text,text)', 'gogo_event_join(text,text,text)', 'gogo_event_headcount(uuid)'])
  eq(await one(`select has_function_privilege('anon','public.${fn}','execute') as anon, has_function_privilege('authenticated','public.${fn}','execute') as authed, has_function_privilege('service_role','public.${fn}','execute') as service`), { anon: false, authed: false, service: true }, `${fn}: service role only`)

// 9. Notifications de-duplicate; the audit trail is append-only.
const key = `invite:${E1.id}:${A.g.id}`
await q(`insert into gogo_event_notifications (event_id, guest_id, kind, channel, dedupe_key) values ($1,$2,'invite','whatsapp',$3)`, [E1.id, A.g.id, key])
await assert.rejects(q(`insert into gogo_event_notifications (event_id, guest_id, kind, channel, dedupe_key) values ($1,$2,'invite','whatsapp',$3)`, [E1.id, A.g.id, key]), /unique|duplicate/i); checks++
eq((await one(`insert into gogo_event_notifications (event_id, guest_id, kind, channel, dedupe_key) values ($1,$2,'invite','whatsapp',$3) on conflict (dedupe_key) do nothing returning id`, [E1.id, A.g.id, key])) ?? null, null, 'a repeated plan lands on the existing row')
await q(`insert into gogo_event_audit (event_id, actor, action) values ($1,'owner','event.created')`, [E1.id])
await assert.rejects(q(`update gogo_event_audit set action='x' where event_id=$1`, [E1.id]), /append-only/); checks++
await q('delete from gogo_events where id=$1', [E1.id])
eq((await one('select (select count(*)::int from gogo_event_guests where event_id=$1) as g, (select count(*)::int from gogo_event_audit where event_id=$1) as a, (select count(*)::int from gogo_event_rsvp_history where event_id=$1) as h', [E1.id])), { g: 0, a: 0, h: 0 }, 'deleting an event removes its guests, answers and audit rows')

// 10. What a guest may see.
const row = { ...(await one('select * from gogo_events where id=$1', [E3.id])), starts_at: future(72), ends_at: null, rsvp_closes_at: null } as ev.EventRow
const guestRow = (s: string) => ({ id: 'x', name: 'Two', rsvp_status: s, plus_ones: 0, dietary: null, comment: null, token_revoked_at: null })
const hidden = ev.publicInvitation(row, guestRow('none')), shown = ev.publicInvitation(row, guestRow('going'))
eq([hidden.venueName, hidden.venueAddress, hidden.placeHidden], ['Toit', null, true], 'the exact address is hidden until the guest is going')
eq(shown.venueAddress, '100 Feet Road, Indiranagar', 'and shown once they are')
eq(ev.publicInvitation({ ...row, address_visibility: 'everyone' }, null).venueAddress, '100 Feet Road, Indiranagar', 'unless the organizer shows it to everyone')
const text = JSON.stringify(hidden)
ok(!/owner_telegram_id|"id"|capacity|share_token|9007199254740993|919900/.test(text), 'no owner, ids, capacity, tokens or phone numbers in the guest view')
eq(ev.publicInvitation({ ...row, status: 'cancelled' }, null).status, 'cancelled', 'a cancelled event says so')
eq(ev.publicInvitation({ ...row, rsvp_closes_at: new Date(Date.now() - 1000).toISOString() }, null).status, 'closed', 'a closed event says so')

// 11. Drafts: nothing essential is guessed.
eq(ev.missingForPublish({ title: 'Birthday' }), ['date_time', 'place'], 'a title alone still needs a date and a place')
eq(ev.missingForPublish({ title: 'Birthday', startsAt: future(48), venueName: 'Home' }), [], 'title, time and place are enough')
eq(ev.missingForPublish({ title: 'Birthday', startsAt: new Date(Date.now() - 1000).toISOString(), onlineUrl: 'https://meet.example/x' }), ['date_time'], 'a past time is not accepted')
eq(ev.draftProblems({ kind: 'party' as any, capacity: 0, maxPlusOnes: 11, onlineUrl: 'http://x', timezone: 'Mars/Phobos', endsAt: 'nope' }).sort(), ['capacity', 'endsAt', 'kind', 'maxPlusOnes', 'onlineUrl', 'timezone'], 'invalid fields are named')
eq(ev.draftProblems({ kind: 'birthday', capacity: 30, maxPlusOnes: 1, timezone: 'Asia/Kolkata', startsAt: future(1), endsAt: future(3) }), [], 'a valid draft has no problems')

// 12. Flag: off by default, exact owner match.
eq([ev.eventsEnabledFor(BIG, {}), ev.eventsEnabledFor(BIG, { GOGO_EVENTS_OWNERS: `${OTHER}, ${BIG}` }), ev.eventsEnabledFor('9007199254740992', { GOGO_EVENTS_OWNERS: BIG }), ev.eventsEnabledFor(BIG, { GOGO_EVENTS: '1' }), ev.eventsEnabledFor('abc', { GOGO_EVENTS: '1' })], [false, true, false, true, false], 'events are off unless the exact owner is listed or the feature is on for all')

// 13. Add to calendar.
const ics = ev.invitationIcs({ ...shown, title: 'Dinner; with, friends', description: 'Line one\nLine two' }, 'abc123', new Date('2026-11-10T00:00:00Z'))!
const BS = String.fromCharCode(92)
ok(ics.includes('SUMMARY:Dinner' + BS + '; with' + BS + ', friends') && ics.includes('DESCRIPTION:Line one' + BS + 'nLine two') && ics.startsWith('BEGIN:VCALENDAR') && ics.endsWith('END:VCALENDAR' + String.fromCharCode(13, 10)), 'the calendar file escapes text and is well formed')
ok(/DTSTART:[0-9]{8}T[0-9]{6}Z/.test(ics) && ics.includes('LOCATION:Toit' + BS + ', 100 Feet Road' + BS + ', Indiranagar'), 'UTC start time and the place this guest may see')
ok(ics.split(String.fromCharCode(13, 10)).every(l => Buffer.byteLength(l, 'utf8') <= 75), 'lines are folded to 75 bytes')
eq(ev.invitationIcs({ ...shown, status: 'cancelled' as const }, 'abc123'), null, 'no calendar file for a cancelled event')
ok(!/100 Feet Road/.test(ev.invitationIcs(hidden, 'abc123')!), 'a guest who cannot see the address does not get it in the calendar file either')

// 14. Rollback removes everything and nothing else.
await db.exec('create table public.unrelated_keepme(id int);')
await db.exec(DOWN)
eq((await q(`select tablename from pg_tables where schemaname='public' order by 1`)).map(r => r.tablename), ['unrelated_keepme'], 'rollback drops only the Events tables')
eq((await q(`select proname from pg_proc where proname like 'gogo_event%'`)).length, 0, 'and its functions')
await db.exec(UP)
ok((await one(`select count(*)::int as n from gogo_events`)).n === 0, 'and the migration applies cleanly again after a rollback')
await db.close()

console.log(`EVENTS_SCHEMA_CORE_OK ${checks} checks`)
