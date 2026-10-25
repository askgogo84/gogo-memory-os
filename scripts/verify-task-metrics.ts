import assert from 'node:assert/strict'
import { supabaseAdmin } from '../lib/supabase-admin'
import { getLearningReport } from '../lib/agent/learning-report'
import { verifiedReadEvidence } from '../lib/agent/read-evidence'
import { estimatedCost, measureModelCall, summarizeTaskMeasurements } from '../lib/agent/model-usage'
async function main(){
 assert.equal(verifiedReadEvidence('watcher-status','completed',{verified:true,kind:'read',source:'canonical_watchers',objectKind:'watcher_collection'}),true)
 assert.equal(verifiedReadEvidence('gmail-send','completed',{verified:true,kind:'read',source:'gmail',objectKind:'gmail_send'}),false)
 assert.equal(verifiedReadEvidence('gmail-verification','paused',{verified:true,kind:'read',source:'gmail',objectKind:'gmail_send'}),false)
 assert.equal(estimatedCost('test',100,20),null)
 assert.equal(estimatedCost('test',100,20,'{"test":{"inputUsdPerMillion":1,"outputUsdPerMillion":5}}'),.0002)
 const events:any[]=[]
 await measureModelCall({provider:'anthropic',model:'test',call:async()=>({input:100,output:20}),usage:r=>r,onUsage:e=>events.push(e)})
 await assert.rejects(measureModelCall({provider:'openai',model:'test',call:async()=>{throw new Error('provider failure')},usage:()=>({input:0,output:0}),onUsage:e=>events.push(e)}))
 assert.equal(events.length,2);assert.equal(events[1].inputTokens,null);assert.equal(events[1].ok,false)
 const runs=[{id:'task',telegram_id:'user',status:'completed',started_at:'2026-09-24T00:00:00Z',completed_at:'2026-09-24T00:00:02Z'}]
 const activities=events.map(metadata_json=>({event_type:'model_usage',telegram_id:'user',run_id:'task',metadata_json}))
 const report=summarizeTaskMeasurements(runs,activities)
 assert.equal(report.plannerSdkCallsPerMeasuredCompletedTask,2)
 assert.equal(report.plannerInputTokensPerMeasuredCompletedTask,null,'failed/missing usage must not count as zero')
 assert.equal(report.plannerEstimatedCostUsdPerMeasuredCompletedTask,null)
 assert.equal(report.meanCompletedTaskElapsedMs,2000)
 assert.equal(report.jevCallsPerLinkedCompletedTask,null,'missing observations are not zero calls')
 assert.equal(summarizeTaskMeasurements(runs,activities.map(a=>({...a,telegram_id:'another-user'}))).measuredPlannerTasks,0)
 assert.doesNotMatch(JSON.stringify(report),/"user"|"task"/)
 const oldFrom=supabaseAdmin.from
 let loadedHistoricalUsage=false
 ;(supabaseAdmin as any).from=(table:string)=>{
  const filters:any[]=[]
  const result=()=>{
   if(table==='agent_runs')return {data:runs,error:null}
   if(filters.some(f=>f[0]==='in'&&f[1]==='run_id')){
    loadedHistoricalUsage=true
    assert.ok(!filters.some(f=>f[0]==='gte'),'task history must not be restricted to activity window')
    return {data:[{...activities[0],created_at:'2026-09-01T00:00:00Z'}],error:null}
   }
   return {data:[],error:null}
  }
  const chain:any={then:(ok:any)=>Promise.resolve(result()).then(ok)}
  for(const key of ['select','in','eq','gte','order','limit','range'])chain[key]=(...args:any[])=>{filters.push([key,...args]);return chain}
  return chain
 }
 try{
  const historical=await getLearningReport({hours:1,limit:20})
  assert.equal(loadedHistoricalUsage,true)
  assert.equal(historical.taskMeasurements?.plannerInputTokensPerMeasuredCompletedTask,100)
 }finally{supabaseAdmin.from=oldFrom}
 console.log('Task metrics: SDK fallback accounting, missing usage, unpriced costs, tenant linkage and privacy passed')
}
main().catch(e=>{console.error(e);process.exitCode=1})
