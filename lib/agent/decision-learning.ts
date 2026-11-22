import { hasExecutionEvidence, type ExecutionEvidence } from './execution-evidence'
import { hasDeliveryLearningEvidence, type DeliveryLearningRef } from './delivery-learning'
import { verifiedReadEvidence } from './read-evidence'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import { finiteConfidence, rankEvidence } from './decision-evidence'
import { isSecretShapedMemory, redactSecretShapedText } from '@/lib/bot/memory-redaction'
export type DecisionDomain='email'|'calendar'|'reminders'|'watchers'|'travel'|'browser'|'other'
export type DecisionOutcome='verified_success'|'success'|'clarified'|'corrected'|'failed'|'blocked'|'unknown'|'replacement'
// Exported Same Brain entrypoints may be called with a forged actor even when
// the normal authenticated actor resolver has already been hardened.
// Never round 64-bit owner IDs before a private receipt read or learning write.
function exactDecisionLearningOwner(actor:AgentActor):string {
  const raw:unknown=actor?.legacyTelegramId
  if(typeof raw==='number'){
    if(!Number.isSafeInteger(raw)||raw===0)throw new Error('decision_learning_owner_invalid')
    return String(raw)
  }
  // Preserve historical canonical safe-decimal callers without permitting
  // lossy BIGINT, padded, exponent or coerced object identities.
  if(typeof raw==='string'&&/^-?[1-9]\d*$/.test(raw)&&Number.isSafeInteger(Number(raw))&&String(Number(raw))===raw)return raw
  throw new Error('decision_learning_owner_invalid')
}
function clean(v:unknown,max=500){return String(v??'').replace(/\s+/g,' ').trim().slice(0,max)}
function tokens(v:unknown){return new Set(clean(v,600).toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(x=>x.length>2))}
function similarity(a:unknown,b:unknown){const x=tokens(a),y=tokens(b);if(!x.size||!y.size)return 0;let n=0;for(const t of x)if(y.has(t))n++;return n/Math.max(x.size,y.size)}
export function decisionDomain(capability:string,handler?:string):DecisionDomain{const s=(capability+' '+(handler||'')).toLowerCase();if(/email|gmail/.test(s))return'email';if(/calendar/.test(s))return'calendar';if(/remind/.test(s))return'reminders';if(/watch|monitor/.test(s))return'watchers';if(/travel|flight|hotel/.test(s))return'travel';if(/browser|web/.test(s))return'browser';return'other'}
// Positive, exact-object proof only: a caller's boolean `verified` is never evidence.
// Entries here are emitted by internal owner-bound specialists after a provider/DB
// readback. A model result, HTTP 200, delivery SID, or arbitrary handler is excluded.
const VERIFIED_READ_HANDLERS: Record<string,{source:string;kind:string;objectKind?:string}> = {
  'gmail-verification': {source:'gmail',kind:'read',objectKind:'gmail_send'},
  'watcher-status': {source:'canonical_watchers',kind:'read'},
  'calendar-named-read': {source:'google_calendar',kind:'read',objectKind:'calendar_event'},
  'reminder-query': {source:'canonical_reminders',kind:'read',objectKind:'reminder'},
  'reminder-update': {source:'canonical_reminders',kind:'canonical_state',objectKind:'reminder'},
}
function hasReadLearningEvidence(p:{handler:string;objectKind?:string|null;objectRef?:string|null;readEvidence?:unknown}):boolean {
  const allowed=VERIFIED_READ_HANDLERS[p.handler]
  const proof=p.readEvidence
  if(!allowed||!proof||typeof proof!=='object')return false
  const v=proof as Record<string,unknown>
  if(v.verified!==true||v.source!==allowed.source||v.kind!==allowed.kind)return false
  if(allowed.objectKind&&v.objectKind!==allowed.objectKind)return false
  if(typeof p.objectKind!=='string'||!p.objectKind||v.objectKind!==p.objectKind)return false
  if(typeof p.objectRef!=='string'||!p.objectRef.trim()||v.objectRef!==p.objectRef)return false
  return !['gmail-verification','watcher-status'].includes(p.handler)||verifiedReadEvidence(p.handler,'completed',v)
}
export async function recordDecisionLearning(p:{actor:AgentActor;text:string;domain:DecisionDomain;handler:string;objectKind?:string|null;objectRef?:string|null;confidence?:number|null;outcome:DecisionOutcome;verified?:boolean;deliveryRef?:DeliveryLearningRef;executionEvidence?:ExecutionEvidence;readEvidence?:unknown;correction?:string|null;decisionId?:string|null;firstRouteCorrect?:boolean|null}){const owner=exactDecisionLearningOwner(p.actor);const evidence=await hasDeliveryLearningEvidence(owner,p.handler,p.objectKind,p.deliveryRef);const execution=hasExecutionEvidence(p.handler,p.objectRef,p.executionEvidence);const readVerified=hasReadLearningEvidence(p);const verified=p.verified===true&&evidence!==false&&(evidence===true||execution===true||readVerified);const metadata={schema:'same-brain-v2',decision_id:clean(p.decisionId,180)||null,first_route_correct:typeof p.firstRouteCorrect==='boolean'?p.firstRouteCorrect:null,domain:p.domain,user_text:isSecretShapedMemory(p.text)?'[sensitive turn withheld]':redactSecretShapedText(clean(p.text,800)),handler:clean(p.handler,100),object_kind:clean(p.objectKind,80)||null,object_ref:clean(p.objectRef,240)||null,confidence:finiteConfidence(p.confidence),outcome:p.outcome==='verified_success'&&!verified?'unknown':p.outcome,verified:p.outcome==='verified_success'&&verified,verification_source:verified&&p.outcome==='verified_success'?(p.executionEvidence?.source||(evidence===true?'delivery_receipt':readVerified?String((p.readEvidence as {source:string}).source):null)):null,correction: p.correction ? (isSecretShapedMemory(p.correction)?'[sensitive correction withheld]':redactSecretShapedText(clean(p.correction,500))) : null};const {error}=await supabaseAdmin.from('agent_activity').insert({telegram_id:owner,event_type:'decision_learning',message:`Same Brain v2: ${p.domain} / ${p.handler} / ${metadata.outcome}`,metadata_json:metadata});if(error)throw new Error('decision_learning_write_failed')}
export async function decisionHints(p:{actor:AgentActor;text:string;domain:DecisionDomain}){
  const owner=exactDecisionLearningOwner(p.actor)
  const {data,error}=await supabaseAdmin.from('agent_activity').select('metadata_json,created_at')
    .eq('telegram_id',owner).eq('event_type','decision_learning')
    .eq('metadata_json->>domain',p.domain).order('created_at',{ascending:false}).limit(120)
  const rows=error?[]:(data||[]).map((r:any)=>r.metadata_json)
    .filter((m:any)=>m?.schema==='same-brain-v2'&&m.domain===p.domain)
    .map((m:any)=>({...m,similarity:similarity(p.text,m.user_text)})).filter((m:any)=>m.similarity>=.34)
  return {...rankEvidence(rows),examples:[]}
}
export function canLearningOverrideSafety(){return false}

