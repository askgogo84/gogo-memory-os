// 13 Nov first proactive comparison: the cleanup list was all "Reply to <bill / newsletter / receipt>" items made from
// inbound mail. Only what the person said, or a thread they are waiting on, belongs in it. (The notice-capture rules
// from this PR were withdrawn after review: keyword rules both missed real warnings and flagged ordinary mail.)
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service-role-key-0123456789'
const S = await import('../lib/agent/proactive-shadow.ts')
let checks = 0
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }
const NOW = Date.parse('2026-11-13T05:00:00Z')
const stale = [
  { id: 'a', kind: 'followup', title: "Reply to BSNL Care — Your Telephone Bill generated in the month of Oct'2026", source_type: 'gmail_thread', source_id: 'g1', evidence_json: {} },
  { id: 'b', kind: 'followup', title: 'Reply to Doctor Towels — share your thoughts', source_type: 'gmail_thread', source_id: 'g2', evidence_json: {} },
  { id: 'c', kind: 'waiting_on', title: 'Waiting on BCL India — payment chase', source_type: 'gmail_thread', source_id: 'g3', evidence_json: {} },
  { id: 'd', kind: 'commitment', title: 'Send the pitch deck to Nithin', source_type: 'conversation', source_id: 'c1', evidence_json: {} },
  { id: 'e', kind: 'commitment', title: 'Review service billing notice — Airtel', source_type: 'gmail_service_notice', source_id: 'n1', evidence_json: {} },
]
eq(S.cleanupCandidates(stale, NOW).map((l: any) => l.id), ['c', 'd'], 'only waiting-on threads and the person\'s own items (no inbound mail, no notices)')
console.log(`PROACTIVE_CLEANUP_OK ${checks} checks`)
