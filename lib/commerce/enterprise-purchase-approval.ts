import {createHash} from 'node:crypto'
import {PurchaseBoundaryError} from './purchase-contract'
import {evaluateEnterprisePurchasePolicy,type EnterpriseSpendingPolicy} from './enterprise-spending-policy'

/**
 * Source inputs must come from trusted enterprise membership and policy storage,
 * not an agent, a user request, or customer-supplied "I'm the approver" fields.
 * No order, payment, company budget reservation or funds transfer occurs here.
 */
export type VerifiedEmployeeContext = {
  membershipVerified: true
  active: true
  tenantId: string
  employeeId: string
  departmentId: string
  category: string
}
export type VerifiedApproverContext = {
  membershipVerified: true
  active: true
  canApproveSpending: true
  tenantId: string
  actorId: string
}
export type EnterprisePurchaseSummary = {
  id: string
  owner_telegram_id: string
  provider: string
  amount_paise: number
  snapshot_sha256: string
  currency: 'INR'
  expires_at: string
  status: string
}
export type ApprovalProposal = {
  tenantId:string
  purchaseId:string
  employeeId:string
  departmentId:string
  policyVersion:string
  snapshotSha256:string
  amountPaise:number
  requiredApprovers:string[]
  expiresAt:string
  approvalSha256:string
}
const id=(value:unknown):value is string=>typeof value==='string'&&
  value.length>0&&value.length<=128&&/^[A-Za-z0-9_.:-]+$/.test(value)
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const fail=(code:string):never=>{throw new PurchaseBoundaryError(code)}

export function enterpriseApprovalProposal(
  actor:VerifiedEmployeeContext,
  purchase:EnterprisePurchaseSummary,
  policy:EnterpriseSpendingPolicy | null,
  now=Date.now(),
):ApprovalProposal | null{
  if(!actor||actor.membershipVerified!==true||actor.active!==true||
    !id(actor.tenantId)||!id(actor.employeeId)||!id(actor.departmentId)||!id(actor.category)||
    !purchase||!id(purchase.id)||!id(purchase.owner_telegram_id)||
    !id(purchase.provider)||!sha(purchase.snapshot_sha256)||
    purchase.currency!=='INR'||!Number.isSafeInteger(purchase.amount_paise)||
    purchase.amount_paise<=0||!Number.isFinite(now)||
    !['awaiting_provider_handoff','pending_approval'].includes(purchase.status)){
    return fail('enterprise_scope_unverified')
  }
  const until=Date.parse(purchase.expires_at)
  if(!Number.isFinite(until)||until<=now||until-now>300000)
    return fail('enterprise_cart_expired')
  const decision=evaluateEnterprisePurchasePolicy({
    tenantId:actor.tenantId, employeeId:actor.employeeId,
    departmentId:actor.departmentId, merchant:purchase.provider,
    category:actor.category, currency:'INR',amountPaise:purchase.amount_paise,
    cartSha256:purchase.snapshot_sha256,observedAt:until-300000,now,
  },policy)
  if(decision.status==='blocked') return fail('enterprise_policy_'+decision.reason)
  if(decision.status==='within_policy') return null
  if(!policy||!id(policy.version)||!decision.approvers.length) return fail('enterprise_policy_unavailable')
  const expiresAt=new Date(Math.min(until,policy.expiresAt)).toISOString()
  if(Date.parse(expiresAt)<=now) return fail('enterprise_policy_expired')
  const payload={
    tenantId:actor.tenantId,purchaseId:purchase.id,employeeId:actor.employeeId,
    departmentId:actor.departmentId,policyVersion:policy.version,
    snapshotSha256:purchase.snapshot_sha256,amountPaise:purchase.amount_paise,
    requiredApprovers:[...decision.approvers],expiresAt,
  }
  return {...payload,approvalSha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex')}
}

export type ApprovalVote={tenantId:string;requestId:string;actorId:string;decision:'approve'|'reject'}
export function validateEnterpriseApprovalVote(
  context:VerifiedApproverContext, proposal:ApprovalProposal, vote:ApprovalVote, now=Date.now(),
) {
  if(!context || context.membershipVerified!==true||context.active!==true||
    context.canApproveSpending!==true || !proposal || !vote ||
    context.tenantId!==proposal.tenantId || vote.tenantId!==proposal.tenantId ||
    !id(context.actorId)||context.actorId===proposal.employeeId||
    !proposal.requiredApprovers.includes(context.actorId)||
    !id(vote.requestId)||vote.actorId!==context.actorId||
    !['approve','reject'].includes(vote.decision)||
    !sha(proposal.approvalSha256)||!Number.isFinite(now)||
    Date.parse(proposal.expiresAt)<=now) return fail('enterprise_approval_denied')
  return {actorId:context.actorId,decision:vote.decision}
}

export function enterpriseApprovalView(
  proposal:ApprovalProposal, votes:ReadonlyArray<{actor_id:string;decision:string}>, now=Date.now(),
) {
  const required=new Set(proposal.requiredApprovers)
  const approved=new Set<string>()
  let rejected=false
  for(const vote of votes) {
    if(!required.has(vote.actor_id)||!['approve','reject'].includes(vote.decision)) continue
    if(vote.decision==='reject') rejected=true
    else approved.add(vote.actor_id)
  }
  const expired=!Number.isFinite(now)||Date.parse(proposal.expiresAt)<=now
  return {
    status:expired?'expired':rejected?'rejected':
      required.size>0&&[...required].every(id=>approved.has(id))?'approved':'pending',
    requiredApprovals:required.size,approvedCount:approved.size,
    // Enterprise preflight approval never grants order/payment authority.
    canExecute:false as const,
  }
}
