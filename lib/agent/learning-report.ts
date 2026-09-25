import { summarizeTaskMeasurements } from './model-usage'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { calibrationBuckets, summarizeEvidence, uniqueEvidence, finiteConfidence, type LearningEvidence } from './decision-evidence'

const safeLabel=(v:unknown)=>/^[a-z][a-z0-9_-]{0,99}$/.test(String(v))?String(v):'unknown'
const safeDate=(v:unknown)=>{const d=new Date(String(v||''));return Number.isFinite(d.getTime())?d.toISOString():null}
const nonnegative=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null

export function summarizeLearningActivity(rows:any[]){
  const decisions:LearningEvidence[]=rows.filter(r=>r.event_type==='decision_learning'&&r.metadata_json?.schema==='same-brain-v2').map(r=>{
    const m=r.metadata_json
    return {handler:safeLabel(m.handler),domain:safeLabel(m.domain),outcome:safeLabel(m.outcome),verified:m.verified===true,
      confidence:m.confidence,first_route_correct:m.first_route_correct,
      decision_id:m.decision_id?`${r.telegram_id}:${m.decision_id}`:null}
  })
  const observed=rows.filter(r=>r.event_type==='shadow_brain_observation')
  const jev=observed.map(r=>r.metadata_json?.jev_shadow).filter(j=>j?.attempted===true)
  const patterns=new Map<string,LearningEvidence[]>()
  for(const r of decisions){const key=r.domain+':'+r.handler;patterns.set(key,[...(patterns.get(key)||[]),r])}
  const sumMeasured=(key:string)=>{
    const vals=jev.map(j=>nonnegative(j.usage?.[key])).filter(v=>v!==null) as number[]
    return {measuredCalls:vals.length,total:vals.length?vals.reduce((a,b)=>a+b,0):null}
  }
  const latency=jev.map(j=>nonnegative(j.latency_ms)).filter(v=>v!==null) as number[]
  return {
    summary:summarizeEvidence(decisions),
    learningEvents:decisions.length,
    positiveEvidence:uniqueEvidence(decisions).filter(r=>r.outcome==='success'||(r.outcome==='verified_success'&&r.verified)).length,
    replacementEvidence:uniqueEvidence(decisions).filter(r=>r.outcome==='replacement').length,
    legacyUnidentifiedEvents:decisions.filter(r=>!r.decision_id).length,
    confidenceBuckets:calibrationBuckets(decisions),
    patterns:[...patterns.values()].map(events=>({domain:events[0].domain,handler:events[0].handler,...summarizeEvidence(events)})),
    routeDecisions:observed.filter(r=>typeof r.metadata_json?.learned_routing?.useLearned==='boolean').slice(0,50).map(r=>{
      const g=r.metadata_json.learned_routing
      return {at:safeDate(r.created_at),handler:g.handler?safeLabel(g.handler):null,guardedLive:g.useLearned===true,confidence:finiteConfidence(g.confidence),reason:['no_learned_preference','invalid_confidence','safety_kernel','handler_not_approved_for_live_learning','typed_context_conflict','typed_context_wins','negative_evidence','below_live_threshold','high_confidence_non_consequential'].includes(g.reason)?g.reason:'unknown'}
    }),
    routing:{observedTurns:observed.length,allowedHints:observed.filter(r=>r.metadata_json?.learned_routing?.useLearned===true).length,
      shadowOnlyHints:observed.filter(r=>r.metadata_json?.learned_routing?.useLearned===false).length,
      authority:'first_refusal_only'},
    jev:{calls:jev.length,deterministicSkips:observed.filter(r=>r.metadata_json?.jev_skip_reason==='deterministic_read').length,failedCalls:jev.filter(j=>j.ok===false).length,inputTokens:sumMeasured('inputTokens'),outputTokens:sumMeasured('outputTokens'),
      meanLatencyMs:latency.length?latency.reduce((a,b)=>a+b,0)/latency.length:null},
    // These need linked task lifecycle/cost data. Null is deliberate: per-turn
    // observations cannot prove per-completed-task cost or first-route accuracy.
    taskMetrics:{jevCallsPerCompletedTask:null,llmCallsPerCompletedTask:null,inputTokensPerCompletedTask:null,
      outputTokensPerCompletedTask:null,estimatedModelCostPerCompletedTask:null,latencyPerCompletedTask:null,
      reason:'whole_task_model_coverage_incomplete'},
    recentEvents:rows.filter(r=>r.event_type==='decision_learning').slice(0,25).map(r=>({at:safeDate(r.created_at),
      domain:safeLabel(r.metadata_json?.domain),handler:safeLabel(r.metadata_json?.handler),outcome:safeLabel(r.metadata_json?.outcome),
      verified:r.metadata_json?.outcome==='verified_success'&&r.metadata_json?.verified===true})),
  }
}

