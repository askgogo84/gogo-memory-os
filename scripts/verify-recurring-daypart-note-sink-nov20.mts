// 20 Nov, items left open by #1542/#1543: "every Monday evening" fired at 09:00 with "evening" in the text; reminder text
// written by the chat model was saved without the scheduling-note clean-up; every Gmail 403 was logged with no reason.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const rem: any = await import('../lib/bot/handlers/reminders')
const istHour = (iso: string) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date(iso)))

for (const [t, msg, hh] of [
  ['remind me every Monday evening to call mom', 'call mom', '18:00'],
  ['remind me every friday night to back up the laptop', 'back up the laptop', '21:00'],
  ['remind me every Sunday morning to water the plants', 'water the plants', '09:00'],
  ['remind me every Tuesday afternoon to review the pipeline', 'review the pipeline', '14:00'],
] as const) {
  const p = rem.parseReminderIntent(t); assert.ok(p, t)
  assert.equal(p.kind, 'recurring', t)
  assert.equal(String(p.message).toLowerCase(), msg, `${t} → ${p.message}`)
  assert.ok(String(p.pattern).endsWith(`:${hh}`), `${t} → ${p.pattern}`)
  assert.equal(istHour(p.remindAtIso), Number(hh.slice(0, 2)), t)
}
// A clock time still wins; a weekly reminder with no part of day is still 9 am; a part of day in the task stays.
{ const p = rem.parseReminderIntent('remind me every Monday evening at 7:30pm to call mom'); assert.ok(String(p.pattern).endsWith(':19:30'), p.pattern); assert.doesNotMatch(p.message, /evening/i) }
{ const p = rem.parseReminderIntent('remind me every Monday to call mom'); assert.ok(String(p.pattern).endsWith(':09:00'), p.pattern) }
{ const p = rem.parseReminderIntent('remind me every Monday to book the Friday evening court'); assert.ok(String(p.pattern).endsWith(':09:00'), p.pattern); assert.match(p.message, /evening court/i, p.message) }
console.log('✓ "every Monday evening" repeats at 6 pm and keeps "evening" out of the text')

// Every reminder saved from chat is cleaned at the one place they all pass through.
const pm = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
const cr = pm.slice(pm.indexOf('async function createReminder('), pm.indexOf('async function createReminder(') + 700)
assert.ok(cr.indexOf('message = stripSchedulingNote(message) || message') > -1 && cr.indexOf('message = stripSchedulingNote(message) || message') < cr.indexOf('resolvePronounReminder'), 'cleaned before anything else uses the text')
assert.equal(rem.stripSchedulingNote('Time is not specified, so use Asia/Kolkata') || 'Time is not specified, so use Asia/Kolkata', 'Time is not specified, so use Asia/Kolkata', 'a message that is ONLY a note is kept rather than saved empty')
assert.equal(rem.stripSchedulingNote('Submit Jeevan Praman and included the note Time is not specified, so use Asia/Kolkata'), 'Submit Jeevan Praman')
console.log('✓ chat-saved reminder text is cleaned of a scheduling note, and never emptied')

// A Gmail 403 now says why, with nothing sensitive in the log line.
const g: any = await import('../lib/agent/google-workspace-read')
const res = (body: any) => ({ clone() { return this }, text: async () => typeof body === 'string' ? body : JSON.stringify(body) })
assert.deepEqual(await g.google403Reason(res({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Request had insufficient authentication scopes for nithin@example.com', errors: [{ reason: 'insufficientPermissions', message: 'secret text' }], details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }), 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=from%3Anithin%40example.com&access_token=SECRET'),
  { api: 'gmail:gmail/v1', status: 'PERMISSION_DENIED', reasons: ['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'] })
assert.deepEqual(await g.google403Reason(res({ error: { status: 'RESOURCE_EXHAUSTED', errors: [{ reason: 'rateLimitExceeded' }] } }), 'https://people.googleapis.com/v1/people/me/connections'), { api: 'people:v1/people', status: 'RESOURCE_EXHAUSTED', reasons: ['rateLimitExceeded'] })
assert.deepEqual(await g.google403Reason(res('<html>Forbidden</html>'), 'not a url'), { api: 'other', status: '', reasons: [] })
const line = JSON.stringify(await g.google403Reason(res({ error: { status: 'PERMISSION_DENIED', message: 'nithin@example.com', errors: [{ reason: 'domainPolicy', message: 'nithin@example.com' }] } }), 'https://www.googleapis.com/drive/v3/files?q=SECRET'))
assert.ok(!/SECRET|example\.com|@/.test(line), line)
const src = readFileSync(new URL('../lib/agent/google-workspace-read.ts', import.meta.url), 'utf8')
assert.match(src, /console\.error\('WORKSPACE_403:', JSON\.stringify\(await google403Reason\(response, url\)\)\)\s+throw new Error\('workspace_scope_required'\)/, 'the thrown error is unchanged')
console.log('✓ a Google 403 is logged with its API and reason codes only')
