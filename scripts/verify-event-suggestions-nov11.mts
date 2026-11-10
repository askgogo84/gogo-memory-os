// Addendum 5 (P1): suggestions from the organizer's own events. Read-only, explainable, dismissible. Fixtures only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteSupabase } from './lib/pglite-supabase.mts'
const store = await import('../lib/events/store')
const ns = await import('../lib/events/next-steps')
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, e: unknown, m: string) => { assert.deepEqual(a, e, m); checks++ }
const NOW = Date.parse('2037-11-10T09:00:00Z'), day = 86_400_000
const ev = (o: any) => ({ id: 'e1', owner_telegram_id: '1', title: 'Nithin’s birthday', kind: 'birthday', status: 'published', starts_at: new Date(NOW + 3 * day).toISOString(), revision: 2, ...o }) as any
const g = (name: string, rsvp = 'none', o: any = {}) => ({ name, rsvp, revoked: false, optedOut: false, ...o })

// 1. The rules.
let s = ns.suggestionFor(ev({}), [g('Divya'), g('Nithin', 'going'), g('Srini'), g('Mathew', 'declined')], NOW)
eq([s?.kind, s?.key, s?.href], ['no_replies', 'no_replies:r2', '/dashboard/events/e1'], 'a published event within a week with silent guests')
ok(/It is in 3 days and 2 of 4 guests have not replied \(Divya, Srini\)\. Nudging them is yours to do; I have not messaged anyone\./.test(s!.why), 'it says what it is based on, and that nothing was sent')
eq(ns.suggestionFor(ev({}), [g('Divya', 'going'), g('Nithin', 'maybe')], NOW), null, 'everyone replied: nothing to suggest')
eq(ns.suggestionFor(ev({}), [g('Divya', 'none', { revoked: true }), g('X', 'none', { optedOut: true }), g('Nithin', 'going')], NOW), null, 'removed and opted-out guests are not counted as silent')
eq(ns.suggestionFor(ev({ starts_at: new Date(NOW + 10 * day).toISOString() }), [g('Divya')], NOW), null, 'more than a week away: not yet')
eq(ns.suggestionFor(ev({}), [], NOW)?.kind, 'nobody_invited', 'published, close, no guests and no replies')
s = ns.suggestionFor(ev({ status: 'draft' }), [], NOW)
ok(s?.kind === 'draft_unpublished' && /still a draft, so there is no invitation link yet/.test(s.why), 'a dated draft close to its day')
eq(ns.suggestionFor(ev({ status: 'draft', starts_at: new Date(NOW + 30 * day).toISOString() }), [], NOW), null, 'a draft a month away: no nudge')
for (const o of [{ status: 'cancelled' }, { status: 'completed' }, { starts_at: new Date(NOW - day).toISOString() }, { starts_at: null }]) eq(ns.suggestionFor(ev(o), [g('Divya')], NOW), null, `no suggestion for ${JSON.stringify(o)}`)
ok(ns.suggestionFor(ev({}), Array.from({ length: 9 }, (_, i) => g(`G${i}`)), NOW)!.why.includes('(G0, G1, G2 and 6 more)'), 'at most three names, then a count')
ok(!/phone|\+91|\d{10}/.test(JSON.stringify(ns.suggestionFor(ev({}), [g('Divya')], NOW))), 'no phone numbers in a suggestion')

