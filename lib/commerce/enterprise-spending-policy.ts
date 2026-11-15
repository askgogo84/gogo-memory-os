/**
 * Deterministic enterprise spending policy evaluation. This engine ONLY prepares
 * a policy verdict; it cannot grant bank authority or write any merchant order.
 * Policy and employee context must be loaded from an authenticated tenant store.
 */
export type EnterprisePurchaseScope = {
  tenantId: string
  employeeId: string
  departmentId: string
  merchant: string
  category: string
  currency: 'INR'
  amountPaise: number
  cartSha256: string
  observedAt: number
  now?: number
}

export type EnterpriseSpendingPolicy = {
  tenantId: string
  version: string
  active: boolean
  merchantAllowlist: string[]
  categoryAllowlist: string[]
  employeeLimitPaise: number
  departmentRemainingPaise: number
  employeeRemainingPaise: number
  approvalThresholdPaise: number
  requiredApprovers: string[]
  expiresAt: number
}

export type EnterpriseSpendingDecision =
  | {status:'blocked'; reason:string; canExecute:false}
  | {status:'requires_approval'; approvers:string[]; policyVersion:string; canExecute:false}
  | {status:'within_policy'; policyVersion:string; canExecute:false}

const valid = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 128 && /^[\w.:-]+$/.test(s)
const nonNegative = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 1000000000
const blocked = (reason:string):EnterpriseSpendingDecision => ({status:'blocked',reason,canExecute:false})

export function evaluateEnterprisePurchasePolicy(
  request: EnterprisePurchaseScope,
  policy: EnterpriseSpendingPolicy | null,
):EnterpriseSpendingDecision {
  const now=request.now ?? Date.now()
  if (!valid(request.tenantId) || !valid(request.employeeId) || !valid(request.departmentId) ||
      !valid(request.merchant) || !valid(request.category) ||
      request.currency!=='INR' || !/^[a-f0-9]{64}$/.test(request.cartSha256) ||
      !nonNegative(request.amountPaise) || request.amountPaise===0 ||
      !Number.isFinite(now) || !Number.isFinite(request.observedAt) ||
      request.observedAt>now || now-request.observedAt>300000) return blocked('invalid_or_stale_cart')
  if (!policy || !policy.active || policy.tenantId!==request.tenantId || !valid(policy.version) ||
      !Number.isFinite(policy.expiresAt) || policy.expiresAt<=now) return blocked('tenant_policy_unavailable')
  if (!Array.isArray(policy.categoryAllowlist) || !policy.categoryAllowlist.includes(request.category) ||
      !Array.isArray(policy.merchantAllowlist) || !policy.merchantAllowlist.includes(request.merchant))
    return blocked('merchant_or_category_not_allowed')
  if (![policy.employeeLimitPaise,policy.departmentRemainingPaise,policy.employeeRemainingPaise,policy.approvalThresholdPaise].every(nonNegative))
    return blocked('budget_unverified')
  if (request.amountPaise>policy.employeeLimitPaise ||
      request.amountPaise>policy.departmentRemainingPaise ||
      request.amountPaise>policy.employeeRemainingPaise) return blocked('budget_limit_exceeded')
  const approvers=policy.requiredApprovers
  if (!Array.isArray(approvers) || approvers.length>5 ||
      approvers.some(a=>!valid(a) || a===request.employeeId) ||
      new Set(approvers).size!==approvers.length) return blocked('approval_policy_invalid')
  if (request.amountPaise>policy.approvalThresholdPaise) {
    if (approvers.length===0) return blocked('approver_required')
    return {status:'requires_approval',approvers:[...approvers],policyVersion:policy.version,canExecute:false}
  }
  // Even an in-policy purchase must undergo customer permission, binding and
  // final provider approval. A budgeting green light is NOT transaction approval.
  return {status:'within_policy',policyVersion:policy.version,canExecute:false}
}