export async function recordDecisionCorrection(p:{actor:AgentActor;text:string;domain:DecisionDomain;wrongHandler:string;correctHandler?:string|null;reason?:string|null}){
  await recordDecisionLearning({actor:p.actor,text:p.text,domain:p.domain,handler:p.wrongHandler,outcome:'corrected',verified:false,correction:p.reason||p.correctHandler||'user correction'})
  if(p.correctHandler)await recordDecisionLearning({actor:p.actor,text:p.text,domain:p.domain,handler:p.correctHandler,outcome:'replacement',verified:false,correction:'replacement after correction'})
}
export async function recordDecisionClarification(p:{actor:AgentActor;text:string;domain:DecisionDomain;handler:string}){
  await recordDecisionLearning({actor:p.actor,text:p.text,domain:p.domain,handler:p.handler,outcome:'clarified',verified:false})
}

export type GuardedRoutingDecision={useLearned:boolean;handler:string|null;confidence:number;reason:string}
const SAFE_LEARNED_HANDLERS=new Set(['gmail-context','gmail-verification','calendar-named-read','read-only-schedule','reminder-query','watcher-status','autonomy-status','connection-status'])
const CONSEQUENTIAL=/gmail-send|calendar-create|book|checkout|purchase|payment|send-email|delete|submit/i
export function calibrateGuardedRouting(p:{preferredHandler:string|null;confidence:number;avoidHandlers:string[];typedContextHandler?:string|null;conflictingTypedContext?:boolean;actionRequiresApproval?:boolean}):GuardedRoutingDecision{
  if(!p.preferredHandler)return{useLearned:false,handler:null,confidence:0,reason:'no_learned_preference'}
  if(!Number.isFinite(p.confidence)||p.confidence<0||p.confidence>1)return{useLearned:false,handler:null,confidence:0,reason:'invalid_confidence'}
  if(p.actionRequiresApproval||CONSEQUENTIAL.test(p.preferredHandler))return{useLearned:false,handler:null,confidence:p.confidence,reason:'safety_kernel'}
  if(!SAFE_LEARNED_HANDLERS.has(p.preferredHandler))return{useLearned:false,handler:null,confidence:p.confidence,reason:'handler_not_approved_for_live_learning'}
  if(p.conflictingTypedContext)return{useLearned:false,handler:null,confidence:p.confidence,reason:'typed_context_conflict'}
  if(p.typedContextHandler&&p.typedContextHandler!==p.preferredHandler)return{useLearned:false,handler:null,confidence:p.confidence,reason:'typed_context_wins'}
  if(p.avoidHandlers.includes(p.preferredHandler))return{useLearned:false,handler:null,confidence:p.confidence,reason:'negative_evidence'}
  if(p.confidence<0.82)return{useLearned:false,handler:null,confidence:p.confidence,reason:'below_live_threshold'}
  return{useLearned:true,handler:p.preferredHandler,confidence:p.confidence,reason:'high_confidence_non_consequential'}
}
export async function guardedRoutingHint(p:{actor:AgentActor;text:string;domain:DecisionDomain;typedContextHandler?:string|null;conflictingTypedContext?:boolean;actionRequiresApproval?:boolean}){
  const hints=await decisionHints({actor:p.actor,text:p.text,domain:p.domain})
  return {...hints,decision:calibrateGuardedRouting({...hints,typedContextHandler:p.typedContextHandler,conflictingTypedContext:p.conflictingTypedContext,actionRequiresApproval:p.actionRequiresApproval})}
}

export { isSameBrainIntrospection, sameBrainIntrospection } from './brain-introspection'
