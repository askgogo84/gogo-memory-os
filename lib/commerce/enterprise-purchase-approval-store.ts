import {supabaseAdmin} from '@/lib/supabase-admin'
import {assertPurchaseFeatureEnabled,getPurchase} from './purchase-handoff'
import {type EnterpriseSpendingPolicy} from './enterprise-spending-policy'
import {
  type ApprovalProposal,type VerifiedEmployeeContext,type VerifiedApproverContext,
  enterpriseApprovalProposal,enterpriseApprovalView,validateEnterpriseApprovalVote,
} from './enterprise-purchase-approval'
import {PurchaseBoundaryError} from './purchase-contract'
const REQUESTS='commerce_enterprise_spend_requests'
const VOTES='commerce_enterprise_spend_votes'

/** Internal enterprise-service API, not a customer POST. Context must be verified by tenant IAM. */
export async function prepareEnterpriseSpendApproval(
  owner:string,purchaseId:string,context:VerifiedEmployeeContext,policy:EnterpriseSpendingPolicy,
) {
  assertPurchaseFeatureEnabled()
  const purchase=await getPurchase(owner,purchaseId)
  if(!purchase) throw new PurchaseBoundaryError('purchase_not_found')
  const proposal=enterpriseApprovalProposal(context,purchase as any,policy)
  if(!proposal) return {status:'within_policy',canExecute:false as const}
  const row={
    purchase_id:proposal.purchaseId,tenant_id:proposal.tenantId,
    employee_id:proposal.employeeId,department_id:proposal.departmentId,
    policy_version:proposal.policyVersion,snapshot_sha256:proposal.snapshotSha256,
    amount_paise:proposal.amountPaise,required_approvers:proposal.requiredApprovers,
    approval_sha256:proposal.approvalSha256,expires_at:proposal.expiresAt,
  }
  const {data,error}=await supabaseAdmin.from(REQUESTS).insert(row).select('*').single()
  if(!error) return {requestId:data.id,status:'pending',canExecute:false as const}
  if(error.code!=='23505') throw new PurchaseBoundaryError('purchase_store_unavailable')
  const {data:existing,error:readError}=await supabaseAdmin.from(REQUESTS)
    .select('*').eq('purchase_id',purchaseId).maybeSingle()
  if(readError||!existing) throw new PurchaseBoundaryError('purchase_store_unavailable')
  if(existing.tenant_id!==proposal.tenantId || existing.approval_sha256!==proposal.approvalSha256)
    throw new PurchaseBoundaryError('enterprise_approval_snapshot_conflict')
  return {requestId:existing.id,status:'pending',canExecute:false as const}
}

/**
 * Server-verified distinct tenant approver, one immutable vote per request and actor.
 * A vote cannot authorize checkout: caller must also recheck budgets and cart at use.
 */
export async function recordEnterpriseSpendVote(
  requestId:string,context:VerifiedApproverContext,decision:'approve'|'reject',
) {
  assertPurchaseFeatureEnabled()
  const {data:request,error}=await supabaseAdmin.from(REQUESTS).select('*')
    .eq('id',requestId).eq('tenant_id',context.tenantId).maybeSingle()
  if(error) throw new PurchaseBoundaryError('purchase_store_unavailable')
  if(!request) throw new PurchaseBoundaryError('enterprise_approval_not_found')
  const proposal:ApprovalProposal={
    tenantId:request.tenant_id,purchaseId:request.purchase_id,
    employeeId:request.employee_id,departmentId:request.department_id,
    policyVersion:request.policy_version,snapshotSha256:request.snapshot_sha256,
    amountPaise:request.amount_paise,requiredApprovers:request.required_approvers,
    expiresAt:request.expires_at,approvalSha256:request.approval_sha256,
  }
  const verified=validateEnterpriseApprovalVote(context,proposal,{
    tenantId:context.tenantId,requestId,actorId:context.actorId,decision,
  })
  const {error:insertError}=await supabaseAdmin.from(VOTES).insert({
    request_id:requestId,tenant_id:proposal.tenantId,actor_id:verified.actorId,decision:verified.decision,
  })
  if(insertError && insertError.code!=='23505') throw new PurchaseBoundaryError('purchase_store_unavailable')
  if(insertError){
    const {data:prev,error:prevError}=await supabaseAdmin.from(VOTES)
      .select('decision').eq('request_id',requestId).eq('tenant_id',proposal.tenantId)
      .eq('actor_id',verified.actorId).maybeSingle()
    if(prevError||!prev||prev.decision!==decision) throw new PurchaseBoundaryError('enterprise_approval_vote_conflict')
  }
  return readEnterpriseSpendApproval(requestId,proposal.tenantId)
}

export async function readEnterpriseSpendApproval(requestId:string,tenantId:string) {
  assertPurchaseFeatureEnabled()
  const {data:request,error}=await supabaseAdmin.from(REQUESTS).select('*')
    .eq('id',requestId).eq('tenant_id',tenantId).maybeSingle()
  if(error) throw new PurchaseBoundaryError('purchase_store_unavailable')
  if(!request) throw new PurchaseBoundaryError('enterprise_approval_not_found')
  const {data:votes,error:votesError}=await supabaseAdmin.from(VOTES).select('actor_id,decision')
    .eq('request_id',requestId).eq('tenant_id',tenantId)
  if(votesError) throw new PurchaseBoundaryError('purchase_store_unavailable')
  const proposal:ApprovalProposal={
    tenantId:request.tenant_id,purchaseId:request.purchase_id,employeeId:request.employee_id,
    departmentId:request.department_id,policyVersion:request.policy_version,
    snapshotSha256:request.snapshot_sha256,amountPaise:request.amount_paise,
    requiredApprovers:request.required_approvers,expiresAt:request.expires_at,
    approvalSha256:request.approval_sha256,
  }
  return {requestId,...enterpriseApprovalView(proposal,votes||[])}
}
