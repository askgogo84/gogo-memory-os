// 23 Oct live dashboard run, round 2. Run: npx tsx scripts/verify-usecases-round2-oct23.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
const er = await import('../lib/bot/handlers/edit-reminder.ts')

// A19: "cancel that reminder" right after "Remind me … / actually make it 10am" cancels the one just made.
for (const t of ['cancel that reminder', 'cancel it', 'delete that', 'cancel the last one', 'Actually cancel that reminder please', 'remove this reminder']) assert.ok(er.isDeicticReminderRef(t.toLowerCase()), t)
for (const t of ['cancel water reminder', 'cancel 2', 'cancel the call nithin reminder', 'cancel all reminders']) assert.ok(!er.isDeicticReminderRef(t), t)
const src = readFileSync('lib/bot/handlers/edit-reminder.ts', 'utf8')
assert.match(src, /if \(!reminder && isDeicticReminderRef\(lower\)\)/)
assert.ok(!/2 \* 60 \* 60 \* 1000/.test(src), 'never by newest created_at (a daily series writes new rows)')
const rows = [
  { id: 1, message: 'Drink water', is_recurring: true, recurring_pattern: 'daily', created_at: new Date().toISOString() },
  { id: 2, message: 'Call Nithin', is_recurring: false, created_at: new Date(Date.now() - 60000).toISOString() },
]
assert.equal((er.pickReminderNamedIn('✅ *Reminder set*\n\nCall Nithin tomorrow at 9:00 am.', rows) as any)?.id, 2, 'the reminder the last reply named')
assert.equal(er.pickReminderNamedIn('Here is the weather', rows), null, 'no reminder named: ask, act on nothing')
assert.equal(er.pickReminderNamedIn('✅ Reminder set: Drink water and Call Nithin', rows), 'ambiguous')
assert.match(src, /Which reminder should I cancel\? Say its name/)
console.log('verify-usecases-round2-oct23: ok')
{
  const src2 = readFileSync('lib/agent/secure-computer.ts', 'utf8')
  assert.match(src2, /httpStatus===503\|\|\/\^\\s\*503\\b\.\*service unavailable\/i/, 'Amazon 503 is a provider block, not a retry')
  const { productIdentityMatches } = await import('../lib/commerce/product-identity.ts')
  assert.ok(productIdentityMatches('Apple AirPods Pro 2', 'Apple AirPods Pro (2nd Generation-USB C) TWS Earbuds'))
  assert.ok(!productIdentityMatches('Apple AirPods Pro 2', 'Apple AirPods Pro (3rd Generation)'))
  assert.ok(productIdentityMatches('AirPods 4', 'Apple AirPods (4th Gen) with Active Noise Cancellation'))
  console.log('verify-usecases-round2-oct23: browser ok')
}
{
  const gp = await import('../lib/agent/general-planner.ts')
  for (const t of ['Make a one-page brief on co-working spaces near Rajajinagar', 'Create a report on EV scooters under 1.5 lakh', 'Write a short guide to Goa in November', 'Prepare a checklist for my Dubai trip']) assert.ok(gp.shouldUseGeneralPlanner(t), t)
  for (const t of ['Make a reply to Divya', 'Write an email to Nithin about the report', 'What is a brief?']) assert.ok(!gp.shouldUseGeneralPlanner(t), t)
  console.log('verify-usecases-round2-oct23: make ok')
}
{
  const route = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
  assert.match(route, /handledBy: 'invite-links'/, 'invite commands on the dashboard')
  assert.match(route, /handledBy: 'world-time'/, 'world time answered instantly on the dashboard')
  const uf = readFileSync('lib/agent/understand-first.ts', 'utf8')
  assert.match(uf, /plan\\s\+\(\?:my\|the\|out\\s\+my\)/, 'plan my day is not a clarifying question')
  const wt = await import('../lib/bot/world-time.ts')
  assert.match(String(wt.worldTimeReply('What time is it in New York?')), /New York/)
  console.log('verify-usecases-round2-oct23: dashboard ok')
}
{
  const pc = await import('../lib/commerce/price-comparison.ts')
  const meta: any = { providers: [{ provider: 'amazon', status: 'blocked', needsInput: false }] }
  const rows = pc.withStoreFallback(meta)
  assert.deepEqual(rows.map((r: any) => r.provider), ['amazon', 'flipkart', 'croma', 'reliance'])
  assert.equal(meta.storeFallback, 'amazon')
  assert.equal(pc.withStoreFallback({ ...meta, providers: rows }).length, 4, 'once only')
  assert.equal(pc.withStoreFallback({ providers: [{ provider: 'amazon', status: 'blocked', needsInput: true }] }).length, 1, 'a sign-in/location ask is not a block')
  assert.equal(pc.withStoreFallback({ providers: [{ provider: 'amazon', status: 'observed' }] }).length, 1)
  console.log('verify-usecases-round2-oct23: store fallback ok')
}
