// AskGogo Events: the organizer store and the guest flow, run against real SQL (PGlite) through the same code the
// app uses. Covers mandatory tests 2, 5, 6, 7, 8, 10, 12, 13, 14, 27, 28 (data side), 29, 30 at the store level.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteSupabase } from './lib/pglite-supabase.mts'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service-role-key-0123456789'
const store = await import('../lib/events/store.ts')
const core = await import('../lib/events/core.ts')

let checks = 0
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++ }
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++ }
const fails = async (p: Promise<unknown>, code: string, msg: string) => { await assert.rejects(p, (e: any) => e?.code === code, msg); checks++ }

const pg = new PGlite()
await pg.exec('create role anon; create role authenticated; create role service_role;')
await pg.exec(readFileSync(new URL('../supabase/migrations/20261110150000_gogo_events.sql', import.meta.url), 'utf8'))
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
eq(await store.invitationFor(store.derivedToken('share', draft.id), db), null, 'a draft has no public invitation')

// 2. Edit, then publish (tests 5, 6).
const edited = await store.updateEvent(ME, draft.id, { startsAt: future(96), venueName: 'Toit', venueAddress: '298, 100 Feet Road, Indiranagar', dressCode: 'Something colourful' }, db)
eq([edited.revision, edited.venue_name], [2, 'Toit'], 'an edit bumps the revision')
const pub = await store.publishEvent(ME, draft.id, db)
ok(pub.event?.status === 'published' && core.TOKEN_RE.test(tokenOf(pub.shareUrl!)), 'publishing returns a share link with a 256-bit token')
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
eq((await store.submitRsvp(shareTok, { status: 'going' }, db)).error, 'name_required', 'a name is needed to answer through the share link')
const joined = await store.submitRsvp(shareTok, { status: 'going', plusOnes: 1, name: ' Srini ' }, db)
ok(joined.ok && core.TOKEN_RE.test(joined.personalToken!) && joined.personalToken !== shareTok, 'answering through the share link returns a personal link')
eq((await store.invitationFor(joined.personalToken!, db))?.view?.guest, { name: 'Srini', rsvp: 'going', plusOnes: 1, dietary: null, comment: null }, 'which shows and edits that guest')
eq((await store.submitRsvp(joined.personalToken!, { status: 'maybe' }, db)).ok, true, 'editing through the personal link changes the same guest')
eq((await store.listGuests(ME, draft.id, db)).filter(g => g.name === 'Srini').map(g => [g.source, g.rsvp, g.plusOnes]), [['share_link', 'maybe', 0]], 'one guest row, not two')

// 7. Capacity through the store.
const small = await store.createEvent(ME, { title: 'Small dinner', startsAt: future(48), venueName: 'Home', capacity: 2, maxPlusOnes: 3 }, db)
const smallPub = await store.publishEvent(ME, small.id, db)
const first = await store.submitRsvp(tokenOf(smallPub.shareUrl!), { status: 'going', plusOnes: 1, name: 'One' }, db)
const second = await store.submitRsvp(tokenOf(smallPub.shareUrl!), { status: 'going', name: 'Two' }, db)
eq([first.ok, second.ok, second.error, second.placesLeft], [true, false, 'full', 0], 'a full event refuses the next guest')
ok(core.TOKEN_RE.test(second.personalToken!), 'the refused guest still gets a personal link to answer differently')
eq((await store.submitRsvp(second.personalToken!, { status: 'maybe' }, db)).ok, true, 'for example as a maybe')

// 8. Revoke, disable the share link (test 12).
const nithin = (await store.listGuests(ME, draft.id, db)).find(g => g.name === 'Nithin')!
await store.revokeGuest(ME, draft.id, nithin.id, db)
eq((await store.invitationFor(nithinToken, db))?.mode, 'revoked', 'a revoked link shows as no longer active')
eq((await store.submitRsvp(nithinToken, { status: 'going' }, db)).error, 'revoked', 'and cannot answer')
await fails(store.revokeGuest(ME, mine2.id, nithin.id, db), 'not_found', "a guest cannot be revoked through a different event")
await store.disableShareLink(ME, draft.id, db)
eq([await store.shareLink(ME, draft.id, db), await store.invitationFor(shareTok, db)], [null, null], 'a disabled share link stops working')
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
  ['event.created', 'event.updated', 'event.published', 'guests.added', 'guest.revoked', 'share_link.disabled', 'event.cancelled'], 'organizer actions are recorded in order')
const empty = new PGlite()
await fails(store.listEvents(ME, pgliteSupabase(empty) as any), 'events_not_enabled', 'before the migration is applied the store says events are not enabled')
await empty.close()

// 11. Tokens are derived, stable and keyed.
eq(store.derivedToken('guest', nithin.id), store.derivedToken('guest', nithin.id), 'a derived token is stable')
ok(store.derivedToken('guest', nithin.id) !== store.derivedToken('share', nithin.id) && store.derivedToken('guest', nithin.id, { SUPABASE_SERVICE_ROLE_KEY: 'another-secret-value-000000' }) !== store.derivedToken('guest', nithin.id), 'it depends on its kind and on the server key')
assert.throws(() => store.derivedToken('guest', nithin.id, { SUPABASE_SERVICE_ROLE_KEY: 'short' }), (e: any) => e.code === 'events_token_key_missing'); checks++

// 12. The public route and page: what they must and must not do.
const route = readFileSync(new URL('../app/api/rsvp/[token]/route.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../app/rsvp/[token]/page.tsx', import.meta.url), 'utf8')
const client = readFileSync(new URL('../app/rsvp/[token]/rsvp-client.tsx', import.meta.url), 'utf8')
ok(/isEventToken\(token\)\) return notFound\(\)/.test(route) && (route.match(/isEventToken\(token\)/g) || []).length === 2, 'both handlers check the token shape first')
ok(/'Cache-Control': 'no-store'/.test(route) && /'Referrer-Policy': 'no-referrer'/.test(route) && /noindex/.test(route), 'responses are private, send no referrer and are not indexed')
ok(!/supabaseAdmin|owner_telegram_id|listGuests|headcount\(/.test(route + page + client), 'the public surface never touches organizer data')
ok(!/console\.(?:log|error|warn)/.test(route + page), 'the token and replies are never logged')
ok(/robots: \{ index: false, follow: false \}/.test(page) && /referrer: 'no-referrer'/.test(page), 'the page is not indexed and sends no referrer')
ok(/prefers-reduced-motion:no-preference/.test(client) && !/font-style:\s*italic/.test(client), 'animations respect reduced motion; no italics')
ok(/4096/.test(route), 'the request body is bounded')
eq([...route.matchAll(/^export (?:async function|const) (\w+)/gm)].map(m => m[1]).sort(), ['GET', 'POST', 'dynamic'], 'only route exports')

await pg.close()
console.log(`EVENTS_STORE_RSVP_OK ${checks} checks`)
