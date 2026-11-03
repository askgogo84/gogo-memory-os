// Gogo Ops Alerts phase 1 (3 Nov, approved mockup): billing, error spikes and failed tasks are grouped into incidents;
// P1 goes to the owner's alert number at once, P2 hourly; replies ack / mute / details / alerts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const o = await import('../lib/ops/alerts')

// The alert number is the owner's second phone; the daily number never gets alerts.
delete process.env.OPS_ALERT_WHATSAPP_NUMBER
assert.equal(o.isOpsAlertNumber('whatsapp:+918310441698'), true)
assert.equal(o.isOpsAlertNumber('918310441698'), true)
assert.equal(o.isOpsAlertNumber('+918884501501'), false)
assert.equal(o.isOpsAlertNumber(''), false)
console.log('✓ alerts go to 8310441698 only')

// Error spikes: 20+ failures in 15 min at ≥50% failure rate is P1; otherwise 5+ in an hour is P2; one incident each.
{
  const m15 = [{ vendor: 'Serper', category: 'shopping', failures: 46, calls: 50 }, { vendor: 'Groq', category: 'chat', failures: 25, calls: 400 }]
  const m60 = [{ vendor: 'Serper', category: 'shopping', failures: 80, calls: 120 }, { vendor: 'AeroDataBox', category: 'flight', failures: 31, calls: 33 }, { vendor: 'Gemini', category: 'chat', failures: 2, calls: 90 }]
  const a = o.meterAlerts(m15, m60)
  assert.deepEqual(a.map(x => `${x.severity}:${x.fingerprint}`), ['P1:errors:spike:serper:shopping', 'P2:provider:aerodatabox:flight'])
  assert.match(a[0].detail, /46 of 50 calls failed in the last 15 minutes/)
  assert.ok(!a.some(x => /groq/.test(x.fingerprint)), 'a low failure rate is not a spike')
  assert.ok(!a.some(x => /gemini/.test(x.fingerprint)), 'two failures is not an alert')
  console.log('✓ error spikes are P1, steady provider failures P2, noise ignored, one incident per source')
}
assert.deepEqual(o.taskAlerts(12, 20).map(x => x.severity), ['P1'])
assert.deepEqual(o.taskAlerts(2, 6).map(x => x.severity), ['P2'])
assert.deepEqual(o.taskAlerts(1, 3), [])
console.log('✓ failed-task spikes are P1, steady failures P2')

// Billing: a payment problem from a service we run on is P1; receipts and unrelated senders are not.
{
  const v = o.billingAlert({ from: 'Vercel <notifications@vercel.com>', subject: '[Action Required] Payment Failed And Shutdown Coming Soon', snippet: 'We failed to charge your card ending with 1712 for the team' })!
  assert.equal(v.severity, 'P1'); assert.equal(v.fingerprint, 'billing:vercel'); assert.equal(v.title, 'Vercel payment failing · card 1712')
  assert.equal(o.billingAlert({ from: 'Vercel <billing@vercel.com>', subject: 'Your receipt from Vercel', snippet: 'Thank you for your payment' }), null)
  assert.equal(o.billingAlert({ from: 'Vercel <notifications@vercel.com>', subject: 'Your deployment is ready', snippet: '' }), null)
  assert.equal(o.billingAlert({ from: 'Some Shop <deals@shop.example>', subject: 'Payment failed? Try again for 20% off', snippet: '' }), null)
  assert.equal(o.billingAlert({ from: 'Supabase <billing@supabase.io>', subject: 'Invoice past due', snippet: 'Your project may be paused' })!.fingerprint, 'billing:supabase')
  assert.match(o.BILLING_GMAIL_QUERY, /^newer_than:3d /)
  console.log('✓ billing problems from our providers are P1; receipts, notices and marketing are ignored')
}

// Messages: P1 is complete and actionable; the template line fits; the digest lists counts.
{
  const p1 = o.formatP1({ no: 1, title: 'Vercel payment failing · card 1712', detail: '[Action Required] Payment Failed And Shutdown Coming Soon', occurrences: 2, source: 'billing' })
  assert.match(p1, /^🔴 \*P1 · Vercel payment failing · card 1712\*/); assert.match(p1, /Seen 2 times/); assert.match(p1, /Reply \*ack 1\*/); assert.match(p1, /Gogo never changes it/)
  const line = o.formatP1Line({ no: 7, title: 'Error spike · Serper shopping', detail: 'x'.repeat(600) })
  assert.ok(line.length <= 380 && !/\n/.test(line), 'template variable: one short line')
  const d = o.formatDigest([{ no: 3, title: 'AeroDataBox failing · flight', occurrences: 31, severity: 'P2' }, { no: 4, title: 'Tasks failing', occurrences: 1, severity: 'P2' }])
  assert.match(d, /Ops digest · 2 open/); assert.match(d, /3\. AeroDataBox failing · flight · 31×/); assert.match(d, /4\. Tasks failing\n/)
  console.log('✓ P1 message, template line and hourly digest read well')
}

