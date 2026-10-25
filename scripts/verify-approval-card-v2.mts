// Approval card v2 (23 Oct): exact action, details, what happens, why, expiry; Later defers without deciding;
// a closed cloud browser says Restart. Run: npx tsx scripts/verify-approval-card-v2.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { activeDeferrals, approvalAction, approvalExpiresAt, parseDeferHours, previewRows, whenLabel } from '../lib/agent/approval-card'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
const { cloudHandoffLikelyClosed } = await import('../lib/dashboard/task-feed')

assert.equal(approvalAction('email_send').yes, 'Send it')
assert.match(approvalAction('email_send').happens, /cannot be unsent/)
assert.equal(approvalAction('calendar_change').label, 'Change your calendar')
assert.equal(approvalAction('something_new').yes, 'Approve & run', 'unknown actions keep the generic, honest wording')
assert.deepEqual(previewRows([{ label: 'To', value: 'Nithin  K L' }, { label: 'Risk', value: 'high' }, { label: '', value: 'x' }]), [{ label: 'To', value: 'Nithin K L' }])
assert.equal(approvalExpiresAt({ requested_at: '2026-10-23T06:00:00Z' }), '2026-10-24T06:00:00.000Z', '24 h default')
assert.equal(approvalExpiresAt({ requested_at: '2026-10-23T06:00:00Z', execution_payload: { expires_at: '2026-10-23T12:30:00Z' } }), '2026-10-23T12:30:00.000Z')
assert.equal(approvalExpiresAt({}), null)
assert.equal(whenLabel('2026-10-23T12:30:00Z', new Date('2026-10-23T05:00:00Z')), 'today 6:00 pm')
assert.equal(parseDeferHours(undefined), 4); assert.equal(parseDeferHours(30), 4); assert.equal(parseDeferHours(2), 2)
const d = activeDeferrals([
  { metadata_json: { approval_id: 'a', until: '2026-10-23T10:00:00Z' } },
  { metadata_json: { approval_id: 'a', until: '2026-10-23T12:00:00Z' } },
  { metadata_json: { approval_id: 'b', until: '2026-10-23T01:00:00Z' } },
], Date.parse('2026-10-23T05:00:00Z'))
assert.equal(d.get('a'), '2026-10-23T12:00:00.000Z'); assert.equal(d.has('b'), false, 'a past deferral no longer hides anything')

const now = new Date('2026-10-23T05:00:00Z')
assert.equal(cloudHandoffLikelyClosed({ cloud: true, updatedAt: '2026-10-23T04:20:00Z' }, now), true)
assert.equal(cloudHandoffLikelyClosed({ cloud: true, updatedAt: '2026-10-23T04:50:00Z' }, now), false)
assert.equal(cloudHandoffLikelyClosed({ cloud: false, updatedAt: '2026-10-23T01:00:00Z' }, now), false, 'a phone handoff does not expire')

const route = readFileSync('app/api/agent/approvals/[id]/route.ts', 'utf8')
const defer = route.slice(route.indexOf("if (decision === 'defer')"), route.indexOf("const status = decision === 'approve'"))
assert.ok(defer.length > 50)
assert.doesNotMatch(defer, /from\('agent_approvals'\)\.update|from\('agent_runs'\)/, 'Later never approves, rejects or runs anything')
assert.ok(route.indexOf("if (fresh.expired)") < route.indexOf("if (decision === 'defer')"), 'an expired card cannot be deferred back to life')
assert.match(defer, /telegram_id: session\.telegramId/)
const feed = readFileSync('lib/dashboard/task-feed.ts', 'utf8')
assert.match(feed, /\.eq\('telegram_id', tg\)\.eq\('event_type', 'approval_deferred'\)/)
assert.match(feed, /action: closed \? 'Restart'/)
const page = readFileSync('app/dashboard/(app)/agent/page.tsx', 'utf8')
assert.match(page, /<ApprovalCard key=\{a\.id\} approval=\{a\}/)
console.log('Approval card v2: details, what happens, expiry, Later without deciding, Restart for a closed browser')
