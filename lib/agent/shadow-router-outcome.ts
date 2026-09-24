import { supabaseAdmin } from '@/lib/supabase-admin'
import { decisionDomain, recordDecisionLearning } from './decision-learning'
import { observedOutcome, learningDecisionId } from './decision-evidence'
import type { AgentActor } from './actor'

export async function recordShadowRouterOutcome(params:{
  telegramId:string|number
  surface:'whatsapp'|'web'|'telegram'|'system'
  eventId:string
  actualHandler:string
  actualCapability?:string|null
  status?:string|null
  runId?:string|null
}){
  const eventId=String(params.eventId||'').trim()
  if(!eventId)return
  const {error}=await supabaseAdmin.from('agent_activity').insert({
    telegram_id:String(params.telegramId),
    run_id:learningDecisionId(null,params.runId),
    event_type:'shadow_router_outcome',
    message:'Current production router handled the turn.',
    metadata_json:{
      surface:params.surface,
      event_id:eventId,
      actual_handler:String(params.actualHandler||'unknown').slice(0,120),
      actual_capability:params.actualCapability?String(params.actualCapability).slice(0,80):null,
      status:params.status?String(params.status).slice(0,60):null,
      shadow_version:'shadow-brain-v1',
    },
  })
  if(error)console.error('SHADOW_ROUTER_OUTCOME_FAILED:',error.message)
  // Pair the actual chosen handler with this exact user's observation. This
  // captures every instrumented web/WhatsApp domain, including browser tasks.
  const {data:observation,error:readError}=await supabaseAdmin.from('agent_activity')
    .select('metadata_json').eq('telegram_id',String(params.telegramId))
    .eq('event_type','shadow_brain_observation').eq('metadata_json->>event_id',eventId)
    .order('created_at',{ascending:false}).limit(1).maybeSingle()
  const m=observation?.metadata_json
  if(readError||!m?.user_text)return
  const actor={legacyTelegramId:Number(params.telegramId)} as AgentActor
  if(!Number.isFinite(actor.legacyTelegramId))return
  const domain=decisionDomain(String(params.actualCapability||m.capability||''),params.actualHandler)
  const outcome=params.actualHandler==='jev-clarification-guard'?'clarified':observedOutcome(params.status)
  await recordDecisionLearning({actor,text:m.user_text,domain,handler:params.actualHandler,decisionId:learningDecisionId(eventId,params.runId),
    objectKind:learningDecisionId(null,params.runId)?'agent_run':null,objectRef:learningDecisionId(null,params.runId),
    confidence:m.learned_routing?.useLearned?m.learned_routing.confidence:m.jev_shadow?.intent?.confidence,
    outcome,verified:false}).catch(()=>{})
  const target=m.correction_target
  if(target?.decisionId&&target.handler!==params.actualHandler&&params.status==='completed'){
    // Record a replacement preference on the ORIGINAL utterance/domain. A
    // replacement choice is not proof of successful provider completion.
    await recordDecisionLearning({actor,text:target.text,domain:target.domain,handler:params.actualHandler,
      decisionId:target.decisionId,outcome:'replacement',verified:false,correction:'replacement after explicit user correction'}).catch(()=>{})
  }
}
