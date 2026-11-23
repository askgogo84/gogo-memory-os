import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const watches=[{id:'goal',type:'goal_review',title:'Daily step goal review',condition_json:{title:'Daily step goal review'}},...Array.from({length:9},(_,i)=>({id:'w'+i,type:'web_search',title:'Watch '+i,condition_json:{title:'Watch '+i},next_check_at:null}))]
const calls:any[]=[]
let rejectTable = '', errorTable = ''
let handoffs: any[] = []
let handoffFailure = false
// Inert source-level test rows; empty for the existing Home/Activity watch-count controls.
let syntheticRuns:any[]=[]
const db={from:(table:string)=>{
 const call:any={table,filters:[]};calls.push(call);let limit=Infinity,count=false
 const q:any={select:(_cols:string,options:any={})=>{count=options.count==='exact';return q},eq:(key:string,value:any)=>{call.filters.push(['eq',key,value]);return q},neq:(key:string,value:any)=>{call.filters.push(['neq',key,value]);return q},in:(key:string,values:any[])=>{call.filters.push(['in',key,values]);return q},gte:()=>q,order:()=>q,limit:(n:number)=>{limit=n;return q},maybeSingle:async()=>({data:table==='users'?{name:'Fixture',timezone:'Asia/Kolkata'}:null}),then:(resolve:any,reject:any)=>{
 if(table===rejectTable)return reject(new Error("Synthetic private failure"))
 if(table===errorTable)return resolve({data:null,error:{message:"Synthetic private failure"}})
 const rows=table==='agent_watchers'?watches.filter(row=>!call.filters.some(([op,key,value]:any)=>op==='neq'&&key==='type'&&row.type===value)):
   table==='agent_runs'?syntheticRuns.filter(row=>call.filters.every(([op,key,value]:any)=>op==='eq'?String(row[key])===String(value):op==='in'?value.includes(row[key]):true)):[]
 return Promise.resolve({data:rows.slice(0,limit),count:count?rows.length:undefined,error:null}).then(resolve)
 }};return q
}}
const jsx=(_type:any,props:any)=>props
const deps:any={'@/lib/dashboard/service-notices':{EMPTY_SERVICE_NOTICES:{items:[],total:0,unavailable:false},getServiceNoticesForPage:async()=>({items:[],total:0,unavailable:false})},'react/jsx-runtime':{jsx,jsxs:jsx},'next/link':{default:'a'},'@/lib/dashboard/session':{getSession:async()=>({telegramId:'123'})},'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/dashboard/queries':{getTodayReminders:async()=>({ok:true,reminders:[]}),getUpcomingReminders:async()=>[],getLists:async()=>({ok:true,lists:[]})},'@/lib/dashboard/memory':{getDashboardMemory:async()=>({ok:true,items:[]})},'@/lib/dashboard/human-handoffs':{getPendingBrowserHandoffs:async()=>{if(handoffFailure)throw Error("Synthetic private failure");return handoffs}},'@/lib/agent/stale-runs':{staleRunningCutoff:()=>new Date().toISOString(),isStaleRunning:()=>false},'@/lib/dashboard/agent-activity':{getDashboardActivityRuns:async()=>[]},'@/lib/dashboard/activity-collapse':{collapseRepeatedRuns:(rows:any)=>rows}}
function load(path:string):any{
 const exports:any={};runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:(name:string)=>deps[name]||{},console,process,Date,Intl,Map,Set});return exports
}
deps['@/lib/agent/task-lifecycle']={retiredRunReason:()=>false}
deps['@/lib/dashboard/readable-summary']={readableRunSummary:(s:any)=>String(s||'')}
deps['@/lib/gogo/agent-states']=load('lib/gogo/agent-states.ts')
deps['@/lib/agent/task-title']=load('lib/agent/task-title.ts')
deps['@/lib/agent/owner-confirmation']=load('lib/agent/owner-confirmation.ts')
deps['@/lib/dashboard/task-state']=load('lib/dashboard/task-state.ts')
deps['@/lib/dashboard/task-feed']=load('lib/dashboard/task-feed.ts')
deps['@/lib/dashboard/home-sections']=load('lib/dashboard/home-sections.ts')
for(const page of ['home','activity']){
 const exports=load(`app/dashboard/(app)/${page}/page.tsx`)
 const rendered=JSON.stringify(await exports.default({searchParams:Promise.resolve(page==='home'?{tab:'radar'}:{})}))
 assert.doesNotMatch(rendered,/Daily step goal review/,page+' must exclude goal jobs before limiting display')
 const query=calls.filter(row=>row.table==='agent_watchers').at(-1)
 assert.ok(query.filters.some(([op,key,value]:any)=>op==='eq'&&key==='telegram_id'&&value==='123'),page+' owner scope')
 assert.ok(query.filters.some(([op,key,value]:any)=>op==='neq'&&key==='type'&&value==='goal_review'),page+' ordinary watches only')
 if(page==='home'){assert.match(rendered,/"Gogo is handling"\},\{"className":"text-\[13px\] text-\[#a8a8a4\]","children":9\}/,'home Gogo is handling count must be the exact total, not the display rows');assert.match(rendered,/"All ",9," in Tasks →"/,'the rest are one tap away in Tasks')}
 else assert.match(rendered,/"children":9/,'activity badge must report all nine watches rather than six display rows')
}
console.log('Actual Home/Activity server pages: goals excluded before row limits; owner-bound total watch counts remain exact')


