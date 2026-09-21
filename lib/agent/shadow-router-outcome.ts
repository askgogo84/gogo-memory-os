import { supabaseAdmin } from '@/lib/supabase-admin'

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
    run_id:params.runId||null,
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
}
