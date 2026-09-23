import { supabaseAdmin } from '@/lib/supabase-admin'
import type { JevShadowResult } from '@/lib/typesafe/jev-shadow'

export type JevPromotedIntent =
  | 'watcher'
  | 'reminder_read'
  | 'reminder_mutation'
  | 'calendar_read'
  | 'calendar_mutation'
  | 'email_read'
  | 'email_mutation'
  | 'list_task'
  | 'memory_context'
  | 'travel_research'
  | 'browser_action'

const PROMOTABLE = new Set<JevPromotedIntent>([
  'watcher',
  'reminder_read',
  'reminder_mutation',
  'calendar_read',
  'calendar_mutation',
  'email_read',
  'email_mutation',
  'list_task',
  'memory_context',
  'travel_research',
  'browser_action',
])

export function promotedJevIntent(jev:JevShadowResult|null|undefined):JevPromotedIntent|null{
  if(!jev?.ok)return null
  const intent=String(jev.intent?.choice||'') as JevPromotedIntent
  const confidence=Number(jev.intent?.confidence||0)
  if(!PROMOTABLE.has(intent)||confidence<0.9)return null

  const readiness=String(jev.decisionReadiness?.choice||'')
  const readinessConfidence=Number(jev.decisionReadiness?.confidence||0)
  if(readiness==='clarify'&&readinessConfidence>=0.7)return null

  const referent=String(jev.referentKind?.choice||'none')
  const referentConfidence=Number(jev.referentKind?.confidence||0)
  if(referent!=='none'&&referentConfidence<0.75)return null
  if(jev.contextual&&referent==='none'&&referentConfidence<0.75)return null

  return intent
}

export async function recordJevRoutingHint(params:{
  telegramId:string|number
  eventId?:string|null
  intent:JevPromotedIntent
  handler:string
  confidence:number|null
  latencyMs:number|null
}){
  const {error}=await supabaseAdmin.from('agent_activity').insert({
    telegram_id:String(params.telegramId),
    event_type:'jev_routing_hint_used',
    message:'Jev semantic routing hint selected a specialist for first refusal.',
    metadata_json:{
      event_id:params.eventId||null,
      intent:params.intent,
      handler:params.handler,
      confidence:params.confidence,
      latency_ms:params.latencyMs,
      authority:'first_refusal_only',
      execution_authority:false,
      router_version:'jev-router-v1.3',
    },
  })
  if(error)console.error('JEV_ROUTING_HINT_ACTIVITY_FAILED:',error.message)
}


export function jevClarificationReply(jev:JevShadowResult|null|undefined):string|null{
  if(!jev?.ok||!jev.contextual)return null
  const readiness=String(jev.decisionReadiness?.choice||'')
  const readinessConfidence=Number(jev.decisionReadiness?.confidence||0)
  if(readiness!=='clarify'||readinessConfidence<0.9)return null

  const referent=String(jev.referentKind?.choice||'other_context')
  const referentConfidence=Number(jev.referentKind?.confidence||0)
  const noun=referentConfidence>=0.6
    ? referent==='reminder'?'reminder'
      :referent==='calendar_event'?'meeting or calendar event'
        :referent==='watcher'?'monitor or watcher'
          :referent==='travel_option'?'travel option'
            :referent==='mission'?'task or mission'
              :'item'
    :'item'

  return `I’m not certain which ${noun} you mean, and I don’t want to act on the wrong one. Please name it or give me one identifying detail.`
}
