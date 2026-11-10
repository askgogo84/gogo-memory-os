// AskGogo Events: the organizer's own Google Calendar entry. No network: Google is a fake that records every call.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }
const g = await import('../lib/events/gcal.ts')

const ev = (over: any = {}) => ({ id: '11111111-2222-4333-8444-555555555555', owner_telegram_id: '-884501501', title: 'Divya and Nithin dinner', kind: 'dinner', status: 'published',
  starts_at: '2037-03-14T14:00:00.000Z', ends_at: null, timezone: 'Asia/Kolkata', venue_name: 'Toit', venue_address: '298 100 Feet Rd, Indiranagar', address_visibility: 'going',
  online_url: null, host_name: 'Goverdhan', description: 'Bring an appetite', dress_code: null, capacity: null, max_plus_ones: 1, rsvp_closes_at: null, template: 1, revision: 3, ...over })

type Entry = any
function fakeGoogle(opts: { entries?: Entry[]; failOn?: Partial<Record<'GET' | 'POST' | 'PATCH' | 'DELETE' | 'LIST', number>>; tamper?: (b: any) => any } = {}) {
  const calls: { method: string; url: string; body?: any }[] = []
  const db = new Map<string, Entry>((opts.entries || []).map(x => [x.id, x]))
  const impl = (async (url: string, init: any = {}) => {
    const method = init.method || 'GET'; const body = init.body ? JSON.parse(init.body) : undefined
    const u = new URL(url); const id = decodeURIComponent(u.pathname.split('/events')[1]?.replace(/^\//, '') || '')
    const kind = method === 'GET' && !id ? 'LIST' : method
    calls.push({ method: kind, url, body })
    const res = (status: number, j: any = {}) => ({ ok: status < 300, status, json: async () => j }) as any
    if (opts.failOn?.[kind as 'GET']) return res(opts.failOn[kind as 'GET']!)
    if (kind === 'LIST') return res(200, { items: [...db.values()].filter(x => x.iCalUID === u.searchParams.get('iCalUID') && x.status !== 'cancelled') })
    if (kind === 'GET') { const x = db.get(id); return x ? res(200, opts.tamper ? opts.tamper(x) : { ...x, htmlLink: 'https://www.google.com/calendar/event?eid=abc' }) : res(404) }
    if (kind === 'POST') { if (db.has(body.id)) return res(409); db.set(body.id, body); return res(200, body) }
    if (kind === 'PATCH') { const x = db.get(id); if (!x) return res(404); db.set(id, { ...x, ...body }); return res(200, db.get(id)) }
    if (kind === 'DELETE') { const x = db.get(id); if (!x) return res(404); db.set(id, { ...x, status: 'cancelled' }); return res(204) }
    return res(405)
  }) as any
  return { calls, impl, db }
}
const audits: any[] = []
const deps = (fx: { impl: any }, over: any = {}) => ({ getEventImpl: over.getEventImpl || (async () => ev(over.event)), refreshToken: async () => over.refresh === undefined ? 'rt' : over.refresh, accessToken: async () => over.access === undefined ? 'at' : over.access, fetchImpl: fx.impl, audit: over.audit || (async (...a: any[]) => { audits.push(a) }) })
const ID = ev().id, OWNER = '-884501501'

// 1. The ids are stable and valid for Google, and the iCalUID is the calendar file's UID.
const cid = g.organizerCalendarId(ID)
ok(/^[a-v0-9]{5,1024}$/.test(cid) && cid === g.organizerCalendarId(ID), 'one stable, Google-valid calendar id per event')
const icsRoute = readFileSync(new URL('../app/api/dashboard/events/[id]/route.ts', import.meta.url), 'utf8')
ok(/createHash\('sha256'\)\.update\(`organizer:\$\{e\.id\}`\)\.digest\('hex'\)\.slice\(0, 32\)/.test(icsRoute) && g.organizerIcalUid(ID).endsWith('@askgogo.in'), "the iCalUID is the organizer calendar file's UID")
const f = g.calendarFields(ev() as any)
eq([f.location, f.end.dateTime, 'attendees' in f], ['Toit, 298 100 Feet Rd, Indiranagar', '2037-03-14T16:00:00.000Z', false], 'the full place, two hours when no end is set, and no attendees field at all')

// 2. First tap: created with no attendees, notifications off, read back.
let fx = fakeGoogle()
let r: any = await g.addEventToGoogleCalendar(OWNER, ID, 3, deps(fx))
eq([r.ok, r.result, r.link], [true, 'created', 'https://www.google.com/calendar/event?eid=abc'], 'the first tap creates the entry and reports it only after reading it back')
const post = fx.calls.find(c => c.method === 'POST')!
eq([post.body.attendees, post.body.iCalUID], [undefined, undefined], 'the new entry has no attendees, and no iCalUID (Google sets that only on import)')
ok(fx.calls.filter(c => !['GET', 'LIST'].includes(c.method)).every(c => /[?&]sendUpdates=none/.test(c.url)), 'Google is told to notify nobody')
ok(fx.calls.every(c => c.url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events')), "only the organizer's primary calendar is touched")
eq(audits.at(-1)?.slice(2), ['event.calendar_synced', { result: 'created', revision: 3 }], 'the write is in the audit trail')
// 3. Second tap after a change: only Gogo's fields are patched; reminders and colour set in Google stay.
fx.db.set(cid, { ...fx.db.get(cid), reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }, colorId: '5' })
r = await g.addEventToGoogleCalendar(OWNER, ID, 4, deps(fx, { event: { revision: 4, starts_at: '2037-03-14T15:00:00.000Z' } }))
eq([r.result, fx.calls.filter(c => c.method === 'POST').length, fx.db.get(cid).colorId, fx.db.get(cid).reminders.overrides[0].minutes, fx.db.get(cid).start.dateTime], ['updated', 1, '5', 30, '2037-03-14T15:00:00.000Z'], "a second tap updates the same entry and keeps what was set in Google")
ok(!('attendees' in fx.calls.find(c => c.method === 'PATCH')!.body) && !('id' in fx.calls.find(c => c.method === 'PATCH')!.body), 'the update sends only Gogo fields')
// 4. Guests added in Google: Gogo leaves the entry alone.
fx = fakeGoogle({ entries: [{ id: cid, status: 'confirmed', summary: 'x', attendees: [{ email: 'nithin@example.com' }, { email: 'me@example.com', self: true }] }] })
r = await g.addEventToGoogleCalendar(OWNER, ID, 3, deps(fx))
eq([r.result, fx.calls.map(c => c.method)], ['has_guests', ['GET']], 'an entry with guests added in Google is not changed')
// 5. Imported earlier from the calendar file: that entry is adopted, not duplicated.
fx = fakeGoogle({ entries: [{ id: 'imported123', iCalUID: g.organizerIcalUid(ID), status: 'confirmed', summary: 'old' }] })
r = await g.addEventToGoogleCalendar(OWNER, ID, 3, deps(fx))
eq([r.result, fx.calls.map(c => c.method), fx.db.size], ['updated', ['GET', 'LIST', 'PATCH', 'GET'], 1], 'an entry imported from the calendar file is updated, not duplicated')
// 6. Deleted in Google but still in its bin: restored in place.
fx = fakeGoogle({ entries: [{ id: cid, status: 'cancelled', summary: 'x' }] })
r = await g.addEventToGoogleCalendar(OWNER, ID, 3, deps(fx))
eq([r.result, fx.db.get(cid).status], ['updated', 'confirmed'], 'an entry deleted in Google is restored in place')
{ // An id Google still holds (409) but that now has guests added in Google: not restored.
  const fk = fakeGoogle(); fk.db.set(cid, { id: cid, status: 'confirmed', attendees: [{ email: 'nithin@example.com' }] })
  const orig = fk.impl; let first = true
  fk.impl = (async (u: string, i: any = {}) => { if (first && !i.method) { first = false; return { ok: false, status: 404, json: async () => ({}) } } return orig(u, i) }) as any
  const x: any = await g.addEventToGoogleCalendar(OWNER, ID, 3, deps(fk))
  eq([x.result, fk.calls.some(c => c.method === 'PATCH')], ['has_guests', false], 'a held id with guests added in Google is not restored')
}
// 7. Refusals: nothing written.
for (const [name, over, rev, want] of [
  ['the event changed since the page loaded', {}, 2, 'changed_meanwhile'], ['the event is cancelled', { event: { status: 'cancelled' } }, 3, 'cancelled'],
  ['the event has no date', { event: { starts_at: null } }, 3, 'no_date'], ['the calendar is not connected', { refresh: null }, 3, 'not_connected'],
  ['the Google sign-in has expired', { access: null }, 3, 'not_connected'],
] as const) {
  const fk = fakeGoogle(); const x: any = await g.addEventToGoogleCalendar(OWNER, ID, rev as number, deps(fk, over))
  eq([x.ok, x.result, fk.calls.length], [false, want, 0], `nothing is written when ${name}`)
}
fx = fakeGoogle({ failOn: { GET: 401 } }); r = await g.addEventToGoogleCalendar(OWNER, ID, 3, deps(fx))
eq([r.result, fx.calls.length], ['not_connected', 1], 'Google refusing the sign-in is "not connected", with nothing written')
fx = fakeGoogle({ failOn: { GET: 403 } }); r = await g.addEventToGoogleCalendar(OWNER, ID, 3, deps(fx))
eq(r.result, 'failed', 'a 403 on the entry is a failure, not a reason to reconnect')
fx = fakeGoogle({ entries: [{ id: cid, status: 'confirmed', summary: 'x', location: 'Typed in Google', description: 'my notes' }] })
r = await g.addEventToGoogleCalendar(OWNER, ID, 3, deps(fx, { event: { venue_name: null, venue_address: null, description: null } }))
eq([r.result, fx.db.get(cid).location, fx.db.get(cid).description], ['updated', 'Typed in Google', 'my notes'], 'an empty place or notes in Gogo does not wipe what was typed in Google')
// 8. Not sure: never success.
r = await g.addEventToGoogleCalendar(OWNER, ID, 3, deps(fakeGoogle({ entries: [{ id: cid, status: 'confirmed' }], failOn: { PATCH: 503 } })))
eq(r.result, 'unknown', 'a server error is reported as not sure')
r = await g.addEventToGoogleCalendar(OWNER, ID, 3, deps(fakeGoogle({ tamper: b => ({ ...b, description: 'cut' }) })))
eq(r.result, 'unknown', 'a description that does not match is not reported as done')
r = await g.addEventToGoogleCalendar(OWNER, ID, 3, deps(fakeGoogle({ tamper: b => ({ ...b, attendees: [{ email: 'x@y.z' }] }) })))
eq(r.result, 'unknown', 'an entry that has guests after the write is not reported as done')
r = await g.addEventToGoogleCalendar(OWNER, ID, 3, deps({ impl: (async () => { throw new Error('net') }) as any }))
eq(r.result, 'unknown', 'a dropped connection is reported as not sure')
// 9. A failed audit does not hide a verified success; an edit during the write is reported.
r = await g.addEventToGoogleCalendar(OWNER, ID, 3, deps(fakeGoogle(), { audit: async () => { throw new Error('db') } }))
eq([r.ok, r.result], [true, 'created'], 'a failed audit write does not turn a verified success into "not sure"')
let n = 0
r = await g.addEventToGoogleCalendar(OWNER, ID, 3, deps(fakeGoogle(), { getEventImpl: async () => ev({ revision: n++ ? 4 : 3 }) }))
eq([r.ok, r.changedSince], [true, true], 'an edit that landed during the write is reported, so the organizer taps again')
// 10. Removing a cancelled event's entry.
fx = fakeGoogle({ entries: [{ id: cid, status: 'confirmed', summary: 'x' }] })
r = await g.removeEventFromGoogleCalendar(OWNER, ID, deps(fx, { event: { status: 'cancelled' } }))
eq([r.ok, r.result, fx.db.get(cid).status], [true, 'removed', 'cancelled'], 'a cancelled event is removed from the calendar, and that is read back')
ok(fx.calls.find(c => c.method === 'DELETE')!.url.includes('sendUpdates=none'), 'removing notifies nobody')
r = await g.removeEventFromGoogleCalendar(OWNER, ID, deps(fx, { event: { status: 'cancelled' } }))
eq(r.result, 'not_there', 'removing twice says it is not there')
fx = fakeGoogle({ entries: [{ id: cid, status: 'confirmed' }] })
eq([(await g.removeEventFromGoogleCalendar(OWNER, ID, deps(fx)) as any).result, fx.calls.length], ['not_cancelled', 0], 'a live event is never removed')
fx = fakeGoogle({ entries: [{ id: cid, status: 'confirmed', attendees: [{ email: 'nithin@example.com' }] }] })
eq([(await g.removeEventFromGoogleCalendar(OWNER, ID, deps(fx, { event: { status: 'cancelled' } })) as any).result, fx.calls.some(c => c.method === 'DELETE')], ['has_guests', false], 'an entry with guests added in Google is not deleted')

// 7. Wiring: owner-only POST with the seen revision, same-origin first; the page confirms before it calls.
const route = readFileSync(new URL('../app/api/dashboard/events/[id]/route.ts', import.meta.url), 'utf8')
ok(/action === 'add_gcal' && typeof body\.revision === 'number'\) return gcalResponse\(await addEventToGoogleCalendar\(owner, id, body\.revision\)\)/.test(route) && /action === 'remove_gcal'\) return gcalResponse\(await removeEventFromGoogleCalendar\(owner, id\)\)/.test(route) && route.indexOf('verifySameOrigin(request)') < route.indexOf("'add_gcal'"), 'the route needs same origin, the session owner and the revision the organizer saw')
const ctl = readFileSync(new URL('../components/dashboard/events/event-controls.tsx', import.meta.url), 'utf8')
ok(/onClick=\{\(\) => \{ setAsk\(true\)[\s\S]*No one gets a message[\s\S]*Nobody is invited and no one gets a message[\s\S]*onClick=\{run\}/.test(ctl), 'the button asks on the page, saying nobody is invited or messaged, before anything is written or removed')
const src = readFileSync(new URL('../lib/events/gcal.ts', import.meta.url), 'utf8')
ok(!/Number\(\s*owner|parseInt\(\s*owner/.test(src) && /\.eq\('telegram_id', owner\)/.test(src), 'the owner id is never converted through Number')
ok(!/console\.(?:log|error)\([^\n]*(?:title|summary|token|venue|owner)/.test(src), 'no event text, owner id or token is logged')
console.log(`EVENTS_GCAL_OK ${checks} checks`)
