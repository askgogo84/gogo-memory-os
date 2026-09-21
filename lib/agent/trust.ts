export type TrustClass =
  | 'SYSTEM_POLICY'
  | 'USER_INSTRUCTION'
  | 'CONNECTED_ACCOUNT_DATA'
  | 'EXTERNAL_WEB_DATA'
  | 'DOCUMENT_CONTENT'
  | 'MODEL_INFERENCE'
  | 'EXECUTION_EVIDENCE'

const AUTHORITY = new Set<TrustClass>(['SYSTEM_POLICY','USER_INSTRUCTION'])

export function canGrantExecutionAuthority(trust:TrustClass){
  return AUTHORITY.has(trust)
}

export function canAuthorizeConsequentialAction(params:{
  mode:'read'|'draft'|'execute'
  objectiveTrust:TrustClass
}){
  return params.mode==='execute' && canGrantExecutionAuthority(params.objectiveTrust)
}

export function labelTrust<T>(trust:TrustClass,value:T){
  return {trust,value}
}
