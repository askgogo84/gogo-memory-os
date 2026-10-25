import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 13 Oct 19:31: user connected a second Google account and the first was replaced; reads showed one.
// Run: npx tsx scripts/verify-multi-calendar.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
const m = await import('../lib/services/google-calendar-accounts')

const a = { email: 'a@x.com', hasMore: false, events: [
  { id: '1', iCalUID: 'u1', summary: 'Standup', start: { dateTime: '2026-10-14T09:00:00+05:30' } },
  { id: '3', iCalUID: 'u3', summary: 'Lunch', start: { dateTime: '2026-10-14T13:00:00+05:30' } }] }
const b = { email: 'b@y.com', hasMore: true, events: [
  { id: '2', iCalUID: 'u2', summary: 'Board call', start: { dateTime: '2026-10-14T11:00:00+05:30' } },
  { id: '9', iCalUID: 'u1', summary: 'Standup', start: { dateTime: '2026-10-14T09:00:00+05:30' } }] }
const merged = m.mergeAccountEvents([a, b])
assert.deepEqual(merged.events.map(e => e.summary), ['Standup', 'Board call', 'Lunch'], 'sorted by start; an invite on both calendars appears once')
assert.equal(merged.events[0]._account, 'a@x.com', 'the first account keeps the shared invite')
assert.equal(merged.events[1]._account, 'b@y.com')
assert.equal(merged.hasMore, true, 'one account being partial makes the whole list partial')
assert.equal(m.mergeAccountEvents([{ email: null, hasMore: false, events: [] }]).events.length, 0)
const recurring=[{id:'occurrence-one',iCalUID:'same-series',start:{dateTime:'2026-10-20T14:00:00Z'},end:{dateTime:'2026-10-20T15:00:00Z'}},
 {id:'occurrence-two',iCalUID:'same-series',start:{dateTime:'2026-10-27T14:00:00Z'},end:{dateTime:'2026-10-27T15:00:00Z'}}]
assert.equal(m.mergeAccountEvents([{email:'a@x.com',hasMore:false,events:recurring}]).events.length,2,'A series UID does not identify one recurring occurrence')
const one=recurring[0]
const mergeCopies=(left:any,right:any)=>m.mergeAccountEvents([{email:'a@x.com',hasMore:false,events:[left]},{email:'b@y.com',hasMore:false,events:[right]}]).events
assert.equal(mergeCopies(one,{...one,id:'other-account-id',start:{dateTime:'2026-10-20T19:30:00+05:30'},end:{dateTime:'2026-10-20T20:30:00+05:30'}}).length,1,'Equivalent-offset copies of the same occurrence still dedupe')
assert.equal(mergeCopies({...one,originalStartTime:one.start},{...one,originalStartTime:one.start,start:{dateTime:'2026-10-20T16:00:00Z'},end:{dateTime:'2026-10-20T17:00:00Z'}}).length,2,'Conflicting current intervals cannot silently lose a busy window')
assert.equal(mergeCopies({...one,transparency:'transparent'},one).length,2,'A non-busy copy may not hide a busy linked-account copy')
const allDay={id:'all-day',iCalUID:'shared-all-day',start:{date:'2026-10-22'},end:{date:'2026-10-23'}}
assert.equal(m.mergeAccountEvents([{email:'a@x.com',hasMore:false,timezone:'America/New_York',events:[allDay]},{email:'b@y.com',hasMore:false,timezone:'Asia/Kolkata',events:[allDay]}]).events.length,2,'All-day copies in distinct provider timezones represent distinct occupied instants')

assert.equal(m.describeCalendarAccounts([{ email: 'a@x.com' }]), 'Account: *a@x.com*')
assert.equal(m.describeCalendarAccounts([{ email: 'a@x.com' }, { email: 'b@y.com' }]), 'Accounts: *a@x.com* and *b@y.com*')
assert.equal(m.describeCalendarAccounts([{ email: null }]), '')

const cb = readFileSync(new URL('../app/api/calendar/callback/route.ts', import.meta.url), 'utf8')
assert.match(cb, /saveExtraCalendarAccount\(telegramId, newEmail, encrypted\)/, 'a different account is stored beside the primary')
assert.match(cb, /primaryEmail !== newEmail/, 'the same account connecting again refreshes the primary instead')
assert.match(cb, /if \(!addedAsExtra\) error = await savePrimary\(\)/, 'if the extra table is unavailable the connection still works as before')
for (const f of ['lib/agent/calendar-read.ts', 'lib/bot/handlers/morning-briefing.ts', 'lib/bot/handlers/plan-my-day.ts', 'lib/dashboard/queries.ts', 'lib/agent/autonomy-status.ts', 'lib/bot/process-message.ts']) {
  assert.match(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), /google-calendar-accounts/, `${f} reads every linked account`)
}
const sql = readFileSync(new URL('../supabase/google-calendar-accounts-v1.sql', import.meta.url), 'utf8')
assert.match(sql, /unique \(telegram_id, email\)/)
assert.match(sql, /enable row level security/)
console.log('Calendar: a second Google account is added beside the first and every read covers all linked accounts')
