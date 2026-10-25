import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { runInNewContext } from 'node:vm'
import * as authSummary from '../lib/dashboard/browser-auth-summary'

const activityExports:any={}
runInNewContext(ts.transpileModule(fs.readFileSync('lib/dashboard/agent-activity.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports:activityExports,require:(name:string)=>name==='./browser-auth-summary'?authSummary:{},URL})
// Live 2 Oct: a new cloud takeover rendered a previous attempt's HTTP 403.
const old403={toolName:'secure_browser',output:{title:'Old provider page',summary:'HTTP 403',blockReason:'provider_access_limited'}}
const resumedRun={status:'paused',summary:'Choose your account or delivery location.',error:null,metadata:{handoff:{takeoverUrl:'https://takeover.example/',providerUrl:'https://www.swiggy.com/instamart'}},steps:[old403]}
const activeBrowser=activityExports.browserContextForRun(resumedRun)
assert.equal(activeBrowser.providerBlocked,false)
assert.equal(activeBrowser.takeoverAvailable,true)
assert.equal(activeBrowser.summary,resumedRun.summary)
assert.equal(activeBrowser.title,'')
const failedBrowser=activityExports.browserContextForRun({...resumedRun,status:'failed',error:'browser_objective_unverified',summary:'No verified result from this attempt.',metadata:{}})
assert.equal(failedBrowser.summary,'No verified result from this attempt.')
assert.equal(failedBrowser.title,'')
assert.equal(activityExports.browserContextForRun({...resumedRun,metadata:{handoff:{mode:'device',providerUrl:'https://www.swiggy.com/instamart'}}}).providerBlocked,true)

const activity=fs.readFileSync('app/dashboard/(app)/activity/page.tsx','utf8')
const detail=fs.readFileSync('app/dashboard/(app)/activity/[runId]/page.tsx','utf8')
const browser=fs.readFileSync('app/dashboard/(app)/activity/[runId]/browser/page.tsx','utf8')
const handoff=fs.readFileSync('app/api/dashboard/agent/runs/[runId]/handoff/route.ts','utf8')
const shot=fs.readFileSync('app/api/dashboard/agent/runs/[runId]/browser-shot/route.ts','utf8')
const side=fs.readFileSync('components/dashboard/dashboard-nav.tsx','utf8')

assert.match(activity,/What Gogo has done, newest first/)
for (const filter of ['Reminders','Browser','Research','Documents']) assert.match(activity,new RegExp(filter),`Activity must expose ${filter} filter`)
assert.match(detail,/Open browser view/)
assert.match(browser,/Blocked by the provider/)
assert.match(browser,/Take control/)
assert.doesNotMatch(browser,/<input[^>]*(?:otp|one-time|code|password|payment)/i,'Activity browser must not collect authentication secrets')

for(const source of [handoff,shot]){
  assert.match(source,/getSession\(\)/)
  assert.match(source,/telegram_id/)
  assert.match(source,/runId/)
}
assert.match(handoff,/providerUrl/)
assert.match(handoff,/takeoverUrl/)
assert.match(shot,/\/shot/)
assert.match(browser,/handoffActive/)
assert.match(browser,/latest\?\.output\?\.browserState\|\|latest\?\.output/)
assert.match(side,/\/dashboard\/activity/)

console.log('Run 5 Activity / Task Detail dashboard contract passed')


// P1 screenshot egress regression. All cases use synthetic metadata and an
// intercepted in-memory fetch; never open a real browser, provider or sandbox.
const {browserHandoffEndpointUrl} = await import('../lib/agent/browser-handoff-health.ts')
const goodHandoff = 'https://sb-fixture.vercel.run/takeover?token=fixture-only&live=https%3A%2F%2Fexample.com#ignored'
assert.equal(browserHandoffEndpointUrl(goodHandoff, '/shot')?.toString(),
  'https://sb-fixture.vercel.run/shot?token=fixture-only')
for (const hostile of [
  'http://sb-fixture.vercel.run/?token=x',
  'https://sb-fixture.vercel.run:444/?token=x',
  'https://sb-fixture.vercel.run.evil.test/?token=x',
  'https://169.254.169.254/latest/meta-data?token=x',
  'http://127.0.0.1/admin?token=x',
  'https://user:password@sb-fixture.vercel.run/?token=x',
  'https://sb-fixture.vercel.run/?token=x&token=y',
  'https://sb-fixture.vercel.run/?token=',
  'file:///etc/passwd?token=x',
]) assert.equal(browserHandoffEndpointUrl(hostile, '/shot'), null, hostile)

const screenshotExports:any = {}
let screenshotSession:any = {telegramId:'synthetic-owner-7'}
let screenshotRow:any = {metadata_json:{handoff:{takeoverUrl:goodHandoff}}}
let screenshotEqs:Array<[string,string]> = []
let screenshotCalls = 0
let screenshotTransport:any = async () => {throw new Error('unmocked fetch')}
const fakeSupabase = {from(table:string) {
  assert.equal(table,'agent_runs')
  return {
    select(_fields:string) {return this},
    eq(field:string,value:string) {screenshotEqs.push([field,value]); return this},
    async maybeSingle() {return {data:screenshotRow,error:null}},
  }
}}
class FakeNextResponse extends Response {
  static json(value:any, init?:ResponseInit) {return Response.json(value, init)}
}
runInNewContext(
  ts.transpileModule(fs.readFileSync('app/api/dashboard/agent/runs/[runId]/browser-shot/route.ts','utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {
    exports:screenshotExports, URL, Response, Request, AbortSignal, Uint8Array, console,
    fetch:(url:URL, opts:RequestInit)=>{screenshotCalls++; return screenshotTransport(url,opts)},
    require:(id:string)=> {
      if(id==='next/server') return {NextResponse:FakeNextResponse}
      if(id==='@/lib/dashboard/session') return {getSession:async()=>screenshotSession}
      if(id==='@/lib/supabase-admin') return {supabaseAdmin:fakeSupabase}
      if(id==='@/lib/agent/browser-handoff-health') return {browserHandoffEndpointUrl}
      throw new Error('unexpected module '+id)
    },
  },
)
const shotRequest = new Request('https://app.askgogo.in/api/dashboard/agent/runs/synthetic-run/browser-shot')
const shotArgs = {params:Promise.resolve({runId:'synthetic-run'})}
const getShot = () => screenshotExports.GET(shotRequest,shotArgs)
const pngMagic = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])

screenshotRow = {metadata_json:{handoff:{takeoverUrl:'http://169.254.169.254/latest/meta-data?token=bad'}}}
screenshotCalls = 0
assert.equal((await getShot()).status,400,'untrusted persisted host fails before fetch')
assert.equal(screenshotCalls,0,'no private-network fetch attempted')
assert.ok(screenshotEqs.some(([key,val])=>key==='telegram_id'&&val==='synthetic-owner-7'))
assert.ok(screenshotEqs.some(([key,val])=>key==='id'&&val==='synthetic-run'))

screenshotRow = {metadata_json:{handoff:{takeoverUrl:goodHandoff}}}
screenshotTransport = async (url:URL,opts:RequestInit) => {
  assert.equal(url.toString(),'https://sb-fixture.vercel.run/shot?token=fixture-only')
  assert.equal(opts.redirect,'manual','sandbox cannot redirect server to internal host')
  return new Response(pngMagic,{status:200,headers:{'content-type':'image/png'}})
}
screenshotCalls = 0
const shotOk = await getShot()
assert.equal(shotOk.status,200,'trusted screenshot returns image')
assert.equal(shotOk.headers.get('cache-control'),'no-store, max-age=0')
assert.equal(screenshotCalls,1)

screenshotTransport = async (_url:URL,opts:RequestInit) => {
  assert.equal(opts.redirect,'manual')
  return new Response(null,{status:302,headers:{location:'http://169.254.169.254/secret'}})
}
screenshotCalls = 0
assert.equal((await getShot()).status,502,'redirect is not treated as PNG')
assert.equal(screenshotCalls,1,'never follow the redirect')

screenshotTransport = async () => new Response('not an image',{status:200,headers:{'content-type':'text/html'}})
assert.equal((await getShot()).status,502,'HTML does not become PNG')

screenshotTransport = async () => new Response(pngMagic,{status:200,headers:{
  'content-type':'image/png','content-length':String(7*1024*1024),
}})
assert.equal((await getShot()).status,502,'declared oversize screenshot rejected')

screenshotRow = null
screenshotCalls = 0
assert.equal((await getShot()).status,404,'other owner or missing run is not readable')
assert.equal(screenshotCalls,0)
screenshotSession = null
assert.equal((await getShot()).status,401,'anonymous screenshot denied')
assert.equal(screenshotCalls,0)
console.log('P1 screenshot SSRF/owner-boundary regression passed (inert)')
