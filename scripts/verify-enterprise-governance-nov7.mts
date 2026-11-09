import assert from 'node:assert/strict'
import { authorizeEnterpriseAction, type EnterpriseAuthorizationInput } from '../lib/enterprise/governance/authorization.ts'
const base: EnterpriseAuthorizationInput = {
  workspaceId: 'tipplr-01', resourceWorkspaceId: 'tipplr-01',
  actor: { id: 'operator-01', workspaceId: 'tipplr-01', role: 'operator', active: true },
  membershipVerified: true, capability: 'orders',
  enabledCapabilities: ['orders', 'menu', 'invoices', 'ops'],
  action: 'orders.accept', operation: 'execute', objectId: 'T-4512',
  idempotencyKey: 'tipplr-01:accept:T-4512:once', nowMs: 1_800_000_000_000,
  approval: {
    id: 'approval-01', status: 'approved', workspaceId: 'tipplr-01',
    actorId: 'operator-01', action: 'orders.accept', objectId: 'T-4512',
    idempotencyKey: 'tipplr-01:accept:T-4512:once',
    expiresAtMs: 1_800_000_060_000, consumed: false, approvedByActorId: 'manager-01',
  },
}
let count = 0
function expect(why: string, input: EnterpriseAuthorizationInput, allowed: boolean, reason: string) {
  const actual = authorizeEnterpriseAction(input)
  assert.equal(actual.allowed, allowed, why)
  assert.equal(actual.reason, reason, why)
  count++
  console.log('PASS: ' + why)
}
expect('matching operator + exact one-shot approval', base, true, 'scoped_approved_execute')
expect('cross-tenant resource blocked', { ...base, resourceWorkspaceId: 'other-company' }, false, 'workspace_mismatch')
expect('cross-tenant actor blocked', { ...base, actor: { ...base.actor, workspaceId: 'other-company' } }, false, 'workspace_mismatch')
expect('membership required', { ...base, membershipVerified: false }, false, 'membership_unverified')
expect('inactive actor blocked', { ...base, actor: { ...base.actor, active: false } }, false, 'inactive_actor')
expect('viewer cannot execute', { ...base, actor: { ...base.actor, role: 'viewer' } }, false, 'role_insufficient')
expect('disabled capability blocked', { ...base, enabledCapabilities: ['menu'] }, false, 'capability_disabled')
expect('missing approval blocked', { ...base, approval: null }, false, 'approval_required')
expect('expired approval blocked', { ...base, approval: { ...base.approval!, expiresAtMs: base.nowMs! } }, false, 'approval_expired')
expect('previously consumed approval blocked', { ...base, approval: { ...base.approval!, consumed: true } }, false, 'approval_consumed')
expect('approval bound to exact resource', { ...base, objectId: 'T-4513' }, false, 'approval_invalid')
expect('approval bound to exact actor', { ...base, approval: { ...base.approval!, actorId: 'operator-02' } }, false, 'approval_invalid')
expect('approval bound to exact action', { ...base, approval: { ...base.approval!, action: 'orders.reject' } }, false, 'approval_invalid')
expect('idempotency key bound to exact intent', { ...base, idempotencyKey: 'another-key' }, false, 'approval_invalid')
expect('missing idempotency key blocked', { ...base, idempotencyKey: null }, false, 'idempotency_key_required')
expect('unrecognized action blocked', { ...base, action: 'orders.transfer-funds' as never }, false, 'unsupported_action')
expect('execution cannot masquerade as read', { ...base, operation: 'read' }, false, 'action_mismatch')
expect('invalid numeric coercion unsafe ID blocked', { ...base, actor: { ...base.actor, id: '1.0' } }, false, 'invalid_scope')
expect('unknown role cannot execute', { ...base, actor: { ...base.actor, role: 'superuser' as never } }, false, 'role_insufficient')
const viewerRead: EnterpriseAuthorizationInput = {
  ...base, actor: { ...base.actor, role: 'viewer' },
  action: 'orders.read', operation: 'read', approval: null,
}
expect('scoped viewer read allowed', viewerRead, true, 'scoped_read')
expect('read still requires verified membership', { ...viewerRead, membershipVerified: false }, false, 'membership_unverified')
const analystDraft: EnterpriseAuthorizationInput = {
  ...base, actor: { ...base.actor, role: 'analyst' }, capability: 'invoices',
  action: 'invoices.draft', operation: 'draft', approval: null,
}
expect('scoped analyst draft allowed', analystDraft, true, 'scoped_draft')
expect('invoice filing requires different approver', {
  ...base, capability: 'invoices', action: 'invoices.file',
  approval: { ...base.approval!, action: 'invoices.file', approvedByActorId: base.actor.id },
}, false, 'separation_of_duties_required')
expect('separately approved invoice can pass preflight', {
  ...base, capability: 'invoices', action: 'invoices.file',
  approval: { ...base.approval!, action: 'invoices.file', approvedByActorId: 'finance-01' },
}, true, 'scoped_approved_execute')
assert.equal(count, 24)
console.log('24 enterprise governance checks passed. No live DB/provider calls.')
