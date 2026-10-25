import { supabaseAdmin } from '@/lib/supabase-admin'
import { getLearningReport } from './learning-report'

type ActivityRow = {
  event_type:string
  created_at:string
  telegram_id:string
  metadata_json:any
}

export function evaluateShadowPromotion(input:{
  observations:number
  paired:number
  contextual:number
  contextualAmbiguous:number
  capabilityComparable:number
  capabilityMatches:number
  contextualHandledByLegacy:number
}){
  const pairingRate=input.observations?input.paired/input.observations:0
  const contextualAmbiguityRate=input.contextual?input.contextualAmbiguous/input.contextual:0
  const capabilityAgreementRate=input.capabilityComparable?input.capabilityMatches/input.capabilityComparable:null
  const failures:string[]=[]

  if(input.paired<50)failures.push('paired_events_below_50')
  if(pairingRate<0.95)failures.push('pairing_rate_below_95_percent')
  if(contextualAmbiguityRate>0.10)failures.push('contextual_ambiguity_rate_above_10_percent')
  if(capabilityAgreementRate!==null&&capabilityAgreementRate<0.90)failures.push('capability_agreement_below_90_percent')
  if(input.capabilityComparable===0)failures.push('no_comparable_capability_events')
  if(input.contextualHandledByLegacy>0)failures.push('contextual_legacy_cases_require_manual_review')

  return {
    eligibleForReadOnlyContextAuthority:failures.length===0,
    failures,
    thresholds:{
      minimumPairedEvents:50,
      minimumPairingRate:0.95,
      maximumContextualAmbiguityRate:0.10,
      minimumCapabilityAgreementRate:0.90,
      contextualLegacyCasesRequireManualReview:true,
    },
  }
}

export async function getShadowBrainReport(params:{hours?:number;limit?:number}={}){
  const hours=Math.max(1,Math.min(Number(params.hours||24),168))
  const limit=Math.max(20,Math.min(Number(params.limit||1000),5000))
  const since=new Date(Date.now()-hours*60*60*1000).toISOString()

  const {data,error}=await supabaseAdmin.from('agent_activity')
    .select('event_type,created_at,telegram_id,metadata_json')
    .in('event_type',['shadow_brain_observation','shadow_router_outcome'])
    .gte('created_at',since)
    .order('created_at',{ascending:true})
    .limit(limit)
  if(error)throw new Error(`shadow_report_read_failed:${error.message}`)

  const rows=(data||[]) as ActivityRow[]
  const byEvent=new Map<string,{observation?:ActivityRow;outcome?:ActivityRow}>()
  for(const row of rows){
    const id=String(row.metadata_json?.event_id||'').trim()
    if(!id)continue
    const item=byEvent.get(id)||{}
    if(row.event_type==='shadow_brain_observation')item.observation=row
    if(row.event_type==='shadow_router_outcome')item.outcome=row
    byEvent.set(id,item)
  }

  let observations=0,paired=0,contextual=0,ambiguous=0,contextualAmbiguous=0,capabilityComparable=0,capabilityMatches=0
  let contextualHandledByLegacy=0
  const handlers=new Map<string,number>()
  const actionFamilies=new Map<string,number>()
  const mismatches:Array<Record<string,unknown>>=[]

  for(const [eventId,item] of byEvent){
    if(!item.observation)continue
    observations++
    const om=item.observation.metadata_json||{}
    const predictedCapability=String(om.capability||'')
    const needsContext=om.needs_context===true
    const isAmbiguous=om.ambiguous===true
    if(needsContext)contextual++
    if(isAmbiguous){ambiguous++;if(needsContext)contextualAmbiguous++}
    const af=String(om.action_family||'other')
    actionFamilies.set(af,(actionFamilies.get(af)||0)+1)

    if(!item.outcome)continue
    paired++
    const rm=item.outcome.metadata_json||{}
    const handler=String(rm.actual_handler||'unknown')
    handlers.set(handler,(handlers.get(handler)||0)+1)
    const actualCapability=String(rm.actual_capability||'')
    if(actualCapability){
      capabilityComparable++
      if(actualCapability===predictedCapability)capabilityMatches++
    }
    if(needsContext && /feature-intent|legacy/i.test(handler))contextualHandledByLegacy++

    const capabilityMismatch=Boolean(actualCapability&&predictedCapability&&actualCapability!==predictedCapability)
    const contextRisk=needsContext&&(/feature-intent|legacy|process-message/i.test(handler))
    if(capabilityMismatch||contextRisk){
      mismatches.push({
        eventId,
        surface:om.surface||rm.surface||null,
        predictedActionFamily:af,
        predictedCapability:predictedCapability||null,
        focusKind:om.focus_kind||null,
        focusRef:om.focus_ref||null,
        confidence:Number(om.confidence||0),
        ambiguous:isAmbiguous,
        actualHandler:handler,
        actualCapability:actualCapability||null,
        status:rm.status||null,
        reason:capabilityMismatch?'capability_mismatch':'contextual_turn_on_generic_or_legacy_router',
      })
    }
  }

  const top=(map:Map<string,number>)=>Array.from(map.entries())
    .sort((a,b)=>b[1]-a[1])
    .map(([name,count])=>({name,count}))

  const rates={
    pairingRate:observations?paired/observations:0,
    contextualRate:observations?contextual/observations:0,
    ambiguityRate:observations?ambiguous/observations:0,
    contextualAmbiguityRate:contextual?contextualAmbiguous/contextual:0,
    capabilityAgreementRate:capabilityComparable?capabilityMatches/capabilityComparable:null,
    contextualLegacyRate:contextual?contextualHandledByLegacy/contextual:0,
  }
  const promotion=evaluateShadowPromotion({
    observations,paired,contextual,contextualAmbiguous,
    capabilityComparable,capabilityMatches,contextualHandledByLegacy,
  })

  return {
    windowHours:hours,
    generatedAt:new Date().toISOString(),
    sameBrainV2:await getLearningReport({hours,limit}),
    totals:{
      observations,
      paired,
      unpaired:Math.max(0,observations-paired),
      contextual,
      ambiguous,
      contextualAmbiguous,
      capabilityComparable,
      capabilityMatches,
      contextualHandledByLegacy,
    },
    rates,
    promotion,
    handlers:top(handlers),
    actionFamilies:top(actionFamilies),
    mismatches:mismatches.slice(-100).reverse(),
  }
}