// Commands from the alert number.
assert.deepEqual(o.parseOpsCommand('alerts'), { kind: 'list' })
assert.deepEqual(o.parseOpsCommand('Ack 3'), { kind: 'ack', no: 3 })
assert.deepEqual(o.parseOpsCommand('details #12'), { kind: 'details', no: 12 })
assert.deepEqual(o.parseOpsCommand('mute 2 for 1d'), { kind: 'mute', no: 2, minutes: 1440 })
assert.deepEqual(o.parseOpsCommand('mute 2 for 3 hours'), { kind: 'mute', no: 2, minutes: 180 })
assert.deepEqual(o.parseOpsCommand('mute 2'), { kind: 'mute', no: 2, minutes: 1440 })
assert.equal(o.parseOpsCommand('mute 2 for 90d')!.kind, 'mute'); assert.equal((o.parseOpsCommand('mute 2 for 90d') as any).minutes, 14 * 1440, 'capped at 14 days')
for (const no of ['remind me to ack the email at 3', 'show my alerts on flights', 'details please', 'ack'])
  assert.equal(o.parseOpsCommand(no), null, no)
console.log('✓ ack / mute / details / alerts parse; ordinary messages are left alone')

// Notification rules: P1 at once and every 6 h until acked; muted waits; P2 digest at most hourly.
{
  const now = new Date('2026-11-03T06:00:00Z')
  const base = { severity: 'P1' as const, status: 'open' as const, muted_until: null, notified_at: null }
  assert.equal(o.shouldNotifyP1(base, now), true)
  assert.equal(o.shouldNotifyP1({ ...base, notified_at: '2026-11-03T05:00:00Z' }, now), false)
  assert.equal(o.shouldNotifyP1({ ...base, notified_at: '2026-11-02T23:00:00Z' }, now), true, 'unacknowledged P1 repeats after 6 h')
  assert.equal(o.shouldNotifyP1({ ...base, status: 'acked' as any }, now), false)
  assert.equal(o.shouldNotifyP1({ ...base, status: 'muted' as any, muted_until: '2026-11-03T09:00:00Z' }, now), false)
  assert.equal(o.shouldNotifyP1({ ...base, status: 'muted' as any, muted_until: '2026-11-03T05:00:00Z' }, now), true, 'an expired mute alerts again')
  assert.equal(o.shouldNotifyP1({ ...base, severity: 'P2' as any }, now), false, 'P2 never interrupts')
  const p2 = { severity: 'P2' as const, status: 'open' as const, muted_until: null, notified_at: null, last_seen: '2026-11-03T05:55:00Z' }
  assert.equal(o.shouldSendDigest([p2], null, now), true)
  assert.equal(o.shouldSendDigest([p2], '2026-11-03T05:30:00Z', now), false, 'at most one digest an hour')
  assert.equal(o.shouldSendDigest([{ ...p2, notified_at: '2026-11-03T05:56:00Z' }], '2026-11-03T04:00:00Z', now), false, 'nothing new since the last digest')
  console.log('✓ P1 now and every 6 h until acked; mutes respected; digest at most hourly and only with news')
}

// Safety: read-only towards providers; owner-only commands; migration with rollback; cron registered; P1 never auto-muted.
{
  const run = readFileSync('lib/ops/run.ts', 'utf8'), alerts = readFileSync('lib/ops/alerts.ts', 'utf8')
  assert.doesNotMatch(run + alerts, /method:\s*'(?:POST|PATCH|PUT|DELETE)'/, 'no provider writes')
  assert.doesNotMatch(alerts, /status:\s*'muted'[^\n]*severity|autoMute|auto_mute/i, 'nothing mutes automatically')
  const hook = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
  assert.match(hook, /const opsCommand = isOpsAlertNumber\(from\) \? parseOpsCommand\(bodyText\) : null/)
  const mig = readFileSync('supabase/migrations/20261103120000_ops_alerts.sql', 'utf8')
  assert.match(mig, /enable row level security/); assert.doesNotMatch(mig, /create policy/i, 'service role only')
  assert.match(mig, /ops_alerts_one_live_per_fingerprint on public\.ops_alerts \(fingerprint\) where status <> 'resolved'/)
  assert.match(readFileSync('supabase/migrations/20261103120000_ops_alerts.rollback.sql', 'utf8'), /drop table if exists public\.ops_alerts/)
  assert.ok(JSON.parse(readFileSync('vercel.json', 'utf8')).crons.some((c: any) => c.path === '/api/cron/ops-alerts' && c.schedule === '*/5 * * * *'))
  assert.match(run, /if \(!raised\.ok\) return \{ ok: false/, 'without the table nothing is sent')
  console.log('✓ read-only, owner-only commands, RLS migration with rollback, cron every 5 min, safe before migration')
}
console.log('Ops alerts checks passed')
