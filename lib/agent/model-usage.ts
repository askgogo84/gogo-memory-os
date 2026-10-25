import { supabaseAdmin } from '@/lib/supabase-admin'
export type ModelUsage={model:string;provider:'anthropic'|'openai';ok:boolean;inputTokens:number|null;outputTokens:number|null;latencyMs:number;estimatedCostUsd:number|null}
export const measuredNumber=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null
// Rates are operator-supplied and versioned by the event. Never guess current prices.
export function estimatedCost(model:string,input:number|null,output:number|null,ratesText=process.env.MODEL_TOKEN_RATES_JSON){
  try{const r=JSON.parse(ratesText||'{}')[model];const i=measuredNumber(r?.inputUsdPerMillion),o=measuredNumber(r?.outputUsdPerMillion)
    return input!==null&&output!==null&&i!==null&&o!==null?(input*i+output*o)/1e6:null
  }catch{return null}
}
export async function measureModelCall<T>(params:{provider:ModelUsage['provider'];model:string;call:()=>Promise<T>;usage:(result:T)=>{input:unknown;output:unknown;cached?:unknown};onUsage?:(usage:ModelUsage)=>void}){
  const start=Date.now();let cacheUnsupported=false;let usage:ModelUsage={provider:params.provider,model:params.model,ok:false,inputTokens:null,outputTokens:null,latencyMs:0,estimatedCostUsd:null}
  try{const result=await params.call(),tokens=params.usage(result);cacheUnsupported=Number(tokens.cached||0)>0;usage={...usage,ok:true,inputTokens:measuredNumber(tokens.input),outputTokens:measuredNumber(tokens.output)};return result}
  finally{usage.latencyMs=Date.now()-start;usage.estimatedCostUsd=cacheUnsupported?null:estimatedCost(usage.model,usage.inputTokens,usage.outputTokens);params.onUsage?.(usage)}
}
export async function recordTaskModelUsage(telegramId:number,runId:string,events:ModelUsage[]){
  if(!events.length)return
  const {error}=await supabaseAdmin.from('agent_activity').insert(events.map(event=>({telegram_id:String(telegramId),run_id:runId,
    event_type:'model_usage',message:'Measured planner SDK invocation.',metadata_json:{schema:'model-usage-v1',component:'general-plan',...event}})))
  if(error)console.error('MODEL_USAGE_RECORD_FAILED')
}
export function summarizeTaskMeasurements(runs:any[],activities:any[]){
  const complete=runs.filter(r=>r.status==='completed'&&r.completed_at)
  const scoped=(row:any,run:any)=>String(row.telegram_id)===String(run.telegram_id)&&row.run_id===run.id
  const measured=complete.map(run=>({run,events:activities.filter(row=>row.event_type==='model_usage'&&scoped(row,run)).map(row=>row.metadata_json)})).filter(t=>t.events.length)
  const mean=(vals:number[])=>vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null
  const totals=(key:string)=>measured.map(t=>{const vals=t.events.map(e=>measuredNumber(e[key]));return vals.every(v=>v!==null)?(vals as number[]).reduce((a,b)=>a+b,0):null}).filter(v=>v!==null) as number[]
  const latency=complete.map(r=>Date.parse(r.completed_at)-Date.parse(r.started_at)).filter(v=>Number.isFinite(v)&&v>=0)
  const jevTasks=complete.map(run=>activities.filter(r=>r.event_type==='shadow_router_outcome'&&scoped(r,run)).map(r=>r.metadata_json?.event_id))
  const jevCounts=jevTasks.map((ids,i)=>{const linked=activities.filter(r=>String(r.telegram_id)===String(complete[i].telegram_id)&&r.event_type==='shadow_brain_observation'&&ids.includes(r.metadata_json?.event_id));return linked.length&&linked.every(r=>typeof (r.metadata_json?.jev_attempted??r.metadata_json?.jev_shadow?.attempted)==='boolean')?new Set(linked.filter(r=>r.metadata_json.jev_attempted??r.metadata_json.jev_shadow?.attempted).map(r=>r.metadata_json.event_id)).size:null})
  return {completedTasks:complete.length,measuredPlannerTasks:measured.length,coverage:'general-plan SDK invocations only; specialist model calls are not yet covered',
    plannerSdkCallsPerMeasuredCompletedTask:mean(measured.map(t=>t.events.length)),
    plannerInputTokensPerMeasuredCompletedTask:mean(totals('inputTokens')),inputTokenTasks:totals('inputTokens').length,
    plannerOutputTokensPerMeasuredCompletedTask:mean(totals('outputTokens')),outputTokenTasks:totals('outputTokens').length,
    plannerEstimatedCostUsdPerMeasuredCompletedTask:mean(totals('estimatedCostUsd')),pricedTasks:totals('estimatedCostUsd').length,
    meanCompletedTaskElapsedMs:mean(latency),elapsedTimeTasks:latency.length,
    jevCallsPerLinkedCompletedTask:mean(jevCounts.filter(v=>v!==null) as number[]),linkedJevTasks:jevCounts.filter(v=>v!==null).length,
    latencyIncludesApprovalWait:true,modelCostRateSource:'MODEL_TOKEN_RATES_JSON; absent or incomplete rates yield null'}
}
