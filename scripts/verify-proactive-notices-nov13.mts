// 13 Nov first proactive comparison: Instinct caught a WeWork dues/keycard deactivation warning and an Apify breach
// notice; Gogo saw neither (the dues wording and security notices from automated senders matched no rule), and its
// cleanup list was all "Reply to <bill / newsletter>" items made from inbound mail. Synthetic fixtures.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service-role-key-0123456789'
process.env.OPENAI_API_KEY ||= 'test'
const A = await import('../lib/email/attention.ts')
const O = await import('../lib/agent/open-loops.ts')
const P = await import('../lib/email/proactive.ts')
const S = await import('../lib/agent/proactive-shadow.ts')
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }
const NOW = Date.parse('2026-11-13T05:00:00Z')
const WEWORK = { id: 'm1', threadId: 't1', from: 'WeWork <no-reply@wework.example>', subject: 'Action needed: membership dues pending', snippet: 'Your access and keycards will be deactivated around 3pm tomorrow if the outstanding dues of ₹35,841.29 are not settled.', internalDate: NOW - 3600_000 }
const APIFY = { id: 'm2', threadId: 't2', from: 'Apify <security@apify.example>', subject: 'Security incident affecting your Apify account', snippet: 'Between Nov 9-10 an attacker had unauthorized access; your account data was viewed, including profile and billing.', internalDate: NOW - 7200_000 }
ok(O.isServiceRiskNotice(WEWORK), 'the WeWork dues deactivation warning is captured')
ok(O.isServiceRiskNotice(APIFY), 'the Apify breach notice is captured')
eq(A.classifyEmail({ ...WEWORK } as any), 'service_risk', 'WeWork: service may be cut off')
eq(A.classifyEmail({ ...APIFY } as any), 'security', 'Apify: security alert')
// Not notices: advice, newsletters, promotions, cleared dues, an OTP.
for (const [why, m] of [
  ['security tips', { from: 'x@y.z', subject: '5 security tips for your account', snippet: 'Learn how to avoid unauthorized access' }],
  ['breach report newsletter', { from: 'news@y.z', subject: 'Data breach report 2026', snippet: 'unauthorized access trends', listUnsubscribe: '<mailto:u@y.z>' }],
  ['promotion', { from: 'x@y.z', subject: 'Pay your dues and avoid deactivation - 20% off', snippet: 'outstanding dues', labelIds: ['CATEGORY_PROMOTIONS'] }],
  ['dues cleared', { from: 'x@y.z', subject: 'Payment received', snippet: 'Your outstanding dues of ₹500 are cleared. Thank you.' }],
  ['otp', { from: 'x@y.z', subject: 'Your OTP', snippet: 'OTP 482913 to avoid account deactivation of outstanding dues' }],
] as const) ok(!O.isServiceRiskNotice(m), `not a notice: ${why}`)
// Unchanged: the original payment-failed rule still holds.
ok(O.isServiceRiskNotice({ from: 'billing@vercel.example', subject: 'Payment failed', snippet: 'Your payment failed; your projects will be suspended. Action required.' }), 'payment failed + suspend: still captured')
// End to end through the proactive pick: a loop shaped as captured is picked for both.
const loop = (m: any, title: string) => ({ id: m.id, kind: 'commitment', title: `${title} — ${m.subject}`, summary: m.snippet, source_type: 'gmail_service_notice', source_id: m.threadId, evidence_json: { last_message_from: m.from, last_internal_date: m.internalDate }, created_at: new Date(m.internalDate).toISOString() })
const picks = P.explainProactiveEmails([loop(WEWORK, 'Review service billing notice'), loop(APIFY, 'Review security notice')] as any, { now: NOW, cap: 2 })
eq(picks.filter(d => d.decision === 'pick').map(d => d.loopId).sort(), ['m1', 'm2'], 'both would be in the proactive card')
// Cleanup: inbound "Reply to" mail is never listed; things the person said or is waiting on are.
const stale = [
  { id: 'a', kind: 'followup', title: "Reply to BSNL Care — Your Telephone Bill generated in the month of Oct'2026", source_type: 'gmail_thread', source_id: 'g1', evidence_json: {} },
  { id: 'b', kind: 'followup', title: 'Reply to Doctor Towels — share your thoughts', source_type: 'gmail_thread', source_id: 'g2', evidence_json: {} },
  { id: 'c', kind: 'waiting_on', title: 'Waiting on BCL India — payment chase', source_type: 'gmail_thread', source_id: 'g3', evidence_json: {} },
  { id: 'd', kind: 'commitment', title: 'Send the pitch deck to Nithin', source_type: 'conversation', source_id: 'c1', evidence_json: {} },
]
eq(S.cleanupCandidates(stale, NOW).map((l: any) => l.id), ['c', 'd'], 'only waiting-on threads and the person\'s own items')
console.log(`PROACTIVE_NOTICES_OK ${checks} checks`)
