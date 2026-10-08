import {supabaseAdmin} from '@/lib/supabase-admin'
import {acquireBrainUserLease, releaseBrainUserLease} from './brain-runtime-guard'
import {buildTravelResearchContext, executeTravelResearch, flightDateIssue, flightSearchPreferences, isPublicTravelResearchRequest, isTravelResearchDetailsReply} from './travel-research'
import {hardenTravelResearchResult} from './travel-research-sanitize'
import type {AgentActor} from './actor'
import type {AgentSurface} from './orchestrator'

// Only the immediately preceding, recent, owner-bound clarification can supply
// missing flight fields. A free-form model reply cannot acknowledge queued work.
async function resumeFlightDetails(params:{actor:AgentActor;text:string}) {
  if(!isTravelResearchDetailsReply(params.text))return null
  const {data,error}=await supabaseAdmin.from('conversations').select('role,content,created_at')
    .eq('telegram_id',Number(params.actor.legacyTelegramId)).order('created_at',{ascending:false}).limit(6)
  if(error)throw new Error('travel_clarification_read_failed')
  const rows=Array.isArray(data)?data:[]
  const previousReply=rows.find(row=>row.role==='assistant')
  if(!/^Please send the (?:departure city|destination|travel date)(?:, (?:departure city|destination|travel date))* together so I can compare the right flights\.$/.test(String(previousReply?.content||'')))return null
  const at=Date.parse(String(previousReply?.created_at||'')), age=Date.now()-at
  if(!Number.isFinite(age)||age<0||age>30*60_000)return null
  if(rows.some(row=>row.role==='user'&&Date.parse(row.created_at)>at&&String(row.content)!==params.text))return null
  const {data:pending,error:pendingError}=await supabaseAdmin.from('agent_activity').select('metadata_json')
    .eq('telegram_id',String(params.actor.legacyTelegramId)).eq('event_type','travel_clarification')
    .order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(pendingError)throw new Error('travel_clarification_state_read_failed')
  const state=pending?.metadata_json, savedAt=Date.parse(String(state?.at||''))
  if(!Number.isFinite(savedAt)||savedAt>at||Date.now()-savedAt>30*60_000||state?.reply!==previousReply.content)return null
  const original=String(state?.request||'')
  if(!isPublicTravelResearchRequest(original))return null
  const before=buildTravelResearchContext(original,new Date(),params.actor.timezone)
  if(before.kind!=='flight'||(before.origin&&before.destination&&before.startDate))return null
  const next=buildTravelResearchContext(params.text,new Date(),params.actor.timezone)
  if(flightDateIssue(params.text,next,new Date(),params.actor.timezone))return `Compare flights. ${params.text}\nPrevious request: ${original}`
  const origin=next.origin||before.origin,destination=next.destination||before.destination,startDate=next.startDate||before.startDate
  const previousPreferences=flightSearchPreferences(original),nextPreferences=flightSearchPreferences(params.text)
  const adults=/\b(?:adults?|passengers?|people|persons?|travell?ers?)\b/i.test(params.text)?nextPreferences.adults:previousPreferences.adults
  const cabin=/\b(?:economy|business|first)\b/i.test(params.text)?nextPreferences.cabin:previousPreferences.cabin
  const nonStop=nextPreferences.nonStop||previousPreferences.nonStop
  return `Compare ${nonStop?'non-stop ':''}flights${origin?` from ${origin.code||origin.label}`:''}${destination?` to ${destination.code||destination.label}`:''}${startDate?` on ${startDate}`:''} for ${adults} adults in ${cabin.replace(/_/g,' ')}. Research only; do not book or pay.\nOriginal criteria: ${original}\nAdditional details: ${params.text}`
}

