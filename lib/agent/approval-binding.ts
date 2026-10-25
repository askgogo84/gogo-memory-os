import { approvalActionHash, approvalActionSnapshot, type ApprovalFingerprintInput } from './approval-fingerprint'

export const APPROVAL_POLICY_VERSION = 'brain-v1.1'

export function buildApprovalBinding(input: Omit<ApprovalFingerprintInput,'policyVersion'> & {policyVersion?:string}) {
  const full:ApprovalFingerprintInput={...input,policyVersion:input.policyVersion||APPROVAL_POLICY_VERSION}
  return {
    action_hash:approvalActionHash(full),
    policy_version:full.policyVersion,
    action_snapshot_json:approvalActionSnapshot(full),
  }
}

export function assertApprovalBinding(
  input: Omit<ApprovalFingerprintInput,'policyVersion'> & {policyVersion?:string},
  approval:{action_hash?:string|null;policy_version?:string|null}|null|undefined,
) {
  if(!approval?.action_hash) throw new Error('approval_binding_missing')
  const policyVersion=String(approval.policy_version||input.policyVersion||APPROVAL_POLICY_VERSION)
  const full:ApprovalFingerprintInput={...input,policyVersion}
  const current=approvalActionHash(full)
  if(current!==String(approval.action_hash)) throw new Error('approval_action_changed')
  return true
}