// All queries, including histories reached through run/event IDs, inherit tenant scope.
async function readLearningReport(params:{hours:number;limit:number},telegramId?:string){
  const scoped=(table:string,columns:string)=>{
    const query=supabaseAdmin.from(table).select(columns)
    return telegramId===undefined?query:query.eq('telegram_id',telegramId)
  }
  const {data,error}=await scoped('agent_activity','event_type,created_at,telegram_id,run_id,metadata_json')
    .in('event_type',['decision_learning','shadow_brain_observation','shadow_router_outcome','model_usage'])
    .gte('created_at',new Date(Date.now()-params.hours*3600000).toISOString())
    .order('created_at',{ascending:false}).limit(params.limit)
  if(error)throw new Error('learning_report_read_failed')
  const taskLimit=Math.min(params.limit,200)
  const {data:runs,error:runError}=await scoped('agent_runs','id,telegram_id,status,started_at,completed_at').eq('status','completed').gte('completed_at',new Date(Date.now()-params.hours*3600000).toISOString()).order('completed_at',{ascending:false}).limit(taskLimit)
  if(runError)throw new Error('task_metrics_read_failed')
  // Completed tasks may have started before this report window. Read their full
  // linked histories instead of dropping earlier planning/approval usage.
  const taskActivity:any[]=[]
  let historyTruncated=false
  const readPages=async(query:()=>any)=>{
    for(let offset=0;offset<20000;offset+=500){
      const result=await query().order('created_at',{ascending:false}).range(offset,offset+499)
      if(result.error)throw new Error('task_history_read_failed')
      taskActivity.push(...(result.data||[]))
      if((result.data||[]).length<500)return
    }
    historyTruncated=true
  }
  const ids=(runs||[]).map(r=>r.id)
  for(let i=0;i<ids.length;i+=50)await readPages(()=>scoped('agent_activity','event_type,created_at,telegram_id,run_id,metadata_json').in('run_id',ids.slice(i,i+50)).in('event_type',['model_usage','shadow_router_outcome']))
  const eventIds=[...new Set(taskActivity.filter(r=>r.event_type==='shadow_router_outcome').map(r=>r.metadata_json?.event_id).filter(Boolean))]
  for(let i=0;i<eventIds.length;i+=50)await readPages(()=>scoped('agent_activity','event_type,created_at,telegram_id,run_id,metadata_json').eq('event_type','shadow_brain_observation').in('metadata_json->>event_id',eventIds.slice(i,i+50)))
  return {taskMeasurements:historyTruncated?null:summarizeTaskMeasurements(runs||[],taskActivity),taskHistoryTruncated:historyTruncated,
    taskSampleLimit:taskLimit,taskSampleTruncated:(runs||[]).length===taskLimit,windowHours:params.hours,sampleLimit:params.limit,truncated:(data||[]).length===params.limit,
    ...summarizeLearningActivity(data||[]),
    modelUsage:summarizeModelUsage(data||[]),
    dailyEvidence:summarizeDailyEvidence(data||[]),
    generatedAt:new Date().toISOString()}
}



// Existing administrator-only endpoint retains its explicitly global reader.
export async function getLearningReport(params:{hours:number;limit:number}){
  return readLearningReport(params)
}
export async function getUserLearningReport(telegramId:string|number,params:{hours:number;limit:number}){
  const id=String(telegramId??'').trim()
  if(!/^-?\d+$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)===0)throw new Error('brain_identity_required')
  const hours=Number.isFinite(params.hours)?Math.max(1,Math.min(720,params.hours)):168
  const limit=Number.isFinite(params.limit)?Math.max(1,Math.min(1000,Math.trunc(params.limit))):1000
  return readLearningReport({hours,limit},id)
}

export function summarizeModelUsage(rows:any[]){
  const groups=new Map<string,any[]>()
  for(const row of rows){
    const m=row.metadata_json
    if(row.event_type!=='model_usage'||m?.schema!=='model-usage-v1')continue
    const model=/^(?:claude-|gpt-|o[134](?:-|$))[a-z0-9.:-]*$/i.test(String(m.model))&&String(m.model).length<=80?String(m.model):'unknown'
    const provider=['openai','anthropic'].includes(m.provider)?m.provider:'unknown'
    const key=provider+'/'+model
    groups.set(key,[...(groups.get(key)||[]),m])
  }
  return [...groups].map(([key,events])=>{
    const sum=(field:string)=>{const values=events.map(e=>nonnegative(e[field])).filter(v=>v!==null) as number[];return {measuredCalls:values.length,total:values.length?values.reduce((a,b)=>a+b,0):null}}
    return {provider:key.split('/')[0],model:key.split('/')[1],calls:events.length,failedCalls:events.filter(e=>e.ok===false).length,inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),estimatedCostUsd:sum('estimatedCostUsd')}
  })
}
export function summarizeDailyEvidence(rows:any[]){
  const dates=[...new Set(rows.filter(r=>r.event_type==='decision_learning').map(r=>safeDate(r.created_at)?.slice(0,10)).filter(Boolean))] as string[]
  return dates.sort().map(day=>({day,...summarizeLearningActivity(rows.filter(r=>safeDate(r.created_at)?.startsWith(day))).summary}))
}
export type UserLearningReport=Awaited<ReturnType<typeof getUserLearningReport>>