// P1 conditional: the actual owner-scoped Home/Tasks feed must not hide unverified
// external effects by excluding outcome_unknown from both of its run queries.
// Entirely inert Supabase stand-in; no production DB, provider, or browser request.
{
 const makeRun=(id:string,status:string,telegram_id='123',metadata_json:any={})=>({
   id,telegram_id,status,metadata_json,type:'watch_check',capability:'tasks',
   title:'Synthetic '+id,summary:'Synthetic task status '+id,updated_at:'2026-10-28T03:30:00.000Z',error:null,
 })
 syntheticRuns=[
   makeRun('unknown-owned','outcome_unknown'),
   makeRun('metadata-unknown','completed','123',{outcome_status:'unknown'}),
   makeRun('completed-owned','completed'),
   makeRun('paused-owned','paused'),
   makeRun('failed-owned','failed'),
   makeRun('unknown-foreign','outcome_unknown','999'),
 ]
 const before=calls.length
 const feed=await deps['@/lib/dashboard/task-feed'].getTaskFeed('123',new Date('2026-10-28T04:00:00.000Z'))
 const runQueries=calls.slice(before).filter(call=>call.table==='agent_runs')
 assert.ok(runQueries.some(call=>call.filters.some(([op,key,value]:any)=>
   op==='in'&&key==='status'&&Array.isArray(value)&&value.includes('outcome_unknown'))),
   'P1: a real owner-scoped agent_runs feed query must include outcome_unknown')
 const byId=(id:string)=>feed.recent.find((item:any)=>item.id==='run-'+id)
 const unverified=byId('unknown-owned')
 assert.equal(unverified?.tag,'Not sure it happened','never omit or falsely settle an unknown external effect')
 assert.equal(unverified?.state,'blocked','never draw an unknown effect as ongoing work or finished')
 assert.match(unverified?.live||'',/outcome.*unverified/i,'tell the owner verification is needed')
 const legacy=byId('metadata-unknown')
 assert.equal(legacy?.tag,'Not sure it happened','a completed wrapper with unknown metadata is still unverified')
 assert.equal(legacy?.state,'blocked','do not paint uncertain completed wrappers as done')
 for(const id of ['completed-owned','paused-owned','failed-owned'])
   assert.ok(byId(id),'the existing recent outcomes remain visible: '+id)
 assert.ok(!byId('unknown-foreign'),'a different owner must never appear in this feed')
 assert.ok(runQueries.every(call=>call.filters.some(([op,key,value]:any)=>
   op==='eq'&&key==='telegram_id'&&value==='123')),'every private agent_runs query is scoped to the exact owner')
 console.log('PASS Task Feed: owned unknown-effect rows visible without a retry, neighbor isolation and normal recent states retained')
}


// Run the real feed and WhatsApp summary with independently failing sources.
const owner = '-9007199254740993'
const now = new Date('2026-11-23T05:00:00Z')
const getFeed = deps['@/lib/dashboard/task-feed'].getTaskFeed
syntheticRuns = []
handoffs = ['alpha', 'beta'].map(id => ({
  id, title: 'Review booking', summary: 'Sign in to continue', updatedAt: now.toISOString(), repeats: 1, cloud: true,
}))
let feed = await getFeed(owner, now)
assert.deepEqual(Array.from(feed.need, (item:any) => item.href), [
  '/dashboard/activity/alpha/browser', '/dashboard/activity/beta/browser',
])
rejectTable = 'agent_approvals'
errorTable = 'agent_watchers'
feed = await getFeed(owner, now)
assert.equal(feed.missing.need.join(','), 'approvals')
assert.equal(feed.missing.radar.join(','), 'background watches')
assert.equal(feed.need.length, 2)
assert.equal(feed.recentUnavailable, false)
assert.doesNotMatch(JSON.stringify(feed), /Synthetic private failure/)
assert.deepEqual(calls.at(-1).filters.find((f:any[]) => f[1] === 'telegram_id'), ['eq','telegram_id',owner])

deps['@/lib/dashboard/tasks'] = {getDashboardTasks: async () => ({ok:false})}
const pending = load('lib/bot/pending-summary.ts').buildPendingSummary
let summary = await pending(owner, 'Asia/Kolkata', now)
assert.match(summary, /Needs your attention/)
assert.match(summary, /dashboard\/activity\/alpha\/browser/)
assert.match(summary, /approvals, background watches, to-dos/)
assert.doesNotMatch(summary, /Nothing is pending|Needs your yes|Synthetic private failure/)
handoffFailure = true
summary = await pending(owner, 'Asia/Kolkata', now)
assert.match(summary, /browser handoffs/)
assert.doesNotMatch(summary, /Nothing is pending/)
rejectTable = ''
errorTable = ''
handoffFailure = false
handoffs = []
watches.splice(0)
deps['@/lib/dashboard/tasks'].getDashboardTasks = async () => ({ok:true, open:[]})
summary = await pending(owner, 'Asia/Kolkata', now)
assert.match(summary, /Nothing is pending/)
console.log('PASS partial task reads, distinct handoff links, truthful WhatsApp summary and confirmed empty state')
