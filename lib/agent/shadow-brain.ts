import { supabaseAdmin } from '@/lib/supabase-admin'
import { classifyAgentRequest } from './classifier'
import type { AgentActor } from './actor'

export type ShadowBrainObservation = {
  actionFamily:string
  capability:string
  needsContext:boolean
  focusKind:'mission'|'trip'|'conversation'|'none'
  focusRef:string|null
  focusSummary:string|null
  confidence:number
  ambiguous:boolean
}

function clean(value:unknown,max=500){
  return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
}

export function shadowActionFamily(text:string){
  const t=String(text||'').toLowerCase()
  if(/\b(calendar|schedule|diary)\b/.test(t)&&/\b(add|save|put|block|schedule)\b/.test(t))return 'calendar'
  if(/\b(remind|reminder|alert|notify)\b/.test(t))return 'remind'
  if(/\b(monitor|watch|track|keep an eye|let me know when|tell me when)\b/.test(t))return 'monitor'
  if(/\b(book|reserve|reservation|check[- ]?in)\b/.test(t))return 'book'
  if(/\b(buy|purchase|checkout|order(?:\s+(?:it|this|that|my\s+usual))?|pay for)\b/.test(t))return 'buy'
  if(/\b(send|forward|email|message|reply)\b/.test(t))return 'send'
  if(/\b(save|remember|keep this|store this)\b/.test(t))return 'save'
  if(/\b(check|find|research|look up|requirements?|what do i need|what about|show|compare|search)\b/.test(t))return 'research'
  if(/[?]$/.test(t)||/^(what|when|where|who|why|how|can|is|are|do|does|will)\b/.test(t))return 'ask'
  return 'other'
}

export function shadowNeedsContext(text:string){
  const t=String(text||'').trim().toLowerCase()
  if(/\b(it|this|that|these|those|them|there|same|usual|above|earlier|previous|last one|last time|first one|second one|third one|fourth one|the trip|the flight|the booking|the document|the file|the order|the hotel|the ticket|continue|proceed)\b/.test(t))return true
  return t.length<=80 && /^(save|add|put|monitor|watch|track|book|reserve|check|find|remind|send|forward|open|continue|proceed)\b/.test(t)
}

async function activeMission(actor:AgentActor){
  const {data,error}=await supabaseAdmin.from('agent_runs')
    .select('id,status,type,title,summary,updated_at')
    .eq('telegram_id',String(actor.legacyTelegramId))
    .in('status',['queued','running','waiting_approval','paused','outcome_unknown'])
    .order('updated_at',{ascending:false})
    .limit(1)
    .maybeSingle()
  if(error)throw error
  return data||null
}

async function recentTrip(actor:AgentActor){
  const cutoff=new Date(Date.now()-48*60*60*1000).toISOString()
  const {data,error}=await supabaseAdmin.from('travel_tickets')
    .select('id,booking_group,from_city,to_city,depart_at,flight_no,airline,pnr')
    .eq('telegram_id',actor.legacyTelegramId)
    .gte('depart_at',cutoff)
    .order('depart_at',{ascending:true})
    .limit(6)
  if(error)throw error
  if(!data?.length)return null
  const first=data[0],last=data[data.length-1]
  return {
    ref:'trip:'+String(first.booking_group||first.pnr||first.id),
    summary:[clean(first.from_city,80)+' to '+clean(last.to_city,80),first.flight_no?clean(first.flight_no,30):'',last.flight_no&&last.flight_no!==first.flight_no?clean(last.flight_no,30):''].filter(Boolean).join(', '),
  }
}

export async function observeShadowBrainTurn(params:{
  actor:AgentActor
  surface:'whatsapp'|'web'|'telegram'|'system'
  text:string
  eventId?:string|null
}):Promise<ShadowBrainObservation>{
  const classified=classifyAgentRequest(params.text)
  const contextual=shadowNeedsContext(params.text)
  let mission:any=null,trip:any=null
  try{
    [mission,trip]=await Promise.all([activeMission(params.actor),recentTrip(params.actor)])
  }catch(error:any){
    console.error('SHADOW_BRAIN_CONTEXT_FAILED:',clean(error?.message||error,180))
  }

  let focusKind:ShadowBrainObservation['focusKind']='none'
  let focusRef:string|null=null
  let focusSummary:string|null=null
  let confidence=contextual?0.55:0.9
  let ambiguous=false

  // Fresh structured trip beats stale paused background work for contextual turns.
  if(contextual&&trip){
    focusKind='trip';focusRef=trip.ref;focusSummary=trip.summary;confidence=0.88
  }else if(mission){
    focusKind='mission';focusRef='run:'+String(mission.id)
    focusSummary=clean([mission.title,mission.summary].filter(Boolean).join(' — '),500)
    confidence=contextual?0.78:0.7
  }else if(trip){
    focusKind='trip';focusRef=trip.ref;focusSummary=trip.summary;confidence=contextual?0.82:0.6
  }

  if(contextual&&!focusRef){ambiguous=true;confidence=0.25}

  const observation:ShadowBrainObservation={
    actionFamily:shadowActionFamily(params.text),
    capability:classified.capability,
    needsContext:contextual,
    focusKind,focusRef,focusSummary,
    confidence,ambiguous,
  }

  const {error}=await supabaseAdmin.from('agent_activity').insert({
    telegram_id:String(params.actor.legacyTelegramId),
    event_type:'shadow_brain_observation',
    message:'Shadow Brain observed the turn without controlling routing.',
    metadata_json:{
      surface:params.surface,
      event_id:params.eventId||null,
      action_family:observation.actionFamily,
      capability:observation.capability,
      needs_context:observation.needsContext,
      focus_kind:observation.focusKind,
      focus_ref:observation.focusRef,
      focus_summary:observation.focusSummary,
      confidence:observation.confidence,
      ambiguous:observation.ambiguous,
      shadow_version:'shadow-brain-v1',
    },
  })
  if(error)console.error('SHADOW_BRAIN_ACTIVITY_FAILED:',error.message)

  return observation
}
