import assert from 'node:assert/strict'
import {rankVerifiedCreditIQBenefits} from '../lib/commerce/creditiq-rewards'
import {evaluateEnterprisePurchasePolicy} from '../lib/commerce/enterprise-spending-policy'

const now=Date.parse('2026-11-15T11:45:00Z'),sha='a'.repeat(64)
const ctx={owner:'owner-1',cartSha256:sha,provider:'swiggy',totalPaise:100000,now}
const benefit={
  owner:'owner-1',cartSha256:sha,provider:'swiggy',currency:'INR' as const,
  cardAlias:'CreditIQ Card A',offerId:'offer-123',evidenceId:'issuer-proof-1',
  evidenceSource:'creditiq_issuer_verified' as const,
  checkedAt:now-1000,expiresAt:now+60000,eligible:true,
  estimatedBenefitPaise:5000,merchantFeePaise:500,
  termsUrl:'https://issuer.example/terms'
}
const e=()=>rankVerifiedCreditIQBenefits(ctx,[benefit])
assert.equal(e().status,'verified_offers')
assert.equal(e().suggestions[0].netEstimatedBenefitPaise,4500)
assert.equal(e().suggestions[0].guarantee,false)
assert.equal(rankVerifiedCreditIQBenefits(ctx,[]).status,'insufficient_verified_evidence')
for(const patch of [
  {owner:'other'}, {cartSha256:'b'.repeat(64)}, {provider:'zepto'},
  {evidenceSource:'manual_guess'}, {checkedAt:now-600000},
  {eligible:false}, {estimatedBenefitPaise:100001},
  {termsUrl:'javascript:alert(1)'}, {currency:'USD'},
]) assert.equal(rankVerifiedCreditIQBenefits(ctx,[{...benefit,...patch} as any]).suggestions.length,0)
assert.equal(rankVerifiedCreditIQBenefits(ctx,[benefit,{...benefit,checkedAt:now-1500}]).suggestions.length,1)
const netZero=rankVerifiedCreditIQBenefits(ctx,[{...benefit,merchantFeePaise:7000}])
assert.equal(netZero.suggestions.length,0)
console.log('✓ CreditIQ: exact card/merchant/owner/quote evidence required; unverified/expired offers suppressed')

const request={
  tenantId:'tenant-a',employeeId:'emp-a',departmentId:'dept-a',merchant:'swiggy',
  category:'food',currency:'INR' as const,amountPaise:30000,
  cartSha256:sha,observedAt:now-1000,now,
}
const policy={
  tenantId:'tenant-a',version:'v1',active:true,merchantAllowlist:['swiggy'],
  categoryAllowlist:['food'],employeeLimitPaise:100000,departmentRemainingPaise:60000,
  employeeRemainingPaise:45000,approvalThresholdPaise:20000,requiredApprovers:['manager-1'],
  expiresAt:now+60000,
}
let verdict=evaluateEnterprisePurchasePolicy(request,policy)
assert.equal(verdict.status,'requires_approval')
assert.equal(verdict.canExecute,false)
verdict=evaluateEnterprisePurchasePolicy({...request,amountPaise:10000},policy)
assert.equal(verdict.status,'within_policy')
assert.equal(verdict.canExecute,false,'company budget permission can never charge money')
for(const [change, reason] of [
  [{tenantId:'tenant-b'},'tenant_policy_unavailable'],
  [{active:false},'tenant_policy_unavailable'],
  [{merchantAllowlist:[]},'merchant_or_category_not_allowed'],
  [{departmentRemainingPaise:1},'budget_limit_exceeded'],
  [{requiredApprovers:['emp-a']},'approval_policy_invalid'],
  [{requiredApprovers:[]},'approver_required'],
] as Array<[Partial<typeof policy>, string]>){
  const v=evaluateEnterprisePurchasePolicy(request,{...policy,...change})
  assert.equal(v.status,'blocked')
  assert.equal((v as any).reason,reason)
}
assert.equal(evaluateEnterprisePurchasePolicy({...request,observedAt:now-600000},policy).status,'blocked')
assert.equal(evaluateEnterprisePurchasePolicy(request,null).status,'blocked')
assert.equal(evaluateEnterprisePurchasePolicy({...request,cartSha256:'invalid'},policy).status,'blocked')
console.log('✓ Enterprise: tenant, merchant, budget, fresh cart and independent approver checks are fail closed')
console.log('✅ CreditIQ / enterprise advisory preflight regressions passed')
