import assert from 'node:assert/strict'
import { triageTipplrIncident, type EnterpriseIncident } from '../lib/enterprise/tipplr/triage.ts'

const base: EnterpriseIncident = {
  tenantId: 'tipplr', sourceEventId: 'flipkart_evt_1', orderId: 'FK-1001',
  merchantId: 'restaurant_1', marketplace: 'flipkart', kind: 'order_cancelled',
}
const good = (value: string, source: 'petpooja' | 'tipplr') => ({
  value, source, verified: true, observedAt: new Date().toISOString(),
})
const t = (overrides: Partial<EnterpriseIncident> = {}) => triageTipplrIncident({ ...base, ...overrides })

assert.equal(t().category, 'mapping_evidence_needed')
assert.equal(t({ actualPosStoreId: good('store_001', 'tipplr'), expectedPosStoreId: good('store_002', 'petpooja') }).category, 'mapping_discrepancy')
assert.equal(t({ actualPosStoreId: good('store_001', 'tipplr'), expectedPosStoreId: good('store_001', 'petpooja') }).category, 'cancellation_investigation')
assert.equal(t({ actualPosStoreId: { ...good('store_001', 'tipplr'), verified: false }, expectedPosStoreId: good('store_002', 'petpooja') }).category, 'mapping_evidence_needed')
assert.equal(t({ actualPosStoreId: good('store_001', 'tipplr'), expectedPosStoreId: good('store_002', 'petpooja'), kind: 'refund_requested' }).category, 'refund_review')
assert.equal(t({ kind: 'order_delayed' }).safeAutomaticActions.includes('read_only_status_lookup'), true)
assert.equal(t({ kind: 'other', reportedReason: 'Wrong store ID' }).category, 'general_triage')
assert.equal(t({ tenantId: '' }).category, 'invalid_input')
assert.equal(t({ tenantId: 'tipplr ', kind: 'mapping_check' }).idempotencyTuple, null)
assert.notEqual(t({ tenantId: 'tipplr' }).idempotencyTuple, t({ tenantId: 'another-company' }).idempotencyTuple)
assert.notEqual(t({ sourceEventId: 'evt2' }).idempotencyTuple, t().idempotencyTuple)
for (const kind of ['order_cancelled','order_rejected','order_delayed','refund_requested','mapping_check','other'] as const) {
  const v = t({ kind })
  assert.equal(v.externalMutationAuthorized, false)
  assert.equal(v.safeAutomaticActions.some(x => x === ('issue_refund' as any)), false)
}
assert.equal(t({ actualPosStoreId: { ...good('store_001', 'tipplr'), observedAt: '2070-01-01T00:00:00Z' }, expectedPosStoreId: good('store_002', 'petpooja') }).category, 'mapping_evidence_needed')
assert.equal(t({ actualPosStoreId: { ...good('store_001', 'tipplr'), observedAt: '2020-01-01T00:00:00Z' }, expectedPosStoreId: good('store_002', 'petpooja') }).category, 'mapping_evidence_needed')
console.log('verify-tipplr-enterprise-triage: 14 assertions + 6 no-external-mutation cases passed')
