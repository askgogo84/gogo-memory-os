import assert from 'node:assert/strict'
import { rankEvidence, summarizeEvidence, observedOutcome, finiteConfidence, calibrationBuckets } from '../lib/agent/decision-evidence'
import { summarizeLearningActivity } from '../lib/agent/learning-report'
import { recordDecisionLearning, recordDecisionCorrection } from '../lib/agent/decision-learning'
import { supabaseAdmin } from '../lib/supabase-admin'

const wins=Array.from({length:30},(_,i)=>({handler:'calendar-named-read',domain:'calendar',outcome:'verified_success',verified:true,decision_id:String(i)}))
assert.equal(rankEvidence(wins.slice(0,3)).confidence,0,'sparse evidence stays shadow-only')
assert.ok(rankEvidence(wins).confidence>=.82,'adequate verified evidence can graduate')
assert.equal(rankEvidence(wins.map(r=>({...r,outcome:'success',verified:false}))).confidence,0,'assistant copy is not provider verification')
assert.equal(rankEvidence(wins.map(r=>({...r,verified:false}))).confidence,0,'label alone is not verification')
assert.equal(rankEvidence(wins.map(r=>({...r,decision_id:'same'}))).confidence,0,'replays cannot manufacture evidence')
assert.equal(rankEvidence([...wins,{...wins[0],handler:'reminder-create'}]).confidence,0,'conflicting successful routes stay shadow-only')
const corrected=[{...wins[0],outcome:'corrected',verified:false},...wins]
assert.ok(rankEvidence(corrected).avoidHandlers.includes('calendar-named-read'))
assert.equal(summarizeEvidence(corrected).verifiedCompletions,29,'later correction replaces prior success')
assert.equal(summarizeEvidence(wins).firstRouteAccuracy,null,'completion is not measured first-route accuracy')
assert.equal(summarizeEvidence([]).verifiedCompletionRate,null)
assert.equal(observedOutcome(undefined),'unknown')
assert.equal(observedOutcome('outcome_unknown'),'unknown')
assert.equal(observedOutcome('waiting_approval'),'blocked')
assert.equal(observedOutcome('completed'),'success')
for(const c of [null,undefined,NaN,Infinity,'0.9'])assert.equal(finiteConfidence(c),null)
assert.equal(calibrationBuckets([{...wins[0],confidence:null}]).reduce((s,b)=>s+b.decisions,0),0)

const rows=wins.map(m=>({event_type:'decision_learning',telegram_id:'private-user',created_at:'2026-09-24T00:00:00Z',metadata_json:{...m,schema:'same-brain-v2',user_text:'private secret text',object_ref:'private-provider-id'}}))
const report=summarizeLearningActivity(rows)
assert.equal(report.summary.verifiedCompletions,30)
assert.equal(report.taskMetrics.estimatedModelCostPerCompletedTask,null)
assert.doesNotMatch(JSON.stringify(report),/private-user|private secret text|private-provider-id/)
assert.equal(summarizeLearningActivity([...rows,{...rows[0],telegram_id:'other-user'}]).summary.decisions,31,'tenant-local IDs never collapse across users')

async function main(){
 const original=supabaseAdmin.from
 const inserts:any[]=[]
 ;(supabaseAdmin as any).from=()=>({insert:async(row:any)=>{inserts.push(row);return {error:null}}})
 try {
  const actor={legacyTelegramId:123} as any
  await recordDecisionLearning({actor,text:'my password is P@ssw0rd!',domain:'other',handler:'memory',outcome:'verified_success',verified:false,confidence:null})
  assert.equal(inserts[0].metadata_json.outcome,'unknown')
  assert.equal(inserts[0].metadata_json.confidence,null)
  assert.doesNotMatch(JSON.stringify(inserts),/P@ssw0rd/)
  await recordDecisionCorrection({actor,text:'When is the meeting?',domain:'calendar',wrongHandler:'reminder-create',correctHandler:'calendar-named-read'})
  assert.equal(inserts[1].metadata_json.outcome,'corrected')
  assert.equal(inserts[2].metadata_json.outcome,'replacement','replacement selection is not completion')
 } finally {supabaseAdmin.from=original}
 console.log('Decision evidence: sparse/conflicting/replayed evidence, corrections, confidence, truth and report privacy passed')
}
main().catch(error=>{console.error(error);process.exitCode=1})
