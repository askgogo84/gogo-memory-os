import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const watches=[{id:'goal',type:'goal_review',title:'Daily step goal review',condition_json:{title:'Daily step goal review'}},...Array.from({length:9},(_,i)=>({id:'w'+i,type:'web_search',title:'Watch '+i,condition_json:{title:'Watch '+i},next_check_at:null}))]
const calls:any[]=[]
const db={from:(table:string)=>{
 const call:any={table,filters:[]};calls.push(call);let limit=Infinity,count=false
 const q:any={select:(_cols:string,options:any={})=>{count=options.count==='exact';return q},eq:(key:string,value:any)=>{call.filters.push(['eq',key,value]);return q},neq:(key:string,value:any)=>{call.filters.push(['neq',key,value]);return q},in:()=>q,gte:()=>q,order:()=>q,limit:(n:number)=>{limit=n;return q},maybeSingle:async()=>({data:table==='users'?{name:'Fixture',timezone:'Asia/Kolkata'}:null}),then:(resolve:any)=>{
 const rows=table==='agent_watchers'?watches.filter(row=>!call.filters.some(([op,key,value]:any)=>op==='neq'&&key==='type'&&row.type===value)):[]
 return Promise.resolve({data:rows.slice(0,limit),count:count?rows.length:undefined,error:null}).then(resolve)
 }};return q
}}
const jsx=(_type:any,props:any)=>props
const deps:any={'@/lib/dashboard/service-notices':{EMPTY_SERVICE_NOTICES:{items:[],total:0,unavailable:false},getServiceNoticesForPage:async()=>({items:[],total:0,unavailable:false})},'react/jsx-runtime':{jsx,jsxs:jsx},'next/link':{default:'a'},'@/lib/dashboard/session':{getSession:async()=>({telegramId:'123'})},'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/dashboard/queries':{getTodayReminders:async()=>({ok:true,reminders:[]}),getLists:async()=>({ok:true,lists:[]})},'@/lib/dashboard/memory':{getDashboardMemory:async()=>({ok:true,items:[]})},'@/lib/dashboard/human-handoffs':{getPendingBrowserHandoffs:async()=>[]},'@/lib/agent/stale-runs':{staleRunningCutoff:()=>new Date().toISOString(),isStaleRunning:()=>false},'@/lib/dashboard/agent-activity':{getDashboardActivityRuns:async()=>[]},'@/lib/dashboard/activity-collapse':{collapseRepeatedRuns:(rows:any)=>rows}}
function load(path:string):any{
 const exports:any={};runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:(name:string)=>deps[name]||{},console,process,Date,Intl,Map,Set});return exports
}
deps['@/lib/agent/task-lifecycle']={retiredRunReason:()=>false}
deps['@/lib/dashboard/readable-summary']={readableRunSummary:(s:any)=>String(s||'')}
deps['@/lib/gogo/agent-states']=load('lib/gogo/agent-states.ts')
deps['@/lib/agent/task-title']=load('lib/agent/task-title.ts')
deps['@/lib/dashboard/task-feed']=load('lib/dashboard/task-feed.ts')
for(const page of ['home','activity']){
 const exports=load(`app/dashboard/(app)/${page}/page.tsx`)
 const rendered=JSON.stringify(await exports.default({searchParams:Promise.resolve(page==='home'?{tab:'radar'}:{})}))
 assert.doesNotMatch(rendered,/Daily step goal review/,page+' must exclude goal jobs before limiting display')
 const query=calls.filter(row=>row.table==='agent_watchers').at(-1)
 assert.ok(query.filters.some(([op,key,value]:any)=>op==='eq'&&key==='telegram_id'&&value==='123'),page+' owner scope')
 assert.ok(query.filters.some(([op,key,value]:any)=>op==='neq'&&key==='type'&&value==='goal_review'),page+' ordinary watches only')
 if(page==='home'){assert.match(rendered,/"radarCount":9/,'home On radar count must be the exact total, not the display rows');assert.match(rendered,/Watch 8/)}
 else assert.match(rendered,/"children":9/,'activity badge must report all nine watches rather than six display rows')
}
console.log('Actual Home/Activity server pages: goals excluded before row limits; owner-bound total watch counts remain exact')
