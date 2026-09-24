import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
export type DecisionDomain='email'|'calendar'|'reminders'|'watchers'|'travel'|'browser'|'other'
export type DecisionOutcome='verified_success'|'success'|'clarified'|'corrected'|'failed'|'blocked'|'unknown'
function clean(v:unknown,max=500){return String(v??'').replace(/\s+/g,' ').trim().slice(0,max)}
function tokens(v:unknown){return new Set(clean(v,600).toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(x=>x.length>2))}
function similarity(a:unknown,b:unknown){const x=tokens(a),y=tokens(b);if(!x.size||!y.size)return 0;let n=0;for(const t of x)if(y.has(t))n++;return n/Math.max(x.size,y.size)}
export function decisionDomain(capability:string,handler?:string):DecisionDomain{const s=(capability+' '+(handler||'')).toLowerCase();if(/email|gmail/.test(s))return'email';if(/calendar/.test(s))return'calendar';if(/remind/.test(s))return'reminders';if(/watch|monitor/.test(s))return'watchers';if(/travel|flight|hotel/.test(s))return'travel';if(/browser|web/.test(s))return'browser';return'other'}
export async function recordDecisionLearning(p:{actor:AgentActor;text:string;domain:DecisionDomain;handler:string;objectKind?:string|null;objectRef?:string|null;confidence?:number|null;outcome:DecisionOutcome;verified?:boolean;correction?:string|null}){const metadata={schema:'same-brain-v2',domain:p.domain,user_text:clean(p.text,800),handler:clean(p.handler,100),object_kind:clean(p.objectKind,80)||null,object_ref:clean(p.objectRef,240)||null,confidence:Number.isFinite(Number(p.confidence))?Number(p.confidence):null,outcome:p.outcome,verified:Boolean(p.verified),correction:clean(p.correction,500)||null};await supabaseAdmin.from('agent_activity').insert({telegram_id:String(p.actor.legacyTelegramId),event_type:'decision_learning',message:`Same Brain v2: ${p.domain} / ${p.handler} / ${p.outcome}`,metadata_json:metadata})}
export async function decisionHints(p:{actor:AgentActor;text:string;domain:DecisionDomain}){const {data,error}=await supabaseAdmin.from('agent_activity').select('metadata_json,created_at').eq('telegram_id',String(p.actor.legacyTelegramId)).eq('event_type','decision_learning').order('created_at',{ascending:false}).limit(120);if(error)return {preferredHandler:null as string|null,avoidHandlers:[] as string[],examples:[] as any[],confidence:0};const rows=(data||[]).map((r:any)=>r.metadata_json).filter((m:any)=>m?.schema==='same-brain-v2'&&m.domain===p.domain).map((m:any)=>({...m,similarity:similarity(p.text,m.user_text)})).filter((m:any)=>m.similarity>=.34);const score=new Map<string,number>(),bad=new Map<string,number>();for(const m of rows){const w=m.similarity*(m.verified?1.35:1),h=String(m.handler||'');if(!h)continue;if(['verified_success','success'].includes(m.outcome))score.set(h,(score.get(h)||0)+w);if(['corrected','failed'].includes(m.outcome))bad.set(h,(bad.get(h)||0)+w)}const ranked=[...score.entries()].map(([h,s])=>[h,s-(bad.get(h)||0)] as [string,number]).sort((a,b)=>b[1]-a[1]);const preferred=ranked[0]&&ranked[0][1]>=1.2?ranked[0][0]:null;return {preferredHandler:preferred,avoidHandlers:[...bad.entries()].filter(([,s])=>s>=.9).sort((a,b)=>b[1]-a[1]).map(([h])=>h).slice(0,4),examples:rows.slice(0,5),confidence:preferred?Math.min(.94,.55+ranked[0][1]/8):0}}
export function canLearningOverrideSafety(){return false}

export async function recordDecisionCorrection(p:{actor:AgentActor;text:string;domain:DecisionDomain;wrongHandler:string;correctHandler?:string|null;reason?:string|null}){
  await recordDecisionLearning({actor:p.actor,text:p.text,domain:p.domain,handler:p.wrongHandler,outcome:'corrected',verified:false,correction:p.reason||p.correctHandler||'user correction'})
  if(p.correctHandler)await recordDecisionLearning({actor:p.actor,text:p.text,domain:p.domain,handler:p.correctHandler,outcome:'success',verified:false,correction:'replacement after correction'})
}
export async function recordDecisionClarification(p:{actor:AgentActor;text:string;domain:DecisionDomain;handler:string}){
  await recordDecisionLearning({actor:p.actor,text:p.text,domain:p.domain,handler:p.handler,outcome:'clarified',verified:false})
}

export type GuardedRoutingDecision={useLearned:boolean;handler:string|null;confidence:number;reason:string}
const CONSEQUENTIAL=/gmail-send|calendar-create|book|checkout|purchase|payment|send-email|delete|submit/i
export function calibrateGuardedRouting(p:{preferredHandler:string|null;confidence:number;avoidHandlers:string[];typedContextHandler?:string|null;conflictingTypedContext?:boolean;actionRequiresApproval?:boolean}):GuardedRoutingDecision{
  if(!p.preferredHandler)return{useLearned:false,handler:null,confidence:0,reason:'no_learned_preference'}
  if(p.actionRequiresApproval||CONSEQUENTIAL.test(p.preferredHandler))return{useLearned:false,handler:null,confidence:p.confidence,reason:'safety_kernel'}
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
