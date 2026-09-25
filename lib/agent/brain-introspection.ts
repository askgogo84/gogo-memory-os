import { supabaseAdmin } from '@/lib/supabase-admin'
import { summarizeLearningActivity } from './learning-report'

export function isSameBrainIntrospection(raw:string){
  const text=String(raw||'').trim().toLowerCase().replace(/[’]/g,"'")
  if(/^(?:what time|when)\b/.test(text)||/\b(?:event|meeting|appointment)\b/.test(text))return false
  const topic=/\b(?:same brain|decision[- ]making|shadow[- ]only|guarded[- ]live|route automatically|routing confidence|learned from my|learning system|learning metrics)\b/.test(text)
  const read=/^(?:(?:please|gogo)[, ]+)?(?:what|how|which|why|are you|do you|have you|can you (?:show|tell|explain)|show|tell|explain|describe|report)\b/.test(text)
  return topic&&(read||/^(?:same brain(?: v2)?|learning metrics|routing confidence)[?.!]*$/.test(text))
}

export function formatBrainIntrospection(rows:any[],limit=250){
  const report=summarizeLearningActivity(rows),s=report.summary
  const percent=(v:number)=>`${(v*100).toFixed(1)}%`
  return [
    '🧠 *Same Brain v2 — measured state*',
    `Last 7 days; newest ${limit} activity rows at most${rows.length>=limit?' (sample limit reached)':''}.`,
    `Learning samples: ${s.decisions} decision/handler outcomes (legacy events without IDs cannot be deduplicated).`,
    `Positive evidence: ${report.positiveEvidence}; replacement-route evidence: ${report.replacementEvidence} (not completion).`,
    `Provider-verified successes: ${s.verifiedCompletions}`,
    `Corrections: ${s.corrections}; failures: ${s.failures}; clarifications: ${s.clarifications}; outcome unknown: ${s.unknown}.`,
    '',
    '*Learned handler evidence:*',
    ...(!report.patterns.length?['Insufficient learning evidence in this sample.']:report.patterns.slice(0,8).map(p=>
      `• ${p.handler}: ${p.verifiedCompletions} provider-verified; ${p.corrections+p.failures} negative; ${p.calibrationSamples} identified samples; calibrated confidence ${p.calibrationSamples<p.minimumSamples?'insufficient evidence':percent(p.confidence)}`)),
    '',
    `Guarded-live decisions observed: ${report.routing.allowedHints}`,
    `Shadow-only decisions observed: ${report.routing.shadowOnlyHints}`,
    ...report.routeDecisions.slice(0,6).map(d=>`• ${d.guardedLive?'guarded-live':'shadow-only'}: ${d.handler||'no candidate'} — ${d.confidence===null?'confidence unavailable':percent(d.confidence)} — ${d.reason.replace(/_/g,' ')}`),
    'These are observed routing hints, not proof that a route executed. Confidence uses the 95% Wilson lower bound of provider-verified completion; at least 20 identified samples are required.',
    'Typed state takes precedence over learned hints. Learning cannot increase permissions, bypass approvals or provider verification, weaken safety gates, or retry unknown mutations. Consequential sends, payments and bookings remain gated.',
  ].join('\n')
}

export async function sameBrainIntrospection(p:{actor:{legacyTelegramId:number};text:string}){
  if(!Number.isFinite(p.actor.legacyTelegramId))throw new Error('brain_identity_required')
  const {data,error}=await supabaseAdmin.from('agent_activity').select('metadata_json,created_at,event_type')
    .eq('telegram_id',String(p.actor.legacyTelegramId)).in('event_type',['decision_learning','shadow_brain_observation'])
    .gte('created_at',new Date(Date.now()-168*3600000).toISOString())
    .order('created_at',{ascending:false}).limit(250)
  if(error)throw new Error('same_brain_introspection_read_failed')
  return formatBrainIntrospection(data||[])
}

// Shared deterministic entry point: matching reads must never fall through to a model,
// including when the telemetry store is unavailable.
export async function trySameBrainIntrospection(p:{actor:{legacyTelegramId:number};text:string}){
  if(!isSameBrainIntrospection(p.text))return null
  try{return {text:await sameBrainIntrospection(p),handledBy:'same-brain-introspection',status:'completed',readOnly:true,mutated:false}}
  catch{return {text:'Same Brain v2: measured learning evidence is temporarily unavailable. I cannot report counts or confidence until the evidence store can be read.',handledBy:'same-brain-introspection',status:'unavailable',readOnly:true,mutated:false}}
}
