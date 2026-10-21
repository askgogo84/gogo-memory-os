// Actual persistent entry -> runtime -> existing canonical task executor, inert storage only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import * as policy from '../lib/agent/policy'
import * as binding from '../lib/agent/approval-binding'
import * as ttl from '../lib/agent/approval-ttl'
import { redactSecretShapedText } from '../lib/bot/memory-redaction'
const actor = {userId:'owner-a',legacyTelegramId:123,whatsappId:'inert-owner-a',name:'Fixture'}
const task = (instruction:string) => ({tool:'tasks',title:instruction,instruction})
function harness(instructions = ['List all open tasks','List all open tasks']) {
 const tables:any = {agent_runs:[],agent_steps:[],agent_activity:[],agent_approvals:[],agent_permissions:[],todos:[]}
 const queries:any[]=[]; let ids=0, fallback=0
 let fault:((table:string,op:string,value:any)=>any)|undefined
 const db = {from(table:string) {
  assert.ok(table in tables, 'unexpected table '+table)
  let op='read',value:any,single=false,cap=Infinity,sortKey:string|undefined,ascending=true
  const filters:Array<(row:any)=>boolean>=[]
  const field=(row:any,key:string)=>key.split(/->>?/).reduce((v:any,k:string)=>v?.[k],row)
  const result=async()=>{
   queries.push({table,op,value:structuredClone(value)})
   const failure=await fault?.(table,op,value)
   if(failure)return {data:null,error:{message:failure}}
   let rows=tables[table].filter((row:any)=>filters.every(f=>f(row)))
   if(sortKey)rows.sort((a:any,b:any)=>(String(a[sortKey!]).localeCompare(String(b[sortKey!])))*(ascending?1:-1))
   rows=rows.slice(0,cap)
   if(op==='update')rows.forEach((row:any)=>Object.assign(row,structuredClone(value)))
   if(op==='insert'){
    rows=(Array.isArray(value)?value:[value]).map((row:any)=>({id:`fixture-${++ids}`,created_at:new Date().toISOString(),...structuredClone(row)}))
    tables[table].push(...rows)
   }
   return {data:structuredClone(single?(rows[0]||null):rows),error:null}
  }
  const q:any={select:()=>q,update:(v:any)=>{op='update';value=v;return q},insert:(v:any)=>{op='insert';value=v;return q},
   eq:(k:string,v:any)=>{filters.push(r=>String(field(r,k))===String(v));return q},
   in:(k:string,v:any[])=>{filters.push(r=>v.includes(field(r,k)));return q},
   is:(k:string,v:any)=>{filters.push(r=>v===null?field(r,k)==null:field(r,k)===v);return q},
   gte:(k:string,v:any)=>{filters.push(r=>field(r,k)>=v);return q},lte:(k:string,v:any)=>{filters.push(r=>field(r,k)<=v);return q},
   ilike:(k:string,v:string)=>{filters.push(r=>String(field(r,k)).toLowerCase()===v.toLowerCase());return q},
   order:(k:string,opts:any={})=>{sortKey=k;ascending=opts.ascending!==false;return q},limit:(n:number)=>{cap=n;return q},
   maybeSingle:async()=>{single=true;return result()},single:async()=>{single=true;return result()},then:(a:any,b:any)=>Promise.resolve().then(result).then(a,b)}
  return q
 }}
 const common:any={
  '@/lib/supabase-admin':{supabaseAdmin:db},'node:crypto':{createHash},
  '@/lib/bot/memory-redaction':{redactSecretShapedText},'./policy':policy,
  './approval-binding':binding,'./approval-ttl':ttl,'./model-usage':{recordTaskModelUsage:async()=>{}},
  './same-brain':{dispatchThroughSameBrain:async()=>{fallback++;return{text:'Connection unavailable. Approve before continuing.',handledBy:'same-brain'}}},
 }
 function load(file:string,extra:any={}) {
  const exports:any={}
  const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  runInNewContext(source,{exports,Date,Promise,Set,Map,console,require:(id:string)=>{
   if(id in extra)return extra[id]
   if(id in common)return common[id]
   // Imported but uncalled functions must never do external work in this harness.
   return new Proxy({}, {get:(_t,key)=>()=>{throw Error('Unexpected dependency '+id+'.'+String(key))}})
  }})
  return exports
 }
 const general=load('lib/agent/general-planner.ts')
 const runtime=load('lib/agent/autonomous-runtime.ts',{
  '@/lib/metering/core':{runMeteredTask:(_owner:any,_trace:any,fn:any)=>fn()},
  './specialist-registry':{selectSpecialistRoute:()=>({primary:'tasks',supporting:[]})},
  './run-notify':{notifyRunOutcome:async()=>{}},
 })
 const driveRead=load('lib/agent/persistent-drive-read.ts')
 const persistent=load('lib/agent/persistent-general-plan.ts',{'./general-planner':general,'./autonomous-runtime':runtime,'./persistent-drive-read':driveRead})
 const start=()=>persistent.tryRunPersistentGeneralPlan({actor,surface:'web',text:'Fixture task objective',prepared:{plan:{title:'Fixture tasks',reason:'Two typed task operations',steps:instructions.map(task)},startedAt:new Date().toISOString(),modelUsage:[]}})
 const resume=()=>persistent.resumePersistentGeneralPlan({actor,runId:tables.agent_runs[0].id})
 return {tables,queries,start,resume,persistent,general,actor,fallback:()=>fallback,setFault:(f:typeof fault)=>{fault=f},setPermission:(level:string)=>{tables.agent_permissions=[{telegram_id:'123',capability:'tasks',level}]}}
}
let failures=0,passed=0
async function check(name:string,fn:()=>Promise<void>){try{await fn();passed++;console.log('PASS '+name)}catch(e:any){failures++;console.error('FAIL '+name+': '+e.message)}}
await check('actual persistent read uses owner-bound canonical rows, never an opaque connection reply',async()=>{
 const h=harness();h.tables.todos.push({id:'own',whatsapp_id:actor.whatsappId,text:'Pack trip bag',done:false},{id:'foreign',whatsapp_id:'inert-owner-b',text:'Foreign private task',done:false})
 const r=await h.start();assert.equal(r.status,'completed');assert.equal(h.fallback(),0)
 assert.equal(h.tables.agent_steps[0].output_json.verifiedStore,'todos')
 assert.equal(h.tables.agent_steps[0].output_json.tasks.length,1);assert.equal(h.tables.agent_steps[0].output_json.tasks[0].id,'own')
 assert.equal(h.queries.filter(q=>q.table==='todos'&&q.op==='insert').length,0)
 assert.equal(h.tables.agent_steps[0].output_json.runtime.mutation,false)
})
await check('empty canonical read is an evidenced empty lookup, not fabricated success',async()=>{
 const h=harness();await h.start();assert.equal(h.fallback(),0);assert.equal(h.tables.agent_steps[0].output_json.tasks.length,0)
 assert.equal(h.tables.agent_steps[0].output_json.readOnly,true)
})
await check('explicit create stores canonical task IDs and read successor observes it',async()=>{
 const h=harness(['Create task: Pack trip bag','List all open tasks']);await h.start()
 assert.equal(h.tables.todos.length,1);assert.equal(h.tables.todos[0].text,'Pack trip bag')
 assert.equal(h.tables.agent_steps[0].output_json.todoId,h.tables.todos[0].id)
 assert.equal(h.tables.agent_steps[0].output_json.runtime.mutation,true)
 assert.equal(h.tables.agent_steps[1].output_json.runtime.mutation,false)
 assert.equal(h.tables.agent_steps[1].output_json.tasks[0].id,h.tables.todos[0].id);assert.equal(h.fallback(),0)
 await h.resume();assert.equal(h.tables.todos.length,1)
})
await check('existing owner task is reused while same-named foreign task grants no reuse',async()=>{
 const h=harness(['Create task: Pack trip bag','Create task: Pack trip bag'])
 h.tables.todos.push({id:'foreign',whatsapp_id:'inert-owner-b',text:'Pack trip bag',done:false})
 await h.start();assert.equal(h.tables.todos.length,2);assert.equal(h.tables.agent_steps[1].output_json.reused,true)
 assert.notEqual(h.tables.agent_steps[0].output_json.todoId,'foreign')
})
await check('read failure retains queued checkpoint/backoff and blocks the successor',async()=>{
 const h=harness();h.setFault((table,op)=>table==='todos'&&op==='read'?'inert read timeout':null)
 await h.start();const [first,next]=h.tables.agent_steps
 assert.equal(first.status,'queued');assert.ok(first.output_json.runtime.retryAt);assert.notEqual(first.output_json.reconciliation_required,true)
 assert.equal(next.status,'queued');assert.equal(next.output_json.runtime.attempt,0);assert.equal(h.tables.agent_runs[0].status,'running')
 h.setFault(undefined);first.output_json.runtime.retryAt=null;await h.resume();assert.equal(h.tables.agent_runs[0].status,'completed')
 assert.equal(h.fallback(),0)
})
await check('read attempts exhaust existing budget without mutation quarantine',async()=>{
 const h=harness();h.setFault((t,o)=>t==='todos'&&o==='read'?'inert read timeout':null);await h.start()
 for(let i=0;i<3;i++){h.tables.agent_steps[0].output_json.runtime.retryAt=null;await h.resume()}
 assert.equal(h.tables.agent_steps[0].status,'failed');assert.equal(h.tables.agent_steps[0].output_json.runtime.attempt,4)
 assert.notEqual(h.tables.agent_steps[0].output_json.reconciliation_required,true);assert.equal(h.tables.agent_runs[0].status,'failed')
})
await check('lost write response keeps unknown and never blindly repeats the task creation',async()=>{
 const h=harness(['Create task: Pack trip bag','List all open tasks']);let attempts=0
 h.setFault((t,o,value)=>{if(t==='todos'&&o==='insert'){attempts++;h.tables.todos.push({id:'accepted-with-lost-response',...value});return'inert response lost'}return null})
 await h.start();assert.equal(attempts,1);assert.equal(h.tables.agent_runs[0].status,'outcome_unknown')
 assert.equal(h.tables.agent_steps[0].output_json.reconciliation_required,true);await h.resume();assert.equal(attempts,1)
 assert.equal(h.tables.agent_steps[1].output_json.runtime.attempt,0)
 const again=await h.start();assert.equal(again.deduplicated,true);assert.equal(again.status,'outcome_unknown');assert.equal(h.tables.agent_runs.length,1);assert.equal(attempts,1)
})
await check('lost completion checkpoint preserves unknown after a successful task write',async()=>{
 const h=harness(['Create task: Pack trip bag','List all open tasks']);let lost=false
 h.setFault((t,o,v)=>{if(!lost&&t==='agent_steps'&&o==='update'&&v.status==='completed'){lost=true;return'inert checkpoint lost'}return null})
 await h.start();assert.equal(h.tables.todos.length,1);assert.equal(h.tables.agent_runs[0].status,'outcome_unknown')
 assert.equal(h.tables.agent_steps[0].output_json.reconciliation_required,true);await h.resume();assert.equal(h.tables.todos.length,1)
 assert.equal(h.tables.agent_steps[1].output_json.runtime.attempt,0)
})
await check('duplicate workers cannot dispatch a second task while the claimed write waits',async()=>{
 const h=harness(['Create task: Pack trip bag','List all open tasks'])
 let entered!:()=>void,release!:()=>void
 const waiting=new Promise<void>(r=>{entered=r}),gate=new Promise<void>(r=>{release=r})
 h.setFault(async(t,o)=>{if(t==='todos'&&o==='insert'){entered();await gate}return null})
 const first=h.start();await waiting
 await h.resume();release();await first
 assert.equal(h.tables.todos.length,1);assert.equal(h.queries.filter(q=>q.table==='todos'&&q.op==='insert').length,1)
 assert.equal(h.tables.agent_runs[0].status,'completed');assert.equal(h.fallback(),0)
})
await check('crashed read worker recovers through existing attempt/backoff without mutation uncertainty',async()=>{
 const h=harness();h.setFault((t,o)=>t==='todos'&&o==='read'?'inert read timeout':null);await h.start()
 const first=h.tables.agent_steps[0];first.status='running';first.started_at='2000-01-01T00:00:00Z';first.output_json.runtime.leaseUntil='2000-01-01T00:01:00Z'
 h.setFault(undefined);await h.resume()
 assert.equal(first.status,'queued');assert.ok(first.output_json.runtime.retryAt);assert.notEqual(first.output_json.reconciliation_required,true)
 first.output_json.runtime.retryAt=null;await h.resume();assert.equal(h.tables.agent_runs[0].status,'completed')
})
for(const level of ['off','read','draft','invalid'])await check(level+' permission cannot create a task',async()=>{
 const h=harness(['Create task: Pack trip bag','List all open tasks']);h.setPermission(level);await h.start()
 assert.equal(h.tables.todos.length,0);assert.equal(h.fallback(),0);assert.equal(h.tables.agent_steps[0].status,'failed')
 assert.notEqual(h.tables.agent_steps[0].output_json.reconciliation_required,true)
 assert.equal(h.queries.filter(q=>q.table==='todos').length,0)
})
for(const level of ['read','draft','ask','auto'])await check(level+' preserves canonical task reads',async()=>{
 const h=harness();h.setPermission(level);await h.start();assert.equal(h.tables.agent_runs[0].status,'completed');assert.equal(h.fallback(),0)
})
await check('ask preserves existing explicit private-task create policy',async()=>{
 const h=harness(['Create task: Pack trip bag','List all open tasks']);h.setPermission('ask');await h.start();assert.equal(h.tables.todos.length,1);assert.equal(h.tables.agent_runs[0].status,'completed')
})
await check('permission outage is definite no-dispatch rather than an uncertain write',async()=>{
 const h=harness(['Create task: Pack trip bag','List all open tasks']);h.setFault(t=>t==='agent_permissions'?'inert permission outage':null)
 await h.start();assert.equal(h.tables.agent_steps[0].status,'failed');assert.notEqual(h.tables.agent_steps[0].output_json.reconciliation_required,true)
 assert.equal(h.queries.filter(q=>q.table==='todos').length,0);assert.equal(h.fallback(),0)
})
await check('off permission also denies read access to private task rows',async()=>{
 const h=harness();h.setPermission('off');await h.start();assert.equal(h.tables.agent_steps[0].status,'failed')
 assert.equal(h.queries.filter(q=>q.table==='todos').length,0);assert.equal(h.fallback(),0)
})
for(const instruction of ['List tasks and create a new task','Delete all tasks','Prepare the next action'])await check('ambiguous/unsupported task instruction blocks: '+instruction,async()=>{
 const h=harness([instruction,'List all open tasks']);await h.start();assert.equal(h.tables.agent_steps[0].status,'failed')
 assert.equal(h.tables.agent_steps[1].output_json.runtime.attempt,0);assert.equal(h.fallback(),0);assert.equal(h.queries.filter(q=>q.table==='todos').length,0)
})
await check('cancellation during permission lookup prevents canonical executor dispatch',async()=>{
 const h=harness(['Create task: Pack trip bag','List all open tasks'])
 h.setFault(t=>{if(t==='agent_permissions'){h.tables.agent_runs[0].status='failed';h.tables.agent_runs[0].error='user_cancelled'}return null})
 await h.start();assert.equal(h.tables.todos.length,0);assert.equal(h.tables.agent_runs[0].error,'user_cancelled');assert.equal(h.fallback(),0)
})
await check('failed and repeated unknown outcomes never claim to be still working',async()=>{
 const denied=harness(['Create task: Pack trip bag','List all open tasks']);denied.setPermission('off')
 const failed=await denied.start();assert.equal(failed.status,'failed');assert.match(failed.text,/couldn.t finish|couldn.t complete/i);assert.doesNotMatch(failed.text,/working through/i)
 const h=harness(['Create task: Pack trip bag','List all open tasks']);h.setFault((t,o)=>t==='todos'&&o==='insert'?'inert lost response':null)
 const initial=await h.start();assert.equal(initial.status,'outcome_unknown');assert.match(initial.text,/couldn.t confirm/i);assert.doesNotMatch(initial.text,/working through/i)
 const repeated=await h.start();assert.equal(repeated.deduplicated,true);assert.equal(repeated.status,'outcome_unknown')
 assert.match(repeated.text,/haven.t retried/i);assert.equal(h.tables.agent_runs.length,1)
})
console.log(`PERSISTENT_TASK_EVIDENCE ${passed}/${passed+failures}`)
if(failures)process.exitCode=1
