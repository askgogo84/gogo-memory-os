import { supabaseAdmin } from '@/lib/supabase-admin'

export type AgentEventType =
  | 'run_started'
  | 'run_updated'
  | 'run_completed'
  | 'run_failed'
  | 'watch_started'
  | 'watch_triggered'
  | 'watch_stopped'
  | 'approval_requested'
  | 'approval_resolved'
  | 'idea_created'
  | 'idea_dismissed'
  | 'memory_saved'
  | 'memory_recalled'
  | 'artifact_created'
  | 'notification_sent'
  | 'system'

export async function recordAgentEvent(input:{
  telegramId:string|number
  eventType:AgentEventType
  title:string
  body?:string|null
  sourceType?:string|null
  sourceId?:string|null
  payload?:Record<string,unknown>
  importance?:0|1|2|3
  surface?:'whatsapp'|'web'|'android'|'ios'|'system'|null
  occurredAt?:string
}){
  const row={
    telegram_id:String(input.telegramId),
    event_type:input.eventType,
    source_type:input.sourceType||null,
    source_id:input.sourceId||null,
    title:String(input.title||'Gogo update').slice(0,240),
    body:input.body?String(input.body).slice(0,4000):null,
    payload_json:input.payload||{},
    importance:input.importance??1,
    surface:input.surface||null,
    occurred_at:input.occurredAt||new Date().toISOString(),
  }
  const {error}=await supabaseAdmin.from('agent_events').insert(row)
  if(error)console.error('AGENT_EVENT_WRITE_FAILED:',error.message)
}
