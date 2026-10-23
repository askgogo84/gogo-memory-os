import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

const notice={id:'notice-1',telegram_id:'123',kind:'commitment',status:'active',source_type:'gmail_service_notice',source_id:'thread-one',title:'Review service billing notice',summary:'Payment failed; suspension warning',source_refs:[{type:'gmail_thread',id:'thread-one'},{type:'gmail_message',id:'message-one'}],evidence_json:{secret:'DO_NOT_EXPOSE'},updated_at:'2026-10-18T01:00:00Z'}
let fail=false,session:any={telegramId:'123',surface:'web'}
let renderSnapshot:any=null,hookIndex=0
let fixture=[notice,{...notice,id:'duplicate'}, {...notice,id:'other-owner',telegram_id:'456',title:'OTHER_OWNER'}, {...notice,id:'resolved',status:'resolved',title:'RESOLVED'}, {...notice,id:'approval',source_type:'approval',title:'APPROVAL_DUPLICATE'}]
const calls:any[]=[]
const db={from:(table:string)=>{
 const filters:any[]=[];calls.push({table,filters});let max=Infinity,exact=false
 const q:any={select:(_columns:string,options:any={})=>{exact=options.count==='exact';return q},eq:(k:string,v:any)=>{filters.push([k,v]);return q},neq:()=>q,in:()=>q,gte:()=>q,order:()=>q,limit:(n:number)=>{max=n;return q},maybeSingle:async()=>({data:table==='users'?{name:'Fixture',timezone:'Asia/Kolkata'}:null}),then:(resolve:any)=>{
  const rows=table==='agent_open_loops'?fixture.filter(row=>filters.every(([k,v])=>(row as any)[k]===v)):[]
  return Promise.resolve({data:fail&&table==='agent_open_loops'?null:rows.slice(0,max),count:exact?new Set(rows.map(row=>row.source_id)).size:undefined,error:fail&&table==='agent_open_loops'?{message:'PRIVATE_ERROR'}:null}).then(resolve)
 }};return q
}}
const jsx=(type:any,props:any)=>typeof type==='function'?type(props):props
const deps:any={'react/jsx-runtime':{jsx,jsxs:jsx},'next/link':{default:'a'},'next/server':{NextResponse:{json:(body:any,init:any={})=>({status:init.status||200,json:async()=>body})}},'@/lib/agent/session':{requireAgentSession:async()=>session||{status:401},isAgentSession:(s:any)=>!!s.telegramId},'@/lib/dashboard/session':{getSession:async()=>session},'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/agent/task-lifecycle':{retiredRunReason:()=>false},'@/lib/dashboard/queries':{getTodayReminders:async()=>({ok:true,reminders:[]}),getUpcomingReminders:async()=>[],getLists:async()=>({ok:true,lists:[]})},'@/lib/dashboard/memory':{getDashboardMemory:async()=>({ok:true,items:[]})},'@/lib/dashboard/human-handoffs':{getPendingBrowserHandoffs:async()=>[]},'@/lib/agent/stale-runs':{staleRunningCutoff:()=>'',isStaleRunning:()=>false},'@/lib/dashboard/agent-activity':{getDashboardActivityRuns:async()=>[]},'@/lib/dashboard/activity-collapse':{collapseRepeatedRuns:(r:any)=>r}}
deps.react={useState:(initial:any)=>{const index=hookIndex++;return [index===0&&renderSnapshot?renderSnapshot:index===1&&renderSnapshot?false:initial,()=>{}]},useEffect:()=>{},useMemo:(fn:any)=>fn(),useCallback:(fn:any)=>fn}
deps['next/navigation']={useSearchParams:()=>({get:()=> 'approvals'}),usePathname:()=>'/dashboard/agent'}
function load(path:string):any{
 const exports:any={};runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:(name:string)=>{
  if(deps[name])return deps[name]
  if(name==='@/lib/security/email-redaction')return load('lib/security/email-redaction.ts')
  if(name==='@/lib/bot/memory-redaction')return load('lib/bot/memory-redaction.ts')
  if(name==='@/lib/dashboard/service-notices')return load('lib/dashboard/service-notices.ts')
  if(name==='@/lib/dashboard/browser-auth-summary')return load('lib/dashboard/browser-auth-summary.ts')
  if(name==='@/components/dashboard/service-notice-cards')return load('components/dashboard/service-notice-cards.tsx')
  if(name==='@/lib/dashboard/task-feed')return load('lib/dashboard/task-feed.ts')
  if(name==='@/lib/dashboard/home-sections')return load('lib/dashboard/home-sections.ts')
  if(name==='@/lib/agent/task-title')return load('lib/agent/task-title.ts')
  if(name==='@/lib/agent/owner-confirmation')return load('lib/agent/owner-confirmation.ts')
  if(name==='@/lib/gogo/agent-states')return load('lib/gogo/agent-states.ts')
  if(name==='@/lib/dashboard/readable-summary')return {readableRunSummary:(s:any)=>String(s||'')}
  if(name==='@/components/dashboard/feed-list')return load('components/dashboard/feed-list.tsx')
  return {}
 },console:{error:()=>{}},process,Date,Intl,Map,Set,Number,String,Math,Error,URL});return exports
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
rendered=JSON.stringify(await load('app/dashboard/(app)/activity/page.tsx').default({searchParams:Promise.resolve({})}))
assert.match(rendered,/Review service billing notice/,'Activity Needs you must show notice')
renderSnapshot={...body,runs:[],watchers:[],approvals:[],goals:[],ideas:[],permissions:[],artifacts:[]};hookIndex=0
rendered=JSON.stringify(load('app/dashboard/(app)/agent/page.tsx').default())
assert.match(rendered,/Review service billing notice/,'actual Needs you page must render the notice')
assert.doesNotMatch(rendered,/Nothing needs your input right now|Approve & run/)
const nav=load('components/dashboard/dashboard-nav.tsx')
assert.equal(nav.needsYouCount({approvals:2,handoffs:1,watchers:99,serviceNotices:1}),4)
assert.equal(nav.needsYouCount({approvals:2,handoffs:1,watchers:99}),3,'legacy count defaults remain safe')
fixture=[{...notice,title:'Payment failed; password reset https://example.invalid/reset-password?token=SYNTHETIC_RESET_TOKEN',summary:'Shutdown warning. Password: SYNTHETIC_PASSWORD. Verification code: 654321. Reset https://example.invalid/reset-password?token=SYNTHETIC_SUMMARY_TOKEN'}]
const projected=await load('lib/dashboard/service-notices.ts').getServiceNotices('123')
assert.doesNotMatch(JSON.stringify(projected),/SYNTHETIC_RESET_TOKEN|SYNTHETIC_PASSWORD|654321|SYNTHETIC_SUMMARY_TOKEN/,'saved email auth material must be withheld at read projection')
body=await (await snapshot.GET({} as Request)).json()
const cards=JSON.stringify(load('components/dashboard/service-notice-cards.tsx').ServiceNoticeCards({notices:body.serviceNotices}))
for(const output of [JSON.stringify(body),cards]){
 assert.doesNotMatch(output,/SYNTHETIC_RESET_TOKEN|SYNTHETIC_PASSWORD|654321|SYNTHETIC_SUMMARY_TOKEN/)
 assert.match(output,/thread-one/);assert.match(output,/message-one/)
 assert.match(output,/authentication link withheld/)
}
fixture=[notice,{...notice,id:'different',source_id:'thread-two',source_refs:[{type:'gmail_thread',id:'thread-two'}]}]
body=await (await snapshot.GET({} as Request)).json();assert.equal(body.serviceNotices.length,2,'equal titles on distinct source threads stay distinct')
fixture=Array.from({length:63},(_,i)=>({...notice,id:'n'+i,source_id:'thread'+i}))
body=await (await snapshot.GET({} as Request)).json();assert.equal(body.serviceNoticeCount,63);assert.equal(body.serviceNotices.length,50,'bounded cards retain exact untruncated total')
fail=true
response=await snapshot.GET({} as Request);assert.equal(response.status,500,'query errors cannot claim empty success')
rendered=JSON.stringify(await load('app/dashboard/(app)/home/page.tsx').default())
assert.match(rendered,/Service notices could not be loaded/)
assert.doesNotMatch(rendered,/Nothing is waiting for you|Your day is clear|PRIVATE_ERROR/)
fail=false;fixture=[]
body=await (await snapshot.GET({} as Request)).json();assert.equal(body.serviceNoticeCount,0);assert.equal(body.serviceNotices.length,0)
rendered=JSON.stringify(await load('app/dashboard/(app)/home/page.tsx').default());assert.match(rendered,/Nothing is waiting for you/)
await assert.rejects(()=>load('lib/dashboard/service-notices.ts').getServiceNotices(''),/service_notice_owner_required/)
session=null;const before=calls.length
response=await snapshot.GET({} as Request);assert.equal(response.status,401);assert.equal(calls.length,before,'unauthenticated snapshot never reads owner data')
await load('app/dashboard/(app)/home/page.tsx').default();assert.equal(calls.length,before,'signed-out Home never reads service notices')
// Calendar clashes (task feed) are a separate owner-scoped open-loop read.
for(const call of calls.filter(c=>c.table==='agent_open_loops'&&c.filters.some(([k,v]:any)=>k==='source_type'&&v==='calendar_conflict')))assert.ok(call.filters.some(([k,v]:any)=>k==='telegram_id'&&v==='123'))
for(const call of calls.filter(c=>c.table==='agent_open_loops'&&!c.filters.some(([k,v]:any)=>k==='source_type'&&v==='calendar_conflict'))){
 assert.ok(call.filters.some(([k,v]:any)=>k==='telegram_id'&&v==='123'))
 assert.ok(call.filters.some(([k,v]:any)=>k==='status'&&v==='active'))
 assert.ok(call.filters.some(([k,v]:any)=>k==='kind'&&v==='commitment'))
 assert.ok(call.filters.some(([k,v]:any)=>k==='source_type'&&v==='gmail_service_notice'))
}
assert.ok(existsSync('lib/dashboard/service-notices.ts'))
console.log('Service notices: actual snapshot/Home visibility, owner isolation, source dedupe, privacy, read-only transport, and explicit unavailable state passed')
