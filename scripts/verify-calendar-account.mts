import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 13 Oct 18:14: "Which calendar I am connected to" said "already connected" without naming the account.
// Run: npx tsx scripts/verify-calendar-account.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
const cal = await import('../lib/services/google-calendar')
const real = globalThis.fetch
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), {status})) as typeof fetch
try {
  globalThis.fetch = reply(200, {summary: 'someone@example.com'})
  assert.equal(await cal.fetchPrimaryCalendarAccount('t'), 'someone@example.com')
  globalThis.fetch = reply(200, {summary: 'Work stuff'})
  assert.equal(await cal.fetchPrimaryCalendarAccount('t'), null, 'a renamed calendar is not shown as an account')
  globalThis.fetch = reply(401, {error: 'x'})
  assert.equal(await cal.fetchPrimaryCalendarAccount('t'), null)
  globalThis.fetch = (async () => { throw new Error('net') }) as typeof fetch
  assert.equal(await cal.fetchPrimaryCalendarAccount('t'), null)
} finally { globalThis.fetch = real }
const pm = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
assert.match(pm, /describeCalendarAccounts\(await getAllCalendarAccountAccess\(resolvedUser\.telegramId\)/)
assert.match(pm, /it adds to the ones above, it does not replace them/)
console.log('Calendar: the connected Google account is named in the "already connected" reply')