export async function enqueueTravelResearch(params: {actor: AgentActor; surface: AgentSurface; text: string}) {
  let text = params.text.trim()
  const owner = String(params.actor.legacyTelegramId)
  if (/^(?:continue|resume|carry on|keep going)\b/i.test(text)) {
    const {data, error} = await supabaseAdmin.from('agent_runs').select('metadata_json')
      .eq('telegram_id', owner).eq('type', 'travel_research').order('started_at', {ascending:false}).limit(1).maybeSingle()
    if(error) throw new Error('travel_continuation_read_failed')
    text = String(data?.metadata_json?.input_text || '')
  }
  if (!isPublicTravelResearchRequest(text)) {
    const resumed=await resumeFlightDetails({...params,text})
    if(!resumed)return null
    text=resumed
  }
  const context = {...buildTravelResearchContext(text,new Date(),params.actor.timezone), ...flightSearchPreferences(text)}
  if (context.kind === 'flight') {
    const dateIssue = flightDateIssue(text,context,new Date(),params.actor.timezone)
    if(dateIssue) return {runId:undefined,status:'waiting_user' as const,capability:'travel' as const,risk:'low' as const,
      handledBy:'travel-details',text:dateIssue==='invalid'?'That is not a valid travel date. Please send the route with a valid departure date.':'That departure date is in the past. Please send the route with a future departure date.'}
    const missing = [!context.origin && 'departure city', !context.destination && 'destination', !context.startDate && 'travel date'].filter(Boolean)
    if (missing.length) {
      const reply=`Please send the ${missing.join(', ')} together so I can compare the right flights.`
      const {error}=await supabaseAdmin.from('agent_activity').insert({telegram_id:owner,event_type:'travel_clarification',
        message:'Flight research is waiting for required details.',metadata_json:{request:text,reply,at:new Date().toISOString()}})
      if(error)throw new Error('travel_clarification_state_write_failed')
      return {runId:undefined,status:'waiting_user' as const,capability:'travel' as const,risk:'low' as const,handledBy:'travel-details',text:reply}
    }
    if (/\b(?:children|child|infants?|round[- ]trip|return(?:ing)?(?:\s+on|\s+flight|\s+date)?)\b/i.test(text)
      || !Number.isInteger(context.adults) || context.adults < 1 || context.adults > 9)
      return {runId: undefined, status:'waiting_user' as const, capability:'travel' as const, risk:'low' as const,
        handledBy:'travel-details', text:'This flight search supports one-way journeys for 1–9 adults. Return journeys and child/infant fares need provider verification; please give a one-way adult search or use the provider for those fares.'}
  }
  const key = `travel-create:${owner}`
  const lease = await acquireBrainUserLease(key, 30)
  if(!lease) return {runId:undefined,status:'queued' as const,capability:'travel' as const,risk:'low' as const,
    handledBy:'travel-research-queued',text:'Your travel request is being saved. Check Activity shortly.'}
  try {
    const {data:existing,error:readError} = await supabaseAdmin.from('agent_runs').select('id')
      .eq('telegram_id',owner).eq('type','travel_research').eq('metadata_json->>input_text',text)
      .in('status',['queued','running']).order('started_at',{ascending:false}).limit(1).maybeSingle()
    if(readError) throw new Error('travel_queue_read_failed')
    let id = existing?.id
    if(!id) {
      const now = new Date().toISOString()
      const {data,error} = await supabaseAdmin.from('agent_runs').insert({
        telegram_id:owner,type:'travel_research',capability:'travel',source:params.surface,status:'queued',
        title:`Travel task · ${context.routeLabel}`,summary:'Flight/provider research is queued; no fare or booking is verified yet.',
        progress:0,started_at:now,updated_at:now,metadata_json:{input_text:text,context,background_travel:true},
      }).select('id').single()
      if(error || !data?.id) throw new Error('travel_queue_create_failed')
      id = data.id
    }
    return {runId:String(id),status:'queued' as const,capability:'travel' as const,risk:'low' as const,
      handledBy:'travel-research-queued',text:`I’m checking ${context.routeLabel} · ${context.whenLabel} in the background. I’ll send the result here when the check finishes. No booking or payment will be made.`}
  } finally {await releaseBrainUserLease(key, lease.ownerToken)}
}

/** Called only after a worker has claimed this owned queued row. */
export async function runQueuedTravelResearch(actor: AgentActor, runId: string, deadline?: number) {
  const owner = String(actor.legacyTelegramId)
  const {data:run,error} = await supabaseAdmin.from('agent_runs').select('id,status,source,metadata_json')
    .eq('id',runId).eq('telegram_id',owner).eq('type','travel_research').eq('status','running').maybeSingle()
  if(error || !run?.metadata_json?.background_travel) throw new Error('travel_claim_unavailable')
  let resultText: string
  let status: 'completed' | 'failed' = 'completed'
  try {
    const result = await executeTravelResearch({actor, surface:run.source, text:run.metadata_json.input_text, existingRunId:runId,context:run.metadata_json.context,deadline})
    if(!result) throw new Error('travel_input_unavailable')
    const hardened = await hardenTravelResearchResult(result,run.metadata_json.input_text)
    resultText = hardened.text
  } catch(error) {
    console.error('TRAVEL_QUEUED_EXECUTION_FAILED:',error instanceof Error ? error.message : 'unknown')
    resultText = 'I could not finish the flight check safely. No fare, seat, booking or payment was confirmed. You can check the provider directly or ask me to try again.'
    status = 'failed'
  }
  const {error:saveError} = await supabaseAdmin.from('agent_runs').update({
    status,error:status === 'failed' ? 'travel_research_failed' : null,
    completed_at:new Date().toISOString(),updated_at:new Date().toISOString(),progress:100,
    summary:resultText.slice(0,1800),metadata_json:{...run.metadata_json,result_text:resultText},
  }).eq('id',runId).eq('telegram_id',owner).eq('status','running')
  if(saveError) throw new Error('travel_result_write_failed')
  return resultText
}
