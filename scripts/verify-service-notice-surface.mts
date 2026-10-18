import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

const notice={id:'notice-1',telegram_id:'123',kind:'commitment',status:'active',source_type:'gmail_service_notice',source_id:'thread-one',title:'Review service billing notice',summary:'Payment failed; suspension warning',source_refs:[{type:'gmail_thread',id:'thread-one'},{type:'gmail_message',id:'message-one'}],evidence_json:{secret:'DO_NOT_EXPOSE'},updated_at:'2026-10-18T01:00:00Z'}
let fail=false,session:any={telegramId:'123',surface:'web'}
let fixture=[notice,{...notice,id:'duplicate'}, {...notice,id:'other-owner',telegram_id:'456',title:'OTHER_OWNER'}, {...notice,id:'resolved',status:'resolved',title:'RESOLVED'}, {...notice,id:'approval',source_type:'approval',title:'APPROVAL_DUPLICATE'}]
const calls:any[]=[]
const db={from:(table:string)=>{
 const filters:any[]=[];calls.push({table,filters});let max=Infinity
 const q:any={select:()=>q,eq:(k:string,v:any)=>{filters.push([k,v]);return q},neq:()=>q,in:()=>q,gte:()=>q,order:()=>q,limit:(n:number)=>{max=n;return q},maybeSingle:async()=>({data:table==='users'?{name:'Fixture',timezone:'Asia/Kolkata'}:null}),then:(resolve:any)=>{
  const rows=table==='agent_open_loops'?fixture.filter(row=>filters.every(([k,v])=>(row as any)[k]===v)):[]
  return Promise.resolve({data:fail&&table==='agent_open_loops'?null:rows.slice(0,max),error:fail&&table==='agent_open_loops'?{message:'PRIVATE_ERROR'}:null}).then(resolve)
 }};return q
}}
const jsx=(type:any,props:any)=>typeof type==='function'?type(props):props
const deps:any={'react/jsx-runtime':{jsx,jsxs:jsx},'next/link':{default:'a'},'next/server':{NextResponse:{json:(body:any,init:any={})=>({status:init.status||200,json:async()=>body})}},'@/lib/agent/session':{requireAgentSession:async()=>session||{status:401},isAgentSession:(s:any)=>!!s.telegramId},'@/lib/dashboard/session':{getSession:async()=>session},'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/agent/task-lifecycle':{retiredRunReason:()=>false},'@/lib/dashboard/queries':{getTodayReminders:async()=>({ok:true,reminders:[]}),getLists:async()=>({ok:true,lists:[]})},'@/lib/dashboard/memory':{getDashboardMemory:async()=>({ok:true,items:[]})},'@/lib/dashboard/human-handoffs':{getPendingBrowserHandoffs:async()=>[]},'@/lib/agent/stale-runs':{staleRunningCutoff:()=>'',isStaleRunning:()=>false},'@/lib/dashboard/agent-activity':{getDashboardActivityRuns:async()=>[]},'@/lib/dashboard/activity-collapse':{collapseRepeatedRuns:(r:any)=>r}}
function load(path:string):any{
 const exports:any={};runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:(name:string)=>{
  if(deps[name])return deps[name]
  if(name==='@/lib/dashboard/service-notices')return load('lib/dashboard/service-notices.ts')
  if(name==='@/components/dashboard/service-notice-cards')return load('components/dashboard/service-notice-cards.tsx')
  return {}
 },console:{error:()=>{}},process,Date,Intl,Map,Set,Number,String,Math,Error});return exports
}
const snapshot=load('app/api/agent/snapshot/route.ts')
let response=await snapshot.GET({} as Request),body=await response.json()
assert.equal(response.status,200)
assert.equal(body.serviceNotices?.length,1,'stored service notice must appear exactly once in owner snapshot')
assert.equal(body.serviceNotices[0].threadId,'thread-one')
assert.equal(body.serviceNotices[0].messageId,'message-one')
assert.doesNotMatch(JSON.stringify(body),/DO_NOT_EXPOSE|OTHER_OWNER|RESOLVED|APPROVAL_DUPLICATE/)
let rendered=JSON.stringify(await load('app/dashboard/(app)/home/page.tsx').default())
assert.match(rendered,/Review service billing notice/,'actual Home Needs you must show the notice')
assert.doesNotMatch(rendered,/Nothing is waiting for you|Your day is clear/)
assert.match(rendered,/No payment or account change/)
fixture=[notice,{...notice,id:'different',source_id:'thread-two',source_refs:[{type:'gmail_thread',id:'thread-two'}]}]
body=await (await snapshot.GET({} as Request)).json();assert.equal(body.serviceNotices.length,2,'equal titles on distinct source threads stay distinct')
fail=true
response=await snapshot.GET({} as Request);assert.equal(response.status,500,'query errors cannot claim empty success')
rendered=JSON.stringify(await load('app/dashboard/(app)/home/page.tsx').default())
assert.match(rendered,/Service notices could not be loaded/)
assert.doesNotMatch(rendered,/Nothing is waiting for you|Your day is clear|PRIVATE_ERROR/)
fail=false;session=null;const before=calls.length
response=await snapshot.GET({} as Request);assert.equal(response.status,401);assert.equal(calls.length,before,'unauthenticated snapshot never reads owner data')
for(const call of calls.filter(c=>c.table==='agent_open_loops')){
 assert.ok(call.filters.some(([k,v]:any)=>k==='telegram_id'&&v==='123'))
 assert.ok(call.filters.some(([k,v]:any)=>k==='status'&&v==='active'))
 assert.ok(call.filters.some(([k,v]:any)=>k==='kind'&&v==='commitment'))
 assert.ok(call.filters.some(([k,v]:any)=>k==='source_type'&&v==='gmail_service_notice'))
}
assert.ok(existsSync('lib/dashboard/service-notices.ts'))
console.log('Service notices: actual snapshot/Home visibility, owner isolation, source dedupe, privacy, read-only transport, and explicit unavailable state passed')
