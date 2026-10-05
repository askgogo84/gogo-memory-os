import { sanitizeBrowserReadDiagnostics } from '../lib/agent/browser-read-diagnostics'
import assert from 'node:assert/strict'
import { browserFailureSummary } from '../lib/agent/browser-failure-notice'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as providers from '../lib/commerce/providers'

process.env.COMMERCE_SWIGGY_ENABLED='false'
process.env.COMMERCE_ZEPTO_ENABLED='false'
const tables:Record<string,any[]>={agent_runs:[],agent_steps:[],agent_activity:[],agent_permissions:[]}
let sequence=0,failLink=false,blocked=false,authenticated=true,locked=false,owner='42',browserCalls=0,releaseCalls=0
const db={from(table:string){
  const filters:Array<(r:any)=>boolean>=[];let patch:any,insert:any
  const execute=()=>{
    if(insert){const row={id:'row-'+(++sequence),...insert};tables[table].push(row);return {data:structuredClone(row),error:null}}
    const row=tables[table].find(r=>filters.every(f=>f(r)))
    if(patch&&failLink&&patch.metadata_json?.state==='browser_research')return {data:null,error:{message:'fixture'}}
    if(row&&patch)Object.assign(row,patch)
    return {data:row?structuredClone(row):null,error:null}
  }
  const q:any={select(){return q},eq(k:string,v:any){filters.push(r=>r[k]===v);return q},is(k:string,v:any){filters.push(r=>k==='metadata_json->handoff'?r.metadata_json?.handoff==null:r[k]===v);return q},contains(k:string,v:any){filters.push(r=>k==='metadata_json'?r.metadata_json?.handoff?.token===v.handoff?.token:false);return q},order(){return q},limit(){return q},insert(p:any){insert=p;return q},update(p:any){patch=p;return q},async maybeSingle(){return execute()},async single(){return execute()},then(resolve:any,reject:any){return Promise.resolve(execute()).then(resolve,reject)}}
  return q
}}
function load(file:string,deps:Record<string,any>){const exports:any={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process,Date,URL,console,require(name:string){if(name==='./browser-read-diagnostics')return {sanitizeBrowserReadDiagnostics};if(name in deps)return deps[name];throw Error(name)}});return exports}
const tasks=load('lib/commerce/task.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'./providers':providers})
let browserResult:any={status:'blocked',url:'https://blinkit.com/',title:'Sign in',summary:'Sign in on the provider page.',forms:[],actions:[],blockReason:'human_auth_required',authReason:'otp',handoffReservation:'fixture'}
let permissionAllowed=true
const browserParams:any[]=[]
const command=load('lib/agent/browser-command.ts',{
  './browser-failure-notice':{browserFailureSummary},
  'node:crypto':{},'@/lib/supabase-admin':{supabaseAdmin:db},'./typed-object-context':{rememberTypedObjects:async()=>{}},
  '@/lib/bot/memory-redaction':{redactSecretShapedText:(s:string)=>s},'./policy':{evaluateAgentExecutionPolicy:()=>({allowed:permissionAllowed,reason:'disabled'})},
  './sentinel':{evaluateAgentSentinel:()=>({allowed:true})},'./secure-computer':{runSecureBrowser:async(p:any)=>{assert.equal(p.mode,'read');assert.equal(p.keepAlive,true);assert.equal(p.userId,'user-42');assert.ok(p.sessionTaskId);browserParams.push(p);assert.match(p.objective,/Do not add, remove or change cart/);browserCalls++;return structuredClone(browserResult)}},
  '@/lib/vault/connect-link':{},'@/lib/vault/providers':{},'./approval-binding':{},'@/lib/services/reporting-directive':{},'@/lib/commerce/task':tasks,
  './provider-browser-handoff':{startProviderBrowserHandoff:async()=>({takeoverUrl:'https://private.example/?token=secret',releaseUrl:'https://private.example/release?token=secret'}),cancelBrowserHandoffReservation:async()=>{}},
  './browser-handoff':{releaseBrowserHandoff:async()=>{releaseCalls++}},
  './browser-handoff-health':{browserHandoffIsLive:async()=>false},
})
const browser=load('lib/commerce/browser.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/agent/browser-command':command,'./task':tasks})
const grocery=load('lib/agent/grocery-comparison.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/commerce/task':tasks})
const route=load('app/api/commerce/tasks/[runId]/browser/route.ts',{
  'next/server':{NextResponse:{json:(body:any,opts:any)=>({body,status:opts?.status||200})}},
  '@/lib/agent/session':{requireAgentMutationOrigin:()=>blocked?{status:403}:null,requireAgentSession:async()=>authenticated?{telegramId:owner,surface:'web'}:{status:401},isAgentSession:(s:any)=>!!s.telegramId},
  '@/lib/agent/actor':{resolveAgentActor:async()=>({userId:'user-'+owner,legacyTelegramId:Number(owner),whatsappId:'fixture',name:'Fixture'})},
  '@/lib/agent/brain-runtime-guard':{acquireBrainUserLease:async()=>locked?null:{ownerToken:'fixture'},releaseBrainUserLease:async()=>true},
  '@/lib/commerce/task':tasks,'@/lib/commerce/browser':browser,
})
const start=await grocery.tryGroceryComparison({telegramId:42,text:'Compare grocery prices for Amul Taaza toned milk, 1 litre'})
const id=start.runId
const ctx={params:Promise.resolve({runId:id})}
const call=(provider='blinkit',action='read')=>route.POST({json:async()=>({provider,action})},ctx)
blocked=true;assert.equal((await call()).status,403);blocked=false
authenticated=false;assert.equal((await call()).status,401);authenticated=true
owner='43';assert.equal((await call()).status,404);owner='42'
locked=true;assert.equal((await call()).status,409);locked=false
assert.equal((await call('https://evil.example')).status,400)
assert.equal((await call('swiggy')).status,409,'food cannot substitute for a grocery comparison')
assert.equal(browserCalls,0)
const paused=await call()
assert.equal(paused.status,200,'browser works while both MCP flags are disabled')
assert.equal(paused.body.runId,id)
assert.equal(paused.body.browserReads.length,1)
const childId=paused.body.browserReads[0].runId
assert.equal(paused.body.browserReads[0].status,'paused')
assert.match(paused.body.summary,/Sign in/)
assert(!JSON.stringify(paused.body).includes('token=secret'),'private takeover credentials are not in comparison status')
assert.equal(tables.agent_runs.length,2)
const chat=await grocery.tryGroceryComparison({telegramId:42,text:'Show my grocery comparison.'})
assert(chat.text.startsWith(paused.body.summary),'WhatsApp renders the same saved browser result')
permissionAllowed=false
assert.equal((await call()).status,409)
assert.equal(browserCalls,1,'resume rechecks permission before any provider call')
permissionAllowed=true
browserResult={...browserResult,status:'completed',summary:'The product page displays Amul Taaza 1 litre. Delivery fees are not shown.'}
const finished=await call()
assert.equal(finished.status,200)
assert.equal(finished.body.runId,id)
assert.equal(finished.body.browserReads[0].runId,childId,'auth resumes the same browser step')
assert.equal(finished.body.browserReads[0].status,'completed')
assert.match(finished.body.summary,/not a verified comparison/)
assert.equal(releaseCalls,1,'human profile released only after permissions pass')
await call();assert.equal(browserCalls,2,'repeat click does not rerun completed browser work')
assert.equal(browserParams[0].resumePage,false)
assert.equal(browserParams[1].resumePage,true,'auth continuation reuses the live page')
const manual=await call('blinkit','take_control')
assert.equal(manual.status,200)
assert.equal(manual.body.browserReads[0].runId,childId)
assert.equal(manual.body.browserReads[0].status,'paused','location selection keeps the same task')
assert.equal(browserCalls,2,'human takeover does not run agent actions')
const child=tables.agent_runs.find(r=>r.id===childId)
child.status='paused'
tables.agent_runs.find(r=>r.id===id).metadata_json.state='closed'
await assert.rejects(()=>command.resumePausedBrowserRun({actor:{legacyTelegramId:42},runId:childId}),/commerce_parent_unavailable/)
assert.equal(browserCalls,2,'closed comparison cannot resurrect its browser task')
// A failed parent link must cancel the unexecuted child, never visit the provider.
tables.agent_runs.find(r=>r.id===id).metadata_json.state='provider_connection_required'
tables.agent_runs.find(r=>r.id===id).metadata_json.browser_runs={}
failLink=true;assert.equal((await call('zepto')).status,409);failLink=false
assert.equal(tables.agent_runs.at(-1).status,'cancelled')
assert.equal(browserCalls,2)
// Missing provider evidence stays a blocker, never a success message.
browserResult={...browserResult,status:'blocked',blockReason:'provider_access_limited',summary:'Provider access is blocked.',authReason:null,handoffReservation:undefined}
const denied=await call('instamart')
assert.equal(denied.status,200)
assert.match(denied.body.summary,/Provider access is blocked/)
assert.equal(denied.body.browserReads[0].status,'paused')
const locationChild=denied.body.browserReads[0].runId
browserResult={...browserResult,blockReason:'delivery_location_required',summary:'Choose your delivery location, then resume this same task.',handoffReservation:'location-reservation'}
const locationPause=await call('instamart')
assert.equal(locationPause.status,200)
assert.equal(locationPause.body.browserReads[0].runId,locationChild)
assert.equal(locationPause.body.browserReads[0].status,'paused')
assert.match(locationPause.body.summary,/delivery location/)
assert.doesNotMatch(locationPause.body.summary,/provider limited|paused before authentication/i)
assert.ok(tables.agent_runs.find(r=>r.id===locationChild).metadata_json.handoff)
assert(!JSON.stringify(locationPause.body).includes('token=secret'))
const locationChat=await grocery.tryGroceryComparison({telegramId:42,text:'Show my grocery comparison.'})
assert(locationChat.text.startsWith(locationPause.body.summary),'missing-location state is shared by chat and dashboard')
console.log('PASS: real commerce route → owned linked browser → auth pause/resume → shared saved result; MCP disabled, policy/owner/CSRF/lease enforced, no cart writes or false completion')
