// Spaces PR 3: block resolvers. Off capabilities are never read, unlinked sources say so, errors stay per-block,
// the flag defaults off, and ids reach readers as strings.
import assert from 'node:assert/strict'
import { resolveSpace, READERS, type SourceDeps } from '../lib/spaces/sources'
import { templateSpace } from '../lib/spaces/schema'
import { spacesEnabledFor } from '../lib/spaces/sources-live'

const OWNER = '-884501501'
const NOW = Date.parse('2026-11-08T06:30:00Z')
const calls: string[] = []
const deps = (over: Partial<SourceDeps> = {}): SourceDeps => ({
  todayCalendar: async o => { calls.push(`cal:${o}`); return { ok: true, connected: true, events: [{ title: 'Standup with Nithin', time: '10:00 am' }] } },
  todayReminders: async o => { calls.push(`rem:${o}`); return { ok: true, reminders: [{ message: 'Call Divya', remind_at: '2026-11-08T09:30:00Z' }] } },
  openLoops: async o => { calls.push(`loops:${o}`); return [{ title: 'Reply to Mathew', due_at: '2026-11-07T10:00:00Z' }, { title: 'Book Goa cab', due_at: '2026-11-08T12:00:00Z' }] },
  mailNeedsYou: async o => { calls.push(`mail:${o}`); return { connected: false, items: [] } },
  nextTrip: async () => [],
  tipplr: null,
  ...over,
})
const ctx = (d: SourceDeps) => ({ owner: OWNER, now: NOW, tz: 'Asia/Kolkata', deps: d })
let n = 0; const ok = (name: string) => { n++; console.log('PASS', name) }

{ // all readable
  calls.length = 0
  const r = await resolveSpace(templateSpace('my_day', { kind: 'user', telegramId: OWNER }, NOW), ctx(deps()), () => 'read')
  assert.equal(r.today.status, 'ok'); assert.equal((r.today as any).items[0].title, 'Standup with Nithin')
  assert.equal(r.due.status, 'ok'); assert.match((r.due as any).items[0].time, /3:00/)
  assert.equal((r.loops as any).items[0].pill.text, 'overdue'); assert.equal((r.loops as any).items[1].pill.text, 'today')
  assert.equal(r.mail.status, 'not_connected'); assert.equal((r.mail as any).capability, 'email')
  assert.ok(calls.every(c => c.endsWith(`:${OWNER}`)), 'owner id reaches readers as the exact string'); ok('my_day resolves, owner passed as string')
}
{ // email off → mail never read
  calls.length = 0
  const r = await resolveSpace(templateSpace('my_day', { kind: 'user', telegramId: OWNER }, NOW), ctx(deps()), c => c === 'email' ? 'off' : 'read')
  assert.equal(r.mail.status, 'not_connected'); assert.match((r.mail as any).message, /Turned off/)
  assert.ok(!calls.some(c => c.startsWith('mail:')), 'mail reader not called when email is off'); ok('off capability is never read')
}
{ // one reader throws → only that block errors
  const r = await resolveSpace(templateSpace('my_day', { kind: 'user', telegramId: OWNER }, NOW), ctx(deps({ openLoops: async () => { throw new Error('db down') } })), () => 'read')
  assert.equal(r.loops.status, 'error'); assert.equal(r.today.status, 'ok'); ok('reader failure stays in its block')
}
{ // calendar unreadable / not linked / empty
  assert.equal((await READERS['today.calendar']({ ...ctx(deps({ todayCalendar: async () => ({ ok: false }) })), workspaceId: null }, {})).status, 'error')
  assert.equal((await READERS['today.calendar']({ ...ctx(deps({ todayCalendar: async () => ({ ok: true, connected: false }) })), workspaceId: null }, {})).status, 'not_connected')
  assert.equal((await READERS['today.calendar']({ ...ctx(deps({ todayCalendar: async () => ({ ok: true, connected: true, events: [] }) })), workspaceId: null }, {})).status, 'empty')
  ok('calendar error / not connected / empty states')
}
{ // trip board: empty trip, fare watch empty state, note block has no data entry
  const r = await resolveSpace(templateSpace('trip_board', { kind: 'user', telegramId: OWNER }, NOW), ctx(deps()), () => 'read')
  assert.equal(r.trip.status, 'empty'); assert.match((r.fares as any).message, /watch fares/); assert.equal(r.notes, undefined); ok('trip board states')
}
{ // tipplr blocks only with a workspace + adapter
  const ws = '7e1b6f4a-2c0d-4b58-9c3e-5a1f0d9b2e77'
  const tip: SourceDeps['tipplr'] = { exceptions: async w => { assert.equal(w, ws); return [{ orderId: 'T1', outlet: 'Indiranagar', items: '2× Paneer roll', waitingMin: 9 }] }, oosToday: async () => ({ cancelledOos: 3, outlets: 2, peak: '13:00' }), digest: async () => 'ok' }
  const r = await resolveSpace(templateSpace('tipplr_exceptions', { kind: 'workspace', workspaceId: ws }, NOW), ctx(deps({ tipplr: tip })), () => 'read')
  assert.deepEqual((r.exceptions as any).table.rows[0], ['#T1', 'Indiranagar', '2× Paneer roll', '9 min'])
  assert.equal((r.oos as any).stats[0].n, '3')
  const u = await resolveSpace(templateSpace('tipplr_exceptions', { kind: 'user', telegramId: OWNER }, NOW), ctx(deps({ tipplr: tip })), () => 'read')
  assert.equal(u.exceptions.status, 'error'); ok('tipplr blocks need a workspace scope')
}
{ // live data shapes seen on 8 Nov: one meeting from several calendars, the same loop twice, HTML entities
  const r = await resolveSpace(templateSpace('my_day', { kind: 'user', telegramId: OWNER }, NOW), ctx(deps({
    todayCalendar: async () => ({ ok: true, connected: true, events: [
      ...Array.from({ length: 10 }, () => ({ title: 'Daily Connect-Standup Call', time: '11:30am', startAt: '2026-11-08T06:00:00Z' })),
      { title: 'Review calendar through move date', time: '12:00 am', startAt: '2026-11-07T18:30:00Z' },
    ] }),
    openLoops: async () => [{ title: 'Review service billing notice' }, { title: 'Review service billing notice ' }, { title: 'Reply to IndiaFilings', summary: 'your company&#39;s annual accounts &amp; filings' }],
  })), () => 'read')
  assert.deepEqual((r.today as any).items.map((i: any) => i.title), ['Review calendar through move date', 'Daily Connect-Standup Call'])
  assert.equal((r.loops as any).items.length, 2)
  assert.equal((r.loops as any).items[1].sub, "your company's annual accounts & filings"); ok('duplicates collapse, calendar sorted, entities decoded')
}
{ // flag
  assert.equal(spacesEnabledFor(OWNER, {}), false)
  assert.equal(spacesEnabledFor(OWNER, { GOGO_SPACES_OWNERS: `123, ${OWNER}` }), true)
  assert.equal(spacesEnabledFor('-88450150', { GOGO_SPACES_OWNERS: OWNER }), false)
  assert.equal(spacesEnabledFor('5', { GOGO_SPACES: '1' }), true); ok('flag off by default; allowlist is exact')
}
console.log(`verify-spaces-sources-nov8: ${n} passed`)
