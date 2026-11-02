// Dots parity slice 1 (2 Nov): "what's scheduled" lists everything Gogo will do on its own, read-only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { isScheduledListQuery, composeScheduledList } = await import('../lib/agent/scheduled-list')

// Asked naturally on either surface; calendar questions stay calendar questions.
for (const q of ["what's scheduled", 'What is scheduled?', 'show my scheduled tasks', 'list scheduled', 'what have you scheduled for me', 'my recurring reminders', 'what will you do on your own', 'show me all my schedules'])
  assert.equal(isScheduledListQuery(q), true, q)
for (const q of ["what's on my schedule today", 'my schedule tomorrow', 'what is scheduled tomorrow', 'schedule a meeting with Divya', 'scheduled meetings this week', 'remind me every Monday at 9 am to pay rent', 'what are you working on'])
  assert.equal(isScheduledListQuery(q), false, q)
console.log('✓ recognises schedule-list questions; calendar and create requests are untouched')

const NOW = Date.parse('2026-11-02T06:30:00Z') // 12:00 pm IST
const at = (h: number) => new Date(NOW + h * 3600_000).toISOString()
const full = {
  reminders: [
    { id: 'r1', message: 'Pay rent', remind_at: at(24 * 29), is_recurring: true, recurring_pattern: 'monthly' },
    { id: 'r2', message: 'Gym', remind_at: at(18), is_recurring: true, recurring_pattern: 'daily' },
    { id: 'r3', message: 'Call Nithin about POS', remind_at: at(5), is_recurring: false, recurring_pattern: null },
    { id: 'r4', message: 'Renew passport', remind_at: at(24 * 20), is_recurring: false, recurring_pattern: null },
    { id: 'r5', message: 'Follow up', remind_at: at(2), is_recurring: true, recurring_pattern: 'followup:abc' },
  ],
  watchers: [
    { id: 'w1', type: 'product_price', condition_json: { title: 'iPhone 17 under ₹70,000' }, cadence_minutes: 360, next_check_at: at(3) },
    { id: 'w2', type: 'web_page', condition_json: { title: 'AskGogo launch news' }, cadence_minutes: 1440, next_check_at: at(20) },
    { id: 'w3', type: 'goal_review', condition_json: { title: 'internal goal review' }, cadence_minutes: 60 },
  ],
  goals: [{ id: 'g1', title: 'Keep the Goa trip on track', status: 'active', next_action: 'Book the airport cab' }],
  briefing: { enabled: true, time: '08:30' },
  checkIns: { everyMinutes: 240, quietStart: 22, quietEnd: 7 },
}
{
  const text = composeScheduledList(full as any, { timezone: 'Asia/Kolkata', now: NOW })
  assert.match(text, /^🗓️ \*Scheduled\* · 8 items/)
  assert.match(text, /\*Repeating reminders\*\n1\. Pay rent · monthly · next /)
  assert.match(text, /2\. Gym · daily · next /)
  assert.match(text, /\*Reminders in the next 7 days\*\n3\. Call Nithin about POS · /)
  assert.doesNotMatch(text, /Renew passport/, 'one-time reminders beyond 7 days are left out')
  assert.doesNotMatch(text, /Follow up ·/, 'internal follow-up series are not listed')
  assert.match(text, /\*Watches\*\n4\. iPhone 17 under ₹70,000 · checks every 6 hours · next /)
  assert.match(text, /5\. AskGogo launch news · checks once a day/)
  assert.doesNotMatch(text, /internal goal review/, 'goal-review plumbing is not a user schedule')
  assert.match(text, /\*Goals Gogo is working on\*\n6\. Keep the Goa trip on track · next: Book the airport cab/)
  assert.match(text, /\*Routine\*\n7\. Morning briefing · daily at 8:30 am\n8\. Gogo check-ins · every 4 hours, quiet 22:00 to 07:00/)
  assert.match(text, /stop watching <name>/)
  assert.match(text, /next Mon 2 Nov, 5:00 pm|next .*pm/i)
  console.log('✓ lists reminders, watches, goals, briefing and check-ins with next runs')
}
// A source that fails to read is named; the list never claims "nothing scheduled".
{
  const text = composeScheduledList({ ...full, watchers: null } as any, { timezone: 'Asia/Kolkata', now: NOW })
  assert.match(text, /I couldn't check watches just now/)
  assert.doesNotMatch(text, /Nothing is scheduled/)
  const allDown = composeScheduledList({ reminders: null, watchers: null, goals: null, briefing: null, checkIns: null }, { now: NOW })
  assert.match(allDown, /couldn't read your schedules/)
  assert.doesNotMatch(allDown, /Nothing is scheduled/)
  const empty = composeScheduledList({ reminders: [], watchers: [], goals: [], briefing: { enabled: false, time: '08:00' }, checkIns: null }, { now: NOW })
  assert.match(empty, /Nothing is scheduled right now/)
  console.log('✓ honest when a source fails; "nothing scheduled" only when every read succeeded')
}
// Read-only, exact owner, wired on both surfaces, and the brain hands it over.
{
  const src = readFileSync('lib/agent/scheduled-list.ts', 'utf8')
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/, 'read-only')
  assert.doesNotMatch(src, /sendWhatsApp|fetch\(/, 'no sends or provider calls')
  assert.doesNotMatch(src, /Number\(telegramId\)/)
  assert.match(src, /scheduled_owner_invalid/)
  assert.match(readFileSync('lib/agent/whatsapp-bridge.ts', 'utf8'), /tryGetScheduledList\(\{ actor, text:params\.text \}\)/)
  assert.match(readFileSync('app/api/dashboard/chat/route.ts', 'utf8'), /tryGetScheduledList\(\{ actor, text \}\)/)
  assert.match(readFileSync('lib/agent/brain.ts', 'utf8'), /isScheduledListQuery\(p\.text\)/)
  console.log('✓ read-only, exact-owner, wired on WhatsApp and dashboard, skipped by the brain')
}
console.log('Scheduled list (Dots parity slice 1) checks passed')