// 2. With the store: owner-scoped, dismissible, comes back when the event changes.
const pg = new PGlite()
await pg.exec('create role anon; create role authenticated; create role service_role;')
for (const f of ['20261110150000_gogo_events.sql', '20261110170000_gogo_events_v2.sql']) await pg.exec(readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8'))
const db = pgliteSupabase(pg) as any
store.setEventsClockForTests(() => NOW)
process.env.GOGO_EVENTS_TOKEN_SECRET = 'x'.repeat(40)
const OWNER = '884501501', OTHER = '5550001', env = { GOGO_EVENTS_OWNERS: `${OWNER},${OTHER}` }
const e1 = await store.createEvent(OWNER, { title: 'Nithin’s birthday', kind: 'birthday', startsAt: new Date(NOW + 3 * day).toISOString(), venueName: 'Home', capacity: 20 } as any, db)
const e2 = await store.createEvent(OWNER, { title: 'Team outing', kind: 'outing', startsAt: new Date(NOW + 5 * day).toISOString(), venueName: 'Windmills', capacity: 12 } as any, db)
await store.publishEvent(OWNER, e2.id, db)
await store.addGuests(OWNER, e2.id, [{ name: 'Divya' }, { name: 'Srini' }], db)
let list = await ns.getEventSuggestions(OWNER, { db, now: NOW, env })
eq(list.map(x => [x.kind, x.title]), [['draft_unpublished', 'Nithin’s birthday'], ['no_replies', 'Team outing']], 'one suggestion per event, soonest first')
eq(await ns.getEventSuggestions(OTHER, { db, now: NOW, env }), [], 'another organizer sees none of them')
eq(await ns.getEventSuggestions(OWNER, { db, now: NOW, env: {} }), [], 'Events not switched on for the owner: no suggestions')
eq(await ns.getEventSuggestions('', { db, now: NOW, env }), [], 'no owner: nothing')
// Dismiss.
const draftKey = list[0].key
eq(await ns.dismissSuggestion(OTHER, e1.id, draftKey, db).catch(() => 'refused'), 'refused', 'another person cannot dismiss it')
for (const bad of ['', 'x', 'draft_unpublished:r999', "no_replies:r1'; drop", { key: 1 }, null]) eq(await ns.dismissSuggestion(OWNER, e1.id, bad as any, db), false, `a key that is not this event’s current one is refused: ${JSON.stringify(bad)}`)
eq(await ns.dismissSuggestion(OWNER, e1.id, draftKey, db), true, 'the organizer dismisses it')
list = await ns.getEventSuggestions(OWNER, { db, now: NOW, env })
eq(list.map(x => x.title), ['Team outing'], 'a dismissed suggestion stays away')
await store.updateEvent(OWNER, e1.id, { venueName: 'Toit' } as any, db)
list = await ns.getEventSuggestions(OWNER, { db, now: NOW, env })
eq(list.map(x => x.title), ['Nithin’s birthday', 'Team outing'], 'when the event itself changes, it is looked at afresh')
// Nothing was sent, and no guest row or event was changed by reading.
const before = JSON.stringify([await store.listEvents(OWNER, db), await store.listGuests(OWNER, e2.id, db)])
await ns.getEventSuggestions(OWNER, { db, now: NOW, env })
eq(JSON.stringify([await store.listEvents(OWNER, db), await store.listGuests(OWNER, e2.id, db)]), before, 'reading suggestions changes nothing')
// A broken read yields fewer, never throws.
eq(await ns.getEventSuggestions(OWNER, { db: { from: () => { throw new Error('down') } } as any, now: NOW, env }), [], 'an unreadable store: no suggestions, no error')
// The cap.
for (let i = 0; i < 6; i++) await store.createEvent(OWNER, { title: `Draft ${i}`, kind: 'dinner', startsAt: new Date(NOW + (6 + i) * day).toISOString(), venueName: 'Home', capacity: 4 } as any, db)
eq((await ns.getEventSuggestions(OWNER, { db, now: NOW, env })).length, ns.MAX_SUGGESTIONS, 'at most four at a time')

// 3. Source: nothing here sends, and the page only reads it on Overview.
const src = readFileSync(new URL('../lib/events/next-steps.ts', import.meta.url), 'utf8')
ok(!/sendWhatsApp|sendGmail|twilio|agent_runs|todos|reminders'\)|notif/i.test(src.replace(/^\s*\/\/.*$/gm, '')), 'the suggestions code sends nothing and creates no task, reminder or notification')
const page = readFileSync(new URL('../app/dashboard/(app)/tasks/page.tsx', import.meta.url), 'utf8'), route = readFileSync(new URL('../app/api/dashboard/events/[id]/route.ts', import.meta.url), 'utf8')
ok(/const suggestions = overview && tab === 'overview' \? await getEventSuggestions\(String\(tg\)\) : \[\]/.test(page), 'read only on the Overview tab, which is itself behind its flag')
ok(route.indexOf("body?.action === 'dismiss_suggestion'") > route.indexOf('verifySameOrigin(request)') && route.indexOf("body?.action === 'dismiss_suggestion'") > route.indexOf('if (!eventsEnabledFor(owner))'), 'dismissing goes through the same signed-in, same-origin, owner-scoped route as other event actions')
const card = readFileSync(new URL('../components/dashboard/suggestion-cards.tsx', import.meta.url), 'utf8')
ok(/min-h-11/.test(card) && /Nothing has been done or sent/.test(card) && !/italic/.test(card), 'cards: 44 px targets, says nothing was done, no italics')
await pg.close()
console.log(`EVENT_SUGGESTIONS_OK ${checks} checks`)
