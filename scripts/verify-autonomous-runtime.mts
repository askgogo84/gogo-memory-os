import assert from 'node:assert/strict'
import fs from 'node:fs'
import { readyAutonomousSteps, AUTONOMOUS_RUNTIME_VERSION } from '../lib/agent/autonomous-runtime'
import { selectSpecialistRoute, SPECIALIST_AGENTS } from '../lib/agent/specialist-registry'

assert.equal(AUTONOMOUS_RUNTIME_VERSION, 'gogo-autonomous-v1')
assert.equal(selectSpecialistRoute('Plan my New York trip and compare flights').primary, 'travel')
assert.equal(selectSpecialistRoute('Find the best BookMyShow ticket').primary, 'ticketing')
assert.equal(selectSpecialistRoute('Compare this on Amazon and Flipkart').primary, 'shopping')
assert.equal(selectSpecialistRoute('Watch this delivery and tell me when it changes').primary, 'life_events')
assert.equal(SPECIALIST_AGENTS.payments.paymentBoundary, 'approval_then_handoff')
assert.equal(SPECIALIST_AGENTS.secure_browser.paymentBoundary, 'prepare_only')
assert.equal(SPECIALIST_AGENTS.research.externalMutationRequiresApproval, false)

const baseRuntime = (stepKey:string, dependsOn:string[]=[], lane='default', extra:Record<string,unknown>={}) => ({
  runtime:{stepKey,dependsOn,lane,maxAttempts:4,attempt:0,requiresApproval:false,verificationRequired:false,mutation:false,idempotencyKey:`id-${stepKey}`,leaseUntil:null,retryAt:null,approvalId:null,...extra},
})
const rows:any[]=[
  {id:'1',run_id:'r',ordinal:1,tool_name:'calendar.read',title:'Read calendar',status:'completed',output_json:baseRuntime('calendar')},
  {id:'2',run_id:'r',ordinal:2,tool_name:'travel.search',title:'Search flights',status:'queued',output_json:baseRuntime('flights',['calendar'],'research')},
  {id:'3',run_id:'r',ordinal:3,tool_name:'hotel.search',title:'Search hotels',status:'queued',output_json:baseRuntime('hotels',['calendar'],'research')},
  {id:'4',run_id:'r',ordinal:4,tool_name:'trip.compose',title:'Compose trip',status:'queued',output_json:baseRuntime('compose',['flights','hotels'],'compose')},
]
const ready=readyAutonomousSteps(rows,new Date('2026-09-14T00:00:00Z'))
assert.deepEqual(ready.map(x=>x.id),['2','3'],'independent dependency-ready work should be available for parallel execution')

const approvalRows:any[]=[
  {id:'1',run_id:'r',ordinal:1,tool_name:'research',title:'Research',status:'completed',output_json:baseRuntime('research')},
  {id:'2',run_id:'r',ordinal:2,tool_name:'calendar.write',title:'Write calendar',status:'queued',output_json:baseRuntime('write',['research'],'mutation',{approvalId:'approval-1'})},
]
assert.equal(readyAutonomousSteps(approvalRows).length,0,'approval-bound steps must not execute until released')

const retryRows:any[]=[
  {id:'1',run_id:'r',ordinal:1,tool_name:'research',title:'Research',status:'queued',output_json:baseRuntime('research',[],'research',{retryAt:'2099-01-01T00:00:00.000Z'})},
]
assert.equal(readyAutonomousSteps(retryRows,new Date('2026-09-14T00:00:00Z')).length,0,'backoff must prevent early retries')

const runningLaneRows:any[]=[
  {id:'1',run_id:'r',ordinal:1,tool_name:'research.a',title:'A',status:'running',output_json:baseRuntime('a',[],'browser')},
  {id:'2',run_id:'r',ordinal:2,tool_name:'research.b',title:'B',status:'queued',output_json:baseRuntime('b',[],'browser')},
  {id:'3',run_id:'r',ordinal:3,tool_name:'research.c',title:'C',status:'queued',output_json:baseRuntime('c',[],'api')},
]
assert.deepEqual(readyAutonomousSteps(runningLaneRows).map(x=>x.id),['3'],'one lane must not execute concurrently with itself while other lanes may proceed')

const runtimeSource=fs.readFileSync('lib/agent/autonomous-runtime.ts','utf8')
assert.match(runtimeSource,/createAutonomousRun/)
assert.match(runtimeSource,/executeAutonomousRun/)
assert.match(runtimeSource,/recoverStaleAutonomousSteps/)
assert.match(runtimeSource,/appendAutonomousReplan/)
assert.match(runtimeSource,/releaseApprovedAutonomousStep/)
assert.match(runtimeSource,/idempotencyKey/)
assert.match(runtimeSource,/verificationRequired/)
assert.match(runtimeSource,/autonomous_verification_failed/)
assert.match(runtimeSource,/RETRY_MINUTES/)
assert.match(runtimeSource,/maxParallel/)
assert.match(runtimeSource,/Promise\.all\(candidates/)
assert.match(runtimeSource,/autonomous_run_resumed/)
assert.match(runtimeSource,/autonomous_plan_revised/)

console.log('✅ Persistent autonomous runtime + specialist routing regression passed')
