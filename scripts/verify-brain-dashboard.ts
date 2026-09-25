import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getUserLearningReport, summarizeLearningActivity, summarizeModelUsage } from '../lib/agent/learning-report'
import { BrainReport } from '../components/dashboard/brain-report'
import { supabaseAdmin } from '../lib/supabase-admin'

const at=new Date().toISOString()
const decision=(outcome:string,id:string,extra:any={})=>({telegram_id:'-123',event_type:'decision_learning',created_at:at,metadata_json:{schema:'same-brain-v2',handler:'gmail-context',domain:'email',decision_id:id,outcome,verified:outcome==='verified_success',user_text:'PRIVATE_EMAIL_BODY',object_ref:'PRIVATE_PROVIDER_ID',...extra}})
const rows=[decision('corrected','one',{first_route_correct:false}),decision('verified_success','one'),decision('replacement','one',{handler:'calendar-named-read'}),decision('clarified','two'),decision('unknown','three'),decision('verified_success','four')]
const s=summarizeLearningActivity(rows)
assert.equal(s.summary.decisions,4);assert.equal(s.summary.verifiedCompletions,1)
assert.equal(s.summary.correctionRate,.25);assert.equal(s.summary.clarificationRate,.25)
assert.equal(s.summary.unknownRate,.25);assert.equal(s.summary.firstRouteAccuracy,0)
assert.equal(s.replacementEvidence,1);assert.equal(s.positiveEvidence,1)
assert.equal(summarizeLearningActivity([]).summary.firstRouteAccuracy,null)
const classified=summarizeLearningActivity([
 decision('success','provider'),decision('verified_success','provider',{verification_source:'gmail'}),
 decision('verified_success','canonical',{verification_source:'canonical_state'}),
 decision('verified_success','specialist',{verification_source:'specialist_verified'}),
 decision('verified_success','legacy'),decision('verified_success','private',{verification_source:'PRIVATE_SOURCE'}),
 decision('corrected','corrected'),decision('verified_success','corrected',{verification_source:'delivery_receipt'}),
 decision('success','accepted',{verification_source:'delivery_receipt'}),
])
assert.deepEqual(classified.verificationEvidence,{provider:1,canonical:1,specialist:1,unattributed:2})
assert.equal(Object.values(classified.verificationEvidence).reduce((a,b)=>a+b,0),classified.summary.verifiedCompletions)
assert.deepEqual(s.verificationEvidence,{provider:0,canonical:0,specialist:0,unattributed:1})
assert.doesNotMatch(JSON.stringify(classified),/PRIVATE_SOURCE/)
const usage={event_type:'model_usage',telegram_id:'-123',run_id:'run-1',created_at:at,metadata_json:{schema:'model-usage-v1',provider:'openai',model:'gpt-fixture',inputTokens:100,outputTokens:null,estimatedCostUsd:null,ok:true,secret:'PRIVATE_KEY'}}
assert.equal(summarizeModelUsage([usage])[0].inputTokens.total,100)
assert.equal(summarizeModelUsage([usage])[0].estimatedCostUsd.total,null)
assert.equal(summarizeModelUsage([usage])[0].outputTokens.total,null)

async function main(){
 const original=supabaseAdmin.from,queries:any[]=[];let fail=false,empty=false
 ;(supabaseAdmin as any).from=(table:string)=>{
  const filters:any[]=[];queries.push({table,filters})
  const q:any={then:(resolve:any)=>{
   assert.ok(filters.some(f=>f[0]==='eq'&&f[1]==='telegram_id'&&f[2]==='-123'),'every query must be scoped, including linked task histories')
   const data=empty?[]:table==='agent_runs'?[{id:'run-1',telegram_id:'-123',status:'completed',started_at:at,completed_at:at}]:filters.some(f=>f[0]==='in'&&f[1]==='run_id')?[usage,{telegram_id:'-123',run_id:'run-1',event_type:'shadow_router_outcome',metadata_json:{event_id:'event-1'}}]:filters.some(f=>f[0]==='in'&&f[1]==='metadata_json->>event_id')?[{telegram_id:'-123',event_type:'shadow_brain_observation',metadata_json:{event_id:'event-1',jev_attempted:false}}]:[...rows,usage]
   return Promise.resolve({data:fail?null:data,error:fail?{message:'PRIVATE_DB_ERROR'}:null}).then(resolve)
  }}
  for(const method of ['select','eq','in','gte','order','limit','range'])q[method]=(...args:any[])=>{filters.push([method,...args]);return q}
  return q
 }
 try{
  for(const id of ['',undefined,'other-user',0])await assert.rejects(()=>getUserLearningReport(id as any,{hours:168,limit:1000}),/brain_identity_required/)
  assert.equal(queries.length,0)
  const report=await getUserLearningReport('-123',{hours:168,limit:1000})
  assert.equal(queries.length,4,'activity, completed runs, linked histories and observations exercised')
  assert.equal(report.taskMeasurements?.measuredPlannerTasks,1)
  assert.equal(report.taskMeasurements?.jevCallsPerLinkedCompletedTask,0,'measured no-call is valid zero')
  assert.equal(report.taskMetrics.estimatedModelCostPerCompletedTask,null)
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_|run-1|event-1|-123/)
  const html=renderToStaticMarkup(createElement(BrainReport,{report}))
  for(const label of ['Learned routing patterns','Shadow-only','Jev usage','Model usage','Recent learning events','Unavailable'])assert.ok(html.includes(label),label)
  assert.doesNotMatch(html,/PRIVATE_/)
  assert.match(html,/Canonical application state/)
  assert.match(html,/Unattributed legacy evidence/)
  assert.doesNotMatch(html,/Provider-verified completion/)
  empty=true
  const noData=await getUserLearningReport('-123',{hours:Infinity,limit:Infinity})
  assert.equal(noData.windowHours,168);assert.equal(noData.summary.verifiedCompletionRate,null)
  assert.match(renderToStaticMarkup(createElement(BrainReport,{report:noData})),/No evidence recorded/)
  fail=true
  await assert.rejects(()=>getUserLearningReport('-123',{hours:168,limit:1000}),/learning_report_read_failed/)
 }finally{supabaseAdmin.from=original}
 const api=readFileSync('app/api/dashboard/brain/route.ts','utf8')
 assert.ok(api.indexOf('if(!session)')<api.indexOf('await getUserLearningReport('))
 assert.match(api,/getUserLearningReport\(session.telegramId/)
 assert.doesNotMatch(api,/searchParams.get\(['"](?:user|telegram)/)
 assert.match(api,/private, no-store/)
 console.log('Brain dashboard: tenant scope across every query, privacy, measured/null rates and cost, authenticated API wiring, populated/empty rendering and failures passed')
}
main().catch(e=>{console.error(e);process.exitCode=1})
