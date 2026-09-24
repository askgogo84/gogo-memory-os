import { summarizeTaskMeasurements } from './model-usage'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { calibrationBuckets, summarizeEvidence, type LearningEvidence } from './decision-evidence'

const safeLabel=(v:unknown)=>/^[a-z][a-z0-9_-]{0,99}$/.test(String(v))?String(v):'unknown'
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
    confidenceBuckets:calibrationBuckets(decisions),
    patterns:[...patterns.values()].map(events=>({domain:events[0].domain,handler:events[0].handler,...summarizeEvidence(events)})),
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
    recentEvents:rows.filter(r=>r.event_type==='decision_learning').slice(0,25).map(r=>({at:r.created_at,
      domain:safeLabel(r.metadata_json?.domain),handler:safeLabel(r.metadata_json?.handler),outcome:safeLabel(r.metadata_json?.outcome),
      verified:r.metadata_json?.outcome==='verified_success'&&r.metadata_json?.verified===true})),
  }
}

// Called only by the existing administrator-authenticated report endpoint.
export async function getLearningReport(params:{hours:number;limit:number}){
  const {data,error}=await supabaseAdmin.from('agent_activity')
    .select('event_type,created_at,telegram_id,run_id,metadata_json')
    .in('event_type',['decision_learning','shadow_brain_observation','shadow_router_outcome','model_usage'])
    .gte('created_at',new Date(Date.now()-params.hours*3600000).toISOString())
    .order('created_at',{ascending:false}).limit(params.limit)
  if(error)throw new Error('learning_report_read_failed')
  const taskLimit=Math.min(params.limit,200)
  const {data:runs,error:runError}=await supabaseAdmin.from('agent_runs').select('id,telegram_id,status,started_at,completed_at').eq('status','completed').gte('completed_at',new Date(Date.now()-params.hours*3600000).toISOString()).order('completed_at',{ascending:false}).limit(taskLimit)
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
  for(let i=0;i<ids.length;i+=50)await readPages(()=>supabaseAdmin.from('agent_activity')
    .select('event_type,created_at,telegram_id,run_id,metadata_json').in('run_id',ids.slice(i,i+50)).in('event_type',['model_usage','shadow_router_outcome']))
  const eventIds=[...new Set(taskActivity.filter(r=>r.event_type==='shadow_router_outcome').map(r=>r.metadata_json?.event_id).filter(Boolean))]
  for(let i=0;i<eventIds.length;i+=50)await readPages(()=>supabaseAdmin.from('agent_activity')
    .select('event_type,created_at,telegram_id,run_id,metadata_json').eq('event_type','shadow_brain_observation').in('metadata_json->>event_id',eventIds.slice(i,i+50)))
  return {taskMeasurements:historyTruncated?null:summarizeTaskMeasurements(runs||[],taskActivity),taskHistoryTruncated:historyTruncated,
    taskSampleLimit:taskLimit,taskSampleTruncated:(runs||[]).length===taskLimit,windowHours:params.hours,sampleLimit:params.limit,truncated:(data||[]).length===params.limit,
    ...summarizeLearningActivity(data||[])}
}
