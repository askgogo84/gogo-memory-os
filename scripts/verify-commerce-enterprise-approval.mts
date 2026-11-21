import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {enterpriseApprovalProposal,validateEnterpriseApprovalVote,enterpriseApprovalView} from '../lib/commerce/enterprise-purchase-approval'
import {PurchaseBoundaryError} from '../lib/commerce/purchase-contract'
const now=Date.parse('2026-11-15T13:00:00Z')
const member={membershipVerified:true as const,active:true as const,tenantId:'company-a',employeeId:'employee-1',departmentId:'sales',category:'food'}
const purchase={id:'purchase-1',owner_telegram_id:'employee-owner',provider:'swiggy',amount_paise:30000,
  snapshot_sha256:'a'.repeat(64),currency:'INR' as const,status:'pending_approval',expires_at:new Date(now+240000).toISOString()}
const policy={tenantId:'company-a',version:'policy-3',active:true,merchantAllowlist:['swiggy'],categoryAllowlist:['food'],
  employeeLimitPaise:100000,departmentRemainingPaise:80000,employeeRemainingPaise:50000,approvalThresholdPaise:20000,
  requiredApprovers:['manager-1','finance-1'],expiresAt:now+180000}
const proposal=enterpriseApprovalProposal(member,purchase,policy,now)!
assert.equal(proposal.tenantId,'company-a')
assert.deepEqual(proposal.requiredApprovers,['manager-1','finance-1'])
assert.equal(proposal.expiresAt,new Date(now+180000).toISOString())
assert.match(proposal.approvalSha256,/^[a-f0-9]{64}$/)
const approver={membershipVerified:true as const,active:true as const,canApproveSpending:true as const,
  tenantId:'company-a',actorId:'manager-1'}
const vote={tenantId:'company-a',requestId:'approval-1',actorId:'manager-1',decision:'approve' as const}
assert.equal(validateEnterpriseApprovalVote(approver,proposal,vote,now).decision,'approve')
const forbidden=(actor:any,decision=vote)=>assert.throws(
  ()=>validateEnterpriseApprovalVote(actor,proposal,decision,now),
  e=>e instanceof PurchaseBoundaryError&&e.code==='enterprise_approval_denied')
forbidden({...approver,actorId:'employee-1'})
forbidden({...approver,tenantId:'company-b'})
forbidden({...approver,membershipVerified:false})
forbidden({...approver,canApproveSpending:false})
forbidden({...approver,actorId:'unlisted'})
forbidden(approver,{...vote,actorId:'finance-1'})
const pending=enterpriseApprovalView(proposal,[{actor_id:'manager-1',decision:'approve'}],now)
assert.equal(pending.status,'pending')
assert.equal(pending.canExecute,false)
assert.equal(enterpriseApprovalView(proposal,[{actor_id:'manager-1',decision:'approve'},
  {actor_id:'finance-1',decision:'approve'}],now).status,'approved')
assert.equal(enterpriseApprovalView(proposal,[{actor_id:'manager-1',decision:'reject'},
  {actor_id:'finance-1',decision:'approve'}],now).status,'rejected')
assert.equal(enterpriseApprovalView(proposal,[],now+181000).status,'expired')
assert.equal(enterpriseApprovalProposal(member,{...purchase,amount_paise:10000},policy,now),null)
assert.throws(()=>enterpriseApprovalProposal({...member,tenantId:'company-b'},purchase,policy,now))
assert.throws(()=>enterpriseApprovalProposal(member,{...purchase,status:'handoff_released'},policy,now))
const svc=readFileSync('lib/commerce/enterprise-purchase-approval-store.ts','utf8')
const sql=readFileSync('supabase/migrations/20261115150000_commerce_enterprise_spend_approvals.sql','utf8')
assert.match(svc,/eq\('tenant_id',context\.tenantId\)/)
assert.match(svc,/validateEnterpriseApprovalVote/)
assert.doesNotMatch(svc,/checkout\(|capture_payment|chargeCard/)
assert.match(sql,/enable row level security/g)
assert.match(sql,/before update or delete/g)
assert.match(sql,/unique\(request_id,actor_id\)/)
console.log('✅ enterprise tenant-bound multi-approver exact-cart approval contract checks passed')
