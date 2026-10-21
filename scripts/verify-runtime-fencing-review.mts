// Actual runtime exports with snapshot-faithful inert storage. No provider I/O.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'
const actor={userId:'fixture-owner',legacyTelegramId:123,whatsappId:'inert',name:'Fixture'}
function harness(){
 const run:any={id:'run',telegram_id:'123',status:'running',title:'Fixture',metadata_json:{objective:'Fixture'}}
 const step:any={id:'step',run_id:'run',telegram_id:'123',ordinal:1,tool_name:'fixture',title:'Fixture',status:'queued',output_json:{runtime:{stepKey:'first',dependsOn:[],lane:'default',attempt:0,maxAttempts:4,mutation:true,verificationRequired:true,idempotencyKey:'stable-key'}}}
 const tables:any={agent_runs:[run],agent_steps:[step],agent_activity:[],agent_approvals:[]}
 let beforeWrite:((table:string,value:any)=>void)|undefined
 const db={from(table:string){
  let op='read',value:any,single=false; const filters:Array<(row:any)=>boolean>=[]
  const field=(row:any,key:string)=>key.split(/->>?/).reduce((v:any,k:string)=>v?.[k],row)
  const result=()=>{
   if(op==='update'||op==='insert'){const hook=beforeWrite;beforeWrite=undefined;hook?.(table,value)}
   let rows=tables[table].filter((row:any)=>filters.every(f=>f(row)))
   if(op==='update')rows.forEach((row:any)=>Object.assign(row,structuredClone(value)))
   if(op==='insert'){const values=Array.isArray(value)?value:[value];tables[table].push(...structuredClone(values));rows=values}
   const data=structuredClone(single?(rows[0]||null):rows)
   return{data,error:null}
  }
  const q:any={select:()=>q,order:()=>q,update:(v:any)=>{op='update';value=v;return q},insert:(v:any)=>{op='insert';value=v;return q},
   eq:(k:string,v:any)=>{filters.push(r=>String(field(r,k))===String(v));return q},in:(k:string,v:any[])=>{filters.push(r=>v.includes(field(r,k)));return q},
   is:(k:string,v:any)=>{filters.push(r=>v===null?field(r,k)==null:field(r,k)===v);return q},lte:(k:string,v:any)=>{filters.push(r=>field(r,k)<=v);return q},
   maybeSingle:async()=>{single=true;return result()},then:(a:any,b:any)=>Promise.resolve().then(result).then(a,b)}
  return q
 }}
 const exports:any={}
 const source=ts.transpileModule(readFileSync('lib/agent/autonomous-runtime.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 runInNewContext(source,{exports,Date,Promise,console,require:(id:string)=>{
  if(id==='node:crypto')return{createHash}
  if(id==='@/lib/supabase-admin')return{supabaseAdmin:db}
  if(id==='./specialist-registry')return{selectSpecialistRoute:()=>({primary:'research',supporting:[]})}
  if(id==='./run-notify')return{notifyRunOutcome:async()=>{}}
  throw Error('Unexpected dependency '+id)
 }})
 return{run,step,tables,runtime:exports,beforeWrite:(fn:(table:string,value:any)=>void)=>{beforeWrite=fn},execute:(handler:any)=>exports.executeAutonomousRun({actor,runId:'run',registry:{fixture:handler}})}
}
let failures=0
async function check(name:string,fn:()=>Promise<void>){try{await fn();console.log('PASS '+name)}catch(error:any){failures++;console.error('FAIL '+name+': '+error.message)}}
for(const status of ['completed','failed','outcome_unknown'])await check('terminal '+status+' cannot be reopened by replanning',async()=>{
 const h=harness();h.run.status=status
 await assert.rejects(h.runtime.appendAutonomousReplan({actor,runId:'run',reason:'Fixture',steps:[{key:'next',title:'Fixture next',toolName:'fixture',mutation:true}]}),/terminal|inactive|superseded/)
 assert.equal(h.run.status,status);assert.equal(h.tables.agent_steps.length,1)
})
await check('cancellation after start activity prevents tool dispatch',async()=>{
 const h=harness();let calls=0
 h.beforeWrite((table,value)=>{if(table==='agent_steps'&&value.status==='running')h.beforeWrite((t,v)=>{if(t==='agent_activity'&&v.event_type==='autonomous_step_started'){h.run.status='failed';h.run.error='user_cancelled'}})})
 await h.execute(async()=>{calls++;return{status:'completed',verified:true}})
 assert.equal(calls,0);assert.equal(h.run.status,'failed');assert.equal(h.run.error,'user_cancelled')
})
await check('stale queued snapshot cannot reuse a newer attempt or bypass backoff',async()=>{
 const h=harness();let calls=0
 h.beforeWrite((table,value)=>{assert.equal(table,'agent_steps');assert.equal(value.status,'running');h.step.output_json.runtime.attempt=1;h.step.output_json.runtime.retryAt='2099-01-01T00:00:00Z'})
 await h.execute(async()=>{calls++;return{status:'completed',verified:true}})
 assert.equal(calls,0);assert.equal(h.step.output_json.runtime.attempt,1);assert.equal(h.step.output_json.runtime.retryAt,'2099-01-01T00:00:00Z')
})
await check('cancelled run cannot release an interrupted approval',async()=>{
 const h=harness();h.run.status='failed';h.run.error='user_cancelled';h.step.output_json.runtime.approvalId='a'
 h.tables.agent_approvals.push({id:'a',run_id:'run',telegram_id:'123',status:'approved'})
 await assert.rejects(h.runtime.releaseApprovedAutonomousStep({actor,runId:'run',stepKey:'first'}),/terminal|inactive|superseded/)
 assert.equal(h.step.output_json.runtime.approvalId,'a');assert.equal(h.run.status,'failed')
})
await check('stale approval release cannot clear a newly replaced approval',async()=>{
 const h=harness();h.step.output_json.runtime.approvalId='a';h.tables.agent_approvals.push({id:'a',run_id:'run',telegram_id:'123',status:'approved'})
 h.beforeWrite((table)=>{assert.equal(table,'agent_steps');h.step.output_json.runtime.approvalId='b'})
 await assert.rejects(h.runtime.releaseApprovedAutonomousStep({actor,runId:'run',stepKey:'first'}),/superseded|changed/)
 assert.equal(h.step.output_json.runtime.approvalId,'b')
})
await check('normal active execution and bounded active replanning remain usable',async()=>{
 const h=harness();await h.runtime.appendAutonomousReplan({actor,runId:'run',reason:'Fixture',steps:[{key:'next',title:'Fixture next',toolName:'fixture',dependsOn:['first'],mutation:false}]})
 assert.equal(h.tables.agent_steps.length,2);let calls=0
 await h.execute(async()=>{calls++;return{status:'completed',verified:true}});assert.equal(calls,1)
})
await check('requiresApproval suspends before a handler and resumes only its owned run approval',async()=>{
 const h=harness();h.step.output_json.runtime.requiresApproval=true;let calls=0
 const handler=async()=>{calls++;return{status:'completed',verified:true}}
 await h.execute(handler);assert.equal(calls,0);assert.equal(h.run.status,'waiting_approval')
 h.step.output_json.runtime.approvalId='bound';h.tables.agent_approvals.push({id:'bound',run_id:'run',telegram_id:'123',status:'approved'})
 await h.runtime.releaseApprovedAutonomousStep({actor,runId:'run',stepKey:'first'});await h.execute(handler);assert.equal(calls,1)
})
await check('an approval for another run cannot release this step',async()=>{
 const h=harness();h.step.output_json.runtime.approvalId='wrong';h.tables.agent_approvals.push({id:'wrong',run_id:'other',telegram_id:'123',status:'approved'})
 await assert.rejects(h.runtime.releaseApprovedAutonomousStep({actor,runId:'run',stepKey:'first'}),/approval_required/)
 assert.equal(h.step.output_json.runtime.approvalId,'wrong')
})
await check('checkpoint superseded by cancellation cannot report completed',async()=>{
 const h=harness();const result=await h.execute(async()=>{h.run.status='failed';h.run.error='user_cancelled';h.step.status='cancelled';return{status:'completed',verified:true}})
 assert.equal(result.executions[0].status,'superseded');assert.equal(h.tables.agent_activity.filter((v:any)=>v.event_type==='autonomous_step_completed').length,0)
})
await check('same-attempt backoff changes cannot be overwritten by a stale claimant',async()=>{
 const h=harness();let calls=0
 h.beforeWrite(()=>{h.step.output_json.runtime.retryAt='2099-01-01T00:00:00Z'})
 await h.execute(async()=>{calls++;return{status:'completed',verified:true}})
 assert.equal(calls,0);assert.equal(h.step.output_json.runtime.retryAt,'2099-01-01T00:00:00Z')
})
await check('new approval wait cannot be overwritten by a stale claimant',async()=>{
 const h=harness();let calls=0
 h.beforeWrite(()=>{h.step.output_json.runtime.approvalId='new-approval'})
 await h.execute(async()=>{calls++;return{status:'completed',verified:true}})
 assert.equal(calls,0);assert.equal(h.step.output_json.runtime.approvalId,'new-approval')
})
await check('cancellation racing with replan persistence cannot reopen the parent',async()=>{
 const h=harness();h.beforeWrite(()=>{h.run.status='failed';h.run.error='user_cancelled'})
 await assert.rejects(h.runtime.appendAutonomousReplan({actor,runId:'run',reason:'Fixture',steps:[{key:'next',title:'Fixture next',toolName:'fixture',mutation:true}]}),/superseded/)
 let calls=0;await h.execute(async()=>{calls++;return{status:'completed',verified:true}});assert.equal(calls,0);assert.equal(h.run.status,'failed')
})
await check('same-owner same-run approval for another action grants no authority',async()=>{
 const h=harness();h.step.output_json.runtime.requiresApproval=true;h.step.output_json.runtime.approvalId='foreign-action'
 h.tables.agent_approvals.push({id:'foreign-action',run_id:'run',telegram_id:'123',status:'approved',action_hash:'different-action',policy_version:'brain-v1.1',requested_at:new Date().toISOString()})
 await assert.rejects(h.runtime.releaseApprovedAutonomousStep({actor,runId:'run',stepKey:'first'}),/binding|action|approval/)
 assert.equal(h.step.output_json.runtime.approvalId,'foreign-action')
})
if(failures)process.exitCode=1
