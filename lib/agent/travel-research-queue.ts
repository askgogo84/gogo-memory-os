import {supabaseAdmin} from '@/lib/supabase-admin'
import {acquireBrainUserLease, releaseBrainUserLease} from './brain-runtime-guard'
import {applyFlightBriefReply, askFlightBrief, buildTravelResearchContext, executeTravelResearch, flightBriefSlots, flightDateIssue, flightLegs, flightSearchPreferences, flightSearchStartedText, isFlightBriefAnswer, isPublicTravelResearchRequest, isTravelResearchDetailsReply, mergeFlightBrief, parseFlightBriefText} from './travel-research'
import type {FlightBrief, FlightBriefSlot} from './travel-research'
import {hardenTravelResearchResult} from './travel-research-sanitize'
import type {AgentActor} from './actor'
import type {AgentSurface} from './orchestrator'

const normalizeReply=(value:unknown)=>String(value||'').replace(/\s+/g,' ').trim()

// Only the immediately preceding, recent, owner-bound question can carry a partly answered flight brief.
// A free-form model reply cannot acknowledge queued work, and an old question cannot capture a new topic.
async function loadPendingFlightBrief(params:{actor:AgentActor;text:string}):Promise<{brief:FlightBrief;awaiting:FlightBriefSlot[]}|null> {
  const {data,error}=await supabaseAdmin.from('conversations').select('role,content,created_at')
    .eq('telegram_id',Number(params.actor.legacyTelegramId)).order('created_at',{ascending:false}).limit(6)
  if(error)throw new Error('travel_clarification_read_failed')
  const rows=Array.isArray(data)?data:[]
  const previousReply=rows.find(row=>row.role==='assistant')
  if(!previousReply)return null
  const at=Date.parse(String(previousReply.created_at||'')), age=Date.now()-at
  if(!Number.isFinite(age)||age<0||age>30*60_000)return null
  if(rows.some(row=>row.role==='user'&&Date.parse(row.created_at)>at&&String(row.content)!==params.text))return null
  const {data:pending,error:pendingError}=await supabaseAdmin.from('agent_activity').select('metadata_json')
    .eq('telegram_id',String(params.actor.legacyTelegramId)).eq('event_type','travel_clarification')
    .order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(pendingError)throw new Error('travel_clarification_state_read_failed')
  const state=pending?.metadata_json, savedAt=Date.parse(String(state?.at||''))
  if(!Number.isFinite(savedAt)||savedAt>at||Date.now()-savedAt>30*60_000)return null
  if(!state?.brief||normalizeReply(state.reply)!==normalizeReply(previousReply.content))return null
  return {brief:state.brief as FlightBrief,awaiting:(Array.isArray(state.awaiting)?state.awaiting:[]) as FlightBriefSlot[]}
}

async function saveFlightBriefQuestion(owner:string,request:string,brief:FlightBrief,awaiting:FlightBriefSlot[],reply:string) {
  const {error}=await supabaseAdmin.from('agent_activity').insert({telegram_id:owner,event_type:'travel_clarification',
    message:'Flight research is waiting for details.',metadata_json:{request,reply,at:new Date().toISOString(),brief,awaiting}})
  if(error)throw new Error('travel_clarification_state_write_failed')
}

type Waiting={runId:undefined;status:'waiting_user';capability:'travel';risk:'low';handledBy:string;text:string}
const waiting=(text:string):Waiting=>({runId:undefined,status:'waiting_user',capability:'travel',risk:'low',handledBy:'travel-details',text})

// The brief is either missing something (ask once, remember it) or complete (search each direction).
async function advanceFlightBrief(params:{actor:AgentActor;surface:AgentSurface},owner:string,request:string,brief:FlightBrief) {
  const slots=flightBriefSlots(brief)
  if(slots.length){
    const reply=askFlightBrief(brief,slots)
    await saveFlightBriefQuestion(owner,request,brief,slots,reply)
    return waiting(reply)
  }
  const legs=flightLegs(brief)
  let firstRunId:string|undefined
  for(const leg of legs){
    const queued=await queueTravelRun(params,owner,leg.text)
    if(queued.kind==='busy')return {runId:firstRunId,status:'queued' as const,capability:'travel' as const,risk:'low' as const,
      handledBy:'travel-research-queued',text:'Your travel request is being saved. Check Activity shortly.'}
    firstRunId||=queued.id
  }
  return {runId:firstRunId,status:'queued' as const,capability:'travel' as const,risk:'low' as const,
    handledBy:'travel-research-queued',text:flightSearchStartedText(brief)}
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
  const now = new Date()
  if (!isPublicTravelResearchRequest(text)) {
    // A short reply may be the answer to the question Gogo just asked (route, date, trip, travellers, cabin).
    if(!isTravelResearchDetailsReply(text)&&!isFlightBriefAnswer(text))return null
    const pending=await loadPendingFlightBrief({actor:params.actor,text})
    if(!pending)return null
    if(flightDateIssue(text,buildTravelResearchContext(text,now,params.actor.timezone),now,params.actor.timezone)==='invalid')
      return waiting('That is not a valid travel date. Please send the route with a valid departure date.')
    const answer=applyFlightBriefReply(pending.brief,pending.awaiting,text,now,params.actor.timezone)
    if(!answer.understood)return null
    return await advanceFlightBrief(params,owner,text,answer.brief)
  }
  const probe = buildTravelResearchContext(text,now,params.actor.timezone)
  if (probe.kind === 'flight') {
    const dateIssue = flightDateIssue(text,{...probe,...flightSearchPreferences(text)},now,params.actor.timezone)
    if(dateIssue) return waiting(dateIssue==='invalid'?'That is not a valid travel date. Please send the route with a valid departure date.':'That departure date is in the past. Please send the route with a future departure date.')
    let brief=parseFlightBriefText(text,now,params.actor.timezone)
    if(!(brief.originLabel&&brief.destinationLabel&&brief.departDate)){
      const pending=await loadPendingFlightBrief({actor:params.actor,text})
      if(pending)brief=mergeFlightBrief(pending.brief,brief)
    }
    return await advanceFlightBrief(params,owner,text,brief)
  }
  const queued = await queueTravelRun(params,owner,text)
  if(queued.kind==='busy') return {runId:undefined,status:'queued' as const,capability:'travel' as const,risk:'low' as const,
    handledBy:'travel-research-queued',text:'Your travel request is being saved. Check Activity shortly.'}
  return {runId:queued.id,status:'queued' as const,capability:'travel' as const,risk:'low' as const,
    handledBy:'travel-research-queued',text:`I’m checking ${queued.context.routeLabel} · ${queued.context.whenLabel} in the background. I’ll send the result here when the check finishes. No booking or payment will be made.`}
}

// One saved, deduplicated background run for one complete search text.
async function queueTravelRun(params:{surface:AgentSurface;actor:AgentActor},owner:string,text:string):Promise<{kind:'busy'}|{kind:'ok';id:string;context:ReturnType<typeof buildTravelResearchContext>}> {
  const context = {...buildTravelResearchContext(text,new Date(),params.actor.timezone), ...flightSearchPreferences(text)}
  const key = `travel-create:${owner}`
  const lease = await acquireBrainUserLease(key, 30)
  if(!lease) return {kind:'busy'}
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
    return {kind:'ok',id:String(id),context}
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
