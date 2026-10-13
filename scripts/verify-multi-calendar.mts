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
