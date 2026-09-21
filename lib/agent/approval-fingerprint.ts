import { createHash } from 'node:crypto'

export type ApprovalFingerprintInput = {
  missionId:string
  stepId:string
  capability:string
  actionType:string
  target:string
  payload:unknown
  amount?:string|number|null
  objectRef?:string|null
  objectVersion?:string|number|null
  policyVersion:string
}

function canonicalize(value:unknown):unknown {
  if(Array.isArray(value)) return value.map(canonicalize)
  if(value && typeof value==='object') {
    return Object.fromEntries(
      Object.entries(value as Record<string,unknown>)
        .filter(([,v])=>v!==undefined)
        .sort(([a],[b])=>a.localeCompare(b))
        .map(([k,v])=>[k,canonicalize(v)])
    )
  }
  if(typeof value==='number' && Number.isFinite(value)) return Number(value)
  if(value===null || typeof value==='string' || typeof value==='boolean' || typeof value==='number') return value
  return String(value ?? '')
}

export function approvalActionSnapshot(input:ApprovalFingerprintInput){
  return canonicalize({
    missionId:String(input.missionId),
    stepId:String(input.stepId),
    capability:String(input.capability),
    actionType:String(input.actionType),
    target:String(input.target),
    payload:input.payload ?? null,
    amount:input.amount ?? null,
    objectRef:input.objectRef ?? null,
    objectVersion:input.objectVersion ?? null,
    policyVersion:String(input.policyVersion),
  }) as Record<string,unknown>
}

export function approvalActionHash(input:ApprovalFingerprintInput){
  const snapshot=approvalActionSnapshot(input)
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

export function approvalMatches(input:ApprovalFingerprintInput,expectedHash:string|null|undefined){
  const expected=String(expectedHash||'').trim().toLowerCase()
  return expected.length===64 && approvalActionHash(input)===expected
}
