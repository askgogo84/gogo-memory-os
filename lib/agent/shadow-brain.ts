import { supabaseAdmin } from '@/lib/supabase-admin'
import { classifyAgentRequest } from './classifier'
import type { AgentActor } from './actor'
import { runJevShadow } from '@/lib/typesafe/jev-shadow'

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
  if(!t)return false
  // Self-contained commands with an explicit URL or explicit reminder payload should
  // not inherit unrelated prior focus just because they start with an action verb.
  if(/https?:\/\//i.test(t))return false
  if(/^remind\s+me\b/i.test(t)&&/\b(today|tomorrow|at\s+\d|in\s+\d)\b/i.test(t)&&/\bto\s+\S+/i.test(t))return false
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

async function recentConversation(actor:AgentActor){
  const {data,error}=await supabaseAdmin.from('conversations')
    .select('role,content,created_at')
    .eq('telegram_id',actor.legacyTelegramId)
    .order('created_at',{ascending:false})
    .limit(5)
  if(error)throw error
  return (data||[]).slice().reverse().map((row:any)=>{
    const role=String(row.role||'user')==='assistant'?'assistant':'user'
    return `${role}: ${clean(row.content,240)}`
  }).join('\n').slice(0,1200)
}

async function recentTrip(actor:AgentActor){
  const cutoff=new Date(Date.now()-48*60*60*1000).toISOString()
  const {data,error}=await supabaseAdmin.from('travel_tickets')
    .select('id,booking_group,leg_index,from_city,to_city,depart_at,flight_no,airline,pnr,created_at')
    .eq('telegram_id',actor.legacyTelegramId)
    .gte('depart_at',cutoff)
    .order('created_at',{ascending:false})
    .limit(12)
  if(error)throw error
  if(!data?.length)return null
  const newest=data[0]
  const groupKey=String(newest.booking_group||newest.pnr||newest.id)
  const legs=data.filter((row:any)=>String(row.booking_group||row.pnr||row.id)===groupKey)
    .sort((a:any,b:any)=>Date.parse(String(a.depart_at||''))-Date.parse(String(b.depart_at||'')))
  const first=legs[0]||newest,last=legs[legs.length-1]||newest
  return {
    ref:'trip:'+groupKey,
    summary:[clean(first.from_city,80)+' to '+clean(last.to_city,80),first.flight_no?clean(first.flight_no,30):'',last.flight_no&&last.flight_no!==first.flight_no?clean(last.flight_no,30):''].filter(Boolean).join(', '),
    createdAt:String(newest.created_at||''),
  }
}

export type ShadowFocusCandidate={
  kind:'mission'|'trip'|'none'
  ref:string|null
  summary:string|null
  confidence:number
  ambiguous:boolean
}

function recentEnough(iso:unknown,minutes=15){
  const t=Date.parse(String(iso||''))
  return Number.isFinite(t) && (Date.now()-t)<=minutes*60_000
}

export function selectShadowFocus(params:{
  text:string
  contextual:boolean
  mission?:{id:string;title?:string|null;summary?:string|null;updated_at?:string|null}|null
  trip?:{ref:string;summary:string;createdAt?:string|null}|null
}):ShadowFocusCandidate{
  const text=String(params.text||'')
  const mission=params.mission||null
  const trip=params.trip||null
  const explicitTrip=/\b(flight|trip|ticket|pnr|boarding|airline|check[- ]?in)\b/i.test(text)
  const missionFresh=Boolean(mission&&recentEnough(mission.updated_at,15))
  const tripFresh=Boolean(trip&&recentEnough(trip.createdAt,15))

  if(explicitTrip&&trip){
    return {kind:'trip',ref:trip.ref,summary:trip.summary,confidence:0.97,ambiguous:false}
  }

  if(params.contextual&&missionFresh&&tripFresh){
    return {kind:'none',ref:null,summary:null,confidence:0.35,ambiguous:true}
  }

  if(params.contextual&&missionFresh&&mission){
    return {
      kind:'mission',
      ref:'run:'+String(mission.id),
      summary:clean([mission.title,mission.summary].filter(Boolean).join(' — '),500),
      confidence:0.91,
      ambiguous:false,
    }
  }

  if(params.contextual&&tripFresh&&trip){
    return {kind:'trip',ref:trip.ref,summary:trip.summary,confidence:0.91,ambiguous:false}
  }

  if(params.contextual&&mission){
    return {
      kind:'mission',
      ref:'run:'+String(mission.id),
      summary:clean([mission.title,mission.summary].filter(Boolean).join(' — '),500),
      confidence:0.76,
      ambiguous:false,
    }
  }

  if(params.contextual&&trip){
    return {kind:'trip',ref:trip.ref,summary:trip.summary,confidence:0.72,ambiguous:false}
  }

  if(!params.contextual&&mission){
    return {
      kind:'mission',
      ref:'run:'+String(mission.id),
      summary:clean([mission.title,mission.summary].filter(Boolean).join(' — '),500),
      confidence:0.68,
      ambiguous:false,
    }
  }

  return {kind:'none',ref:null,summary:null,confidence:params.contextual?0.25:0.9,ambiguous:params.contextual}
}

export async function observeShadowBrainTurn(params:{
  actor:AgentActor
  surface:'whatsapp'|'web'|'telegram'|'system'
  text:string
  eventId?:string|null
}):Promise<ShadowBrainObservation>{
  const classified=classifyAgentRequest(params.text)
  const contextual=shadowNeedsContext(params.text)
  let mission:any=null,trip:any=null,recentContext=''
  try{
    [mission,trip,recentContext]=await Promise.all([activeMission(params.actor),recentTrip(params.actor),recentConversation(params.actor)])
  }catch(error:any){
    console.error('SHADOW_BRAIN_CONTEXT_FAILED:',clean(error?.message||error,180))
  }

  const focus=selectShadowFocus({text:params.text,contextual,mission,trip})

  const observation:ShadowBrainObservation={
    actionFamily:shadowActionFamily(params.text),
    capability:classified.capability,
    needsContext:contextual,
    focusKind:focus.kind,
    focusRef:focus.ref,
    focusSummary:focus.summary,
    confidence:focus.confidence,
    ambiguous:focus.ambiguous,
  }

  const jev=await runJevShadow({
    text:params.text,
    currentCapability:observation.capability,
    currentActionFamily:observation.actionFamily,
    needsContext:observation.needsContext,
    // Keep passive mission focus for existing Shadow Brain telemetry, but do not
    // feed an unrelated stale mission to Jev unless this turn actually needs context.
    focusKind:observation.needsContext?observation.focusKind:'none',
    focusSummary:observation.needsContext?observation.focusSummary:null,
    recentContext,
    timeoutMs:900,
  }).catch((err:any)=>({
    ok:false,version:'jev-shadow-v1',model:'jev-latest',latencyMs:0,
    intent:{choice:null,confidence:null,probabilities:{}},
    actionMode:{choice:null,confidence:null,probabilities:{}},
    referentKind:{choice:null,confidence:null,probabilities:{}},
    usage:{inputTokens:null,outputTokens:null},
    error:clean(err?.message||err,120),
  }))

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
      jev_shadow:jev?{
        ok:Boolean(jev.ok),
        version:jev.version,
        model:jev.model,
        latency_ms:jev.latencyMs,
        intent:jev.intent,
        action_mode:jev.actionMode,
        referent_kind:jev.referentKind,
        usage:jev.usage||null,
        error:jev.error||null,
      }:null,
    },
  })
  if(error)console.error('SHADOW_BRAIN_ACTIVITY_FAILED:',error.message)

  return observation
}
