// Quiet WhatsApp + one nudge + cheaper brain (4 Nov, owner request). Necessary sends stay; volunteered ones stop.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
process.env.ANTHROPIC_API_KEY ||= 'test'
const read = (f: string) => readFileSync(f, 'utf8')

// 1. Policy: quiet by default; GOGO_PROACTIVE=all is the kill switch back.
const pol = await import('../lib/channels/proactive-policy')
delete process.env.GOGO_PROACTIVE
assert.equal(pol.mayVolunteer('morning_briefing', {}), false)
assert.equal(pol.mayVolunteer('check_in', { GOGO_PROACTIVE: 'ALL' }), true)
assert.equal(pol.volunteeredSendsOn({ GOGO_PROACTIVE: 'quiet' }), false)
console.log('✓ volunteered messages are off by default; GOGO_PROACTIVE=all turns them back on')

// 2. Volunteered WhatsApp briefing is gated per channel, never by skipping an opted-in
// EMAIL briefing or its receipt reconciliation. Other volunteered senders still exit early.
const dailyBriefRoute = read('app/api/cron/daily-briefings/route.ts')
assert.match(dailyBriefRoute, /if \(!isCronAuthorized\(req\)\) return NextResponse\.json\(/, 'authorize cron before any work')
assert.match(dailyBriefRoute, /return withDeliveryHeartbeat\('briefing', \(\) => runDelivery\(req\)\)/, 'delivery worker continues in quiet mode')
assert.doesNotMatch(dailyBriefRoute, /if \(!mayVolunteer\('morning_briefing'\)\) return NextResponse\.json\(/, 'quiet mode must not short-circuit opted-in email')
assert.match(dailyBriefRoute, /const allowVolunteeredWhatsApp = mayVolunteer\('morning_briefing'\)/)
assert.match(dailyBriefRoute, /if \(allowVolunteeredWhatsApp && user\.briefing_enabled && phone/, 'WhatsApp eligibility remains gated')
assert.match(dailyBriefRoute, /: allowVolunteeredWhatsApp && fresh\.briefing_enabled === true/, 'WhatsApp readiness rechecks policy and consent')
assert.match(dailyBriefRoute, /if \(Date\.now\(\) < deadline && user\.daily_brief_email_enabled && email/, 'email remains expressly opt-in')
assert.match(dailyBriefRoute, /await reconcileBriefingEmailReceipts\(/, 'receipt reconciliation cannot be silenced with WhatsApp')
assert.match(read('lib/agent/autonomy-pulse.ts'), /if\(!mayVolunteer\('check_in'\)\)return \{[^}]*quiet:true\}\n  const ids=await candidateUserIds\(\)/)
assert.match(read('lib/agent/meeting-nudge.ts'), /if \(!mayVolunteer\('meeting_nudge'\)\) return [^\n]+\n  const nowIso/)
assert.match(read('lib/agent/goal-engine.ts'), /if\(!actor\.whatsappId\)return\n[^\n]*\n[^\n]*\n  if\(!mayVolunteer\('goal_review'\)\)return/)
const pulse = await import('../lib/agent/autonomy-pulse')
assert.deepEqual(await pulse.processAutonomyPulse(), { considered: 0, sent: 0, skipped: 0, failed: 0, results: [], quiet: true }, 'returns before any read')
console.log('✓ volunteered WhatsApp briefings, check-ins, meeting nudges and goal-review pings are quiet; subscribed email continues')

// 3. Necessary sends are untouched: reminders, follow-ups, watch alerts, flight tracking, task results, OTP, ops.
for (const f of ['app/api/cron/reminders/route.ts', 'app/api/followups/route.ts', 'lib/agent/watch-alert-delivery.ts', 'lib/agent/flight-track.ts', 'lib/agent/run-notify.ts', 'lib/agent/run-outcome-delivery.ts', 'lib/dashboard/whatsapp-otp.ts', 'lib/ops/run.ts'])
  assert.doesNotMatch(read(f), /proactive-policy|mayVolunteer/, `${f} must keep sending`)
console.log('✓ reminders, follow-ups, watch alerts, flights, task results, sign-in codes and ops alerts still send')

// 4. One nudge after 3 quiet days, once per quiet spell, daytime only.
const r = await import('../lib/agent/reengage')
const DAY = 86_400_000, now = Date.parse('2026-11-04T06:00:00Z')
const last = new Map<string, number>([['quiet4', now - 4 * DAY], ['active1', now - 1 * DAY], ['old40', now - 40 * DAY], ['nudged', now - 5 * DAY], ['nudgedBefore', now - 3.5 * DAY], ['edge3', now - 3 * DAY]])
const nudges = new Map<string, number>([['nudged', now - 1 * DAY], ['nudgedBefore', now - 10 * DAY]])
assert.deepEqual(r.pickQuietUsers(last, nudges, now).sort(), ['edge3', 'nudgedBefore', 'quiet4'])
assert.equal(r.pickQuietUsers(last, nudges, now, 1).length, 1, 'capped')
assert.equal(r.inSendWindow(Date.parse('2026-11-04T06:00:00Z')), true, '11:30 IST')
assert.equal(r.inSendWindow(Date.parse('2026-11-04T16:00:00Z')), false, '21:30 IST')
assert.ok(r.REENGAGE_TEXT.length <= 400, 'fits the template variable')
assert.doesNotMatch(r.REENGAGE_TEXT, /\d{3,}|offer|discount|upgrade|₹/i, 'generic, no marketing, no numbers')
const src = read('lib/agent/reengage.ts')
assert.ok(src.indexOf("event_type: 'reengagement_sent'") < src.indexOf('await sender('), 'recorded before sending: a crash can only skip, never double-send')
assert.match(src, /if \(nErr\) return \{ ok: false/, 'unknown nudge history sends nothing')
assert.match(src, /user\.access_status && user\.access_status !== 'active'/, 'blocked users are never nudged')
assert.ok(JSON.parse(read('vercel.json')).crons.some((c: any) => c.path === '/api/cron/reengage' && c.schedule === '0 6 * * *'), 'daily at 11:30 IST')
console.log('✓ one generic nudge after 3 quiet days, once per quiet spell, daytime only, recorded before it sends')

// 5. Cheaper brain: Haiku first only when switched on; Sonnet for replies and failures; comparisons saved.
const b = await import('../lib/agent/brain')
assert.equal(b.brainFastOn({}), false); assert.equal(b.brainFastOn({ GOGO_BRAIN_FAST: 'on' }), true)
assert.equal(b.FAST_MODEL, 'claude-haiku-5-5')
assert.equal(b.needsMainModel({ kind: 'handle', instruction: 'x', rewritten: false }), false)
assert.equal(b.needsMainModel({ kind: 'flight', flightNo: 'EK569', track: false }), false)
assert.equal(b.needsMainModel({ kind: 'later', question: 'q' }), false)
assert.equal(b.needsMainModel({ kind: 'reply', text: 'hi' }), true)
assert.equal(b.needsMainModel({ kind: 'ask', text: 'which?' }), true)
assert.equal(b.needsMainModel({ kind: 'skip', reason: 'error:timeout' }), true)
assert.equal(b.needsMainModel({ kind: 'skip', reason: 'no_tool_use' }), false)
const bsrc = read('lib/agent/brain.ts')
assert.match(bsrc, /if \(fast && needsMainModel\(d\)\) \{/)
assert.match(bsrc, /event_type: 'brain_shadow'/); assert.doesNotMatch(bsrc.slice(bsrc.indexOf('async function recordShadow'), bsrc.indexOf('export function shadowReport')), /p\.text|instruction/, 'no message text is saved')
const cd = await import('../lib/admin/console-data')
assert.deepEqual(cd.summarizeShadows([{ metadata_json: { agreement: 'exact', main: { usd: 0.012 }, shadow: { usd: 0.0005 } } }, { metadata_json: { agreement: 'same_kind', main: { usd: 0.01 }, shadow: { usd: 0.0004 } } }, { metadata_json: { agreement: 'different' } }, { metadata_json: {} }]),
  { turns: 3, exact: 1, sameAction: 2, mainUsd: 0.022, shadowUsd: 0.0009 })
assert.match(read('app/admin/(console)/costs/page.tsx'), /label: 'Cheaper brain'/)
console.log('✓ cheaper brain: off until switched on; Haiku routes, Sonnet writes replies and catches failures; agreement shown in admin')
console.log('Quiet WhatsApp checks passed')
