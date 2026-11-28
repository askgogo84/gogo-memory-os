// Policy-only intake for durable learning, separate from storing source documents as data.
import {isSecretShapedMemory} from '../bot/memory-redaction'
type Origin='direct_user'|'workspace_admin'|'email'|'web'|'document'|'tool'|'model'
export type MemoryCandidate={origin:Origin;sourceRef:string;scopeKind:'personal'|'workspace';scopeId:string;actorId:string;kind:'fact'|'preference'|'procedure';text:string;explicitSave:boolean;expiresAt:number|null}
export function classifyMemoryCandidate(m:MemoryCandidate,auth:{scopeKind:'personal'|'workspace';scopeId:string;actorId:string;mayPublish:boolean},now=Date.now()):'reject'|'quarantine'|'candidate'{
  if(!m||!auth||m.scopeKind!==auth.scopeKind||m.scopeId!==auth.scopeId||m.actorId!==auth.actorId||!m.scopeId||!m.actorId||!['personal','workspace'].includes(m.scopeKind)||!['fact','preference','procedure'].includes(m.kind)||!['direct_user','workspace_admin','email','web','document','tool','model'].includes(m.origin))return'reject'
  if(typeof m.sourceRef!=='string'||!m.sourceRef.trim()||m.sourceRef.length>200||typeof m.text!=='string'||!m.text.trim()||m.text.length>2000||isSecretShapedMemory(m.text)||!Number.isSafeInteger(now))return'reject'
  if(m.expiresAt!==null&&(!Number.isSafeInteger(m.expiresAt)||m.expiresAt<=now))return'reject'
  if(m.kind==='procedure'||!['direct_user','workspace_admin'].includes(m.origin))return'quarantine'
  if(auth.mayPublish!==true||m.explicitSave!==true)return'quarantine'
  if(m.scopeKind==='personal'&&(m.scopeId!==m.actorId||m.origin!=='direct_user'))return'reject'
  if(m.scopeKind==='workspace'&&m.origin!=='workspace_admin')return'quarantine'
  // The caller must verify sourceRef/identity and publish through existing memory permissions.
  return'candidate'
}
