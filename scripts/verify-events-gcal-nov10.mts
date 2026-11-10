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

function fakeGoogle(opts: { exists?: boolean; insertStatus?: number; writeStatus?: number; tamper?: (b: any) => any } = {}) {
  const calls: { method: string; url: string; body?: any }[] = []
  let stored: any = opts.exists ? { id: g.organizerCalendarId(ev().id), status: 'confirmed', summary: 'old' } : null
  const impl = (async (url: string, init: any = {}) => {
    const method = init.method || 'GET'; const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })
    const res = (status: number, j: any = {}) => ({ ok: status < 300, status, json: async () => j }) as any
    if (method === 'GET') return stored ? res(200, opts.tamper ? opts.tamper(stored) : { ...stored, htmlLink: 'https://www.google.com/calendar/event?eid=abc' }) : res(404)
    if (method === 'POST') { if (opts.insertStatus) return res(opts.insertStatus); stored = body; return res(200, body) }
    if (method === 'PUT') { if (opts.writeStatus) return res(opts.writeStatus); stored = body; return res(200, body) }
    return res(405)
  }) as any
  return { calls, impl }
}
const audits: any[] = []
const deps = (fx: ReturnType<typeof fakeGoogle>, over: any = {}) => ({ getEventImpl: async () => ev(over.event), refreshToken: async () => over.refresh === undefined ? 'rt' : over.refresh, accessToken: async () => over.access === undefined ? 'at' : over.access, fetchImpl: fx.impl, audit: async (...a: any[]) => { audits.push(a) } })

// 1. The id is stable and valid for Google; the body has no attendees and the full place.
const cid = g.organizerCalendarId(ev().id)
ok(/^[a-v0-9]{5,1024}$/.test(cid) && cid === g.organizerCalendarId(ev().id), 'one stable, Google-valid calendar id per event')
const body = g.calendarBody(ev() as any, cid)
eq([body.attendees, body.location, body.end.dateTime], [[], 'Toit, 298 100 Feet Rd, Indiranagar', '2037-03-14T16:00:00.000Z'], 'no attendees, the full place, two hours when no end is set')

// 2. First tap: created, notifications off, read back.
let fx = fakeGoogle()
let r = await g.addEventToGoogleCalendar('-884501501', ev().id, 3, deps(fx))
eq([r.ok, (r as any).result, (r as any).link], [true, 'created', 'https://www.google.com/calendar/event?eid=abc'], 'the first tap creates the entry and reports it only after reading it back')
ok(fx.calls.filter(c => c.method !== 'GET').every(c => /[?&]sendUpdates=none/.test(c.url)), 'Google is told to notify nobody')
ok(fx.calls.every(c => c.url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events')), "only the organizer's primary calendar is touched")
eq(audits.at(-1)?.slice(2), ['event.calendar_synced', { result: 'created', revision: 3 }], 'the write is in the audit trail')
// 3. Second tap: the same entry is updated, never a second one.
r = await g.addEventToGoogleCalendar('-884501501', ev().id, 3, deps(fx))
eq([(r as any).result, fx.calls.filter(c => c.method === 'POST').length], ['updated', 1], 'a second tap updates the same entry')
// 4. Deleted in Google but the id is still held (409): restored in place.
fx = fakeGoogle({ insertStatus: 409 }); const orig = fx.impl
fx.impl = (async (u: string, i: any = {}) => { const res = await orig(u, i); return res }) as any
r = await g.addEventToGoogleCalendar('-884501501', ev().id, 3, deps(fx))
eq([(r as any).result, fx.calls.map(c => c.method)], ['updated', ['GET', 'POST', 'PUT', 'GET']], 'an id Google still holds is restored in place')
// 5. Refusals: nothing written.
for (const [name, over, rev, want] of [
  ['the event changed since the page loaded', {}, 2, 'changed_meanwhile'], ['the event is cancelled', { event: { status: 'cancelled' } }, 3, 'cancelled'],
  ['the event has no date', { event: { starts_at: null } }, 3, 'no_date'], ['the calendar is not connected', { refresh: null }, 3, 'not_connected'],
  ['the Google sign-in has expired', { access: null }, 3, 'not_connected'],
] as const) {
  const f = fakeGoogle(); const x = await g.addEventToGoogleCalendar('-884501501', ev().id, rev as number, deps(f, over))
  eq([x.ok, (x as any).result, f.calls.length], [false, want, 0], `nothing is written when ${name}`)
}
// 6. Not sure: a 5xx, or a read-back that does not match, is "unknown", never success.
r = await g.addEventToGoogleCalendar('-884501501', ev().id, 3, deps(fakeGoogle({ exists: true, writeStatus: 503 })))
eq((r as any).result, 'unknown', 'a server error is reported as not sure')
r = await g.addEventToGoogleCalendar('-884501501', ev().id, 3, deps(fakeGoogle({ tamper: b => ({ ...b, attendees: [{ email: 'x@y.z' }] }) })))
eq((r as any).result, 'unknown', 'an entry that has attendees is not reported as done')
r = await g.addEventToGoogleCalendar('-884501501', ev().id, 3, deps(fakeGoogle({ tamper: b => ({ ...b, summary: 'other' }) })))
eq((r as any).result, 'unknown', 'an entry that does not match is not reported as done')
r = await g.addEventToGoogleCalendar('-884501501', ev().id, 3, deps({ calls: [], impl: (async () => { throw new Error('net') }) as any }))
eq((r as any).result, 'unknown', 'a dropped connection is reported as not sure')

// 7. Wiring: owner-only POST with the seen revision, same-origin first; the page confirms before it calls.
const route = readFileSync(new URL('../app/api/dashboard/events/[id]/route.ts', import.meta.url), 'utf8')
ok(/action === 'add_gcal' && typeof body\.revision === 'number'[\s\S]{0,120}addEventToGoogleCalendar\(owner, id, body\.revision\)/.test(route) && route.indexOf('verifySameOrigin(request)') < route.indexOf("'add_gcal'"), 'the route needs same origin, the session owner and the revision the organizer saw')
const ctl = readFileSync(new URL('../components/dashboard/events/event-controls.tsx', import.meta.url), 'utf8')
ok(/onClick=\{\(\) => \{ setAsk\(true\)[\s\S]*Nobody is invited and no one gets a message[\s\S]*onClick=\{run\}/.test(ctl), 'the button asks on the page, saying nobody is invited, before anything is written')
const src = readFileSync(new URL('../lib/events/gcal.ts', import.meta.url), 'utf8')
ok(!/Number\(\s*owner|parseInt\(\s*owner/.test(src) && /\.eq\('telegram_id', owner\)/.test(src), 'the owner id is never converted through Number')
ok(!/console\.(?:log|error)\([^\n]*(?:title|summary|token|venue|owner)/.test(src), 'no event text, owner id or token is logged')
console.log(`EVENTS_GCAL_OK ${checks} checks`)
