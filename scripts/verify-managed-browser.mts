import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {runInNewContext} from 'node:vm'
import {browserPageAllowlist} from '../lib/agent/browser-page-network'
import {resolveManagedSession,managedScope,managedLiveViewUrl,managedSessionIsLive,MANAGED_BROWSER_BROKER,type ManagedState} from '../lib/agent/managed-browser'

const project='11111111-1111-4111-8111-111111111111'
const context='22222222-2222-4222-8222-222222222222'
const sessionId='33333333-3333-4333-8333-333333333333'
// Actual Singapore endpoint returned in the 2 Oct cloud smoke test.
const endpoint='wss://connect.apse1.browserbase.com/?secret=fixture'
const env={BROWSERBASE_API_KEY:'fixture-only',BROWSERBASE_PROJECT_ID:project}
let state:ManagedState|null=null, session:any, requests:Array<{path:string;body:any}>=[]
const store={load:async()=>state&&structuredClone(state),save:async(value:ManagedState)=>{state=structuredClone(value)}}
const fetcher:typeof fetch=async(url,init)=>{
  const path=String(url).split('/v1/')[1],body=init?.body?JSON.parse(String(init.body)):null
  requests.push({path,body})
  let data:any
  if(path==='contexts')data={id:context,projectId:project}
  else if(path===`contexts/${context}`)data={id:context,projectId:project}
  else if(path==='sessions')data=session={id:sessionId,projectId:project,contextId:body.browserSettings.context.id,userMetadata:body.userMetadata,status:'RUNNING',expiresAt:new Date(Date.now()+1200000).toISOString(),connectUrl:endpoint}
  else if(path===`sessions/${sessionId}`){if(body)session.status='COMPLETED';data=session}
  else throw Error('unexpected fixture request')
  return new Response(JSON.stringify(data),{status:200})
}
const first=await resolveManagedSession('owner-a','https://www.swiggy.com/instamart',store,env,fetcher)
assert.equal(first.endpoint,endpoint)
assert.equal(first.newSession,true)
const creation=requests.find(r=>r.path==='sessions')!.body
assert.equal(creation.timeout,3600)
assert.equal(creation.proxies[0].geolocation.country,'IN')
assert.equal(creation.browserSettings.context.persist,true)
assert.equal(creation.browserSettings.solveCaptchas,false)
assert.equal(creation.browserSettings.recordSession,false)
assert.equal(creation.browserSettings.logSession,false)
assert.deepEqual(creation.browserSettings.allowedDomains,['swiggy.com'])
assert.ok('bff-gateway.zepto.com' in browserPageAllowlist('https://www.zepto.com/search'),'Zepto address lookup host is explicitly allowed')
assert.ok(!('bff-gateway.zepto.com' in browserPageAllowlist('https://example.com')),'Zepto address lookup grant stays site-scoped')
assert.ok(!JSON.stringify(state).includes('fixture'),'persist only identifiers, never API key or CDP connection URL')
const again=await resolveManagedSession('owner-a','https://www.swiggy.com/instamart',store,env,fetcher)
assert.equal(again.id,first.id)
assert.equal(again.newSession,false)
assert.equal(requests.filter(r=>r.path==='sessions').length,1,'action waves reuse live session')
await assert.rejects(()=>resolveManagedSession('owner-b','https://www.swiggy.com',store,env,fetcher),/owner_mismatch/)
await first.release()
assert.equal(session.status,'COMPLETED')
await resolveManagedSession('owner-a','https://www.swiggy.com/instamart',store,env,fetcher)
assert.equal(requests.filter(r=>r.path==='contexts').length,1,'restart keeps saved login Context')
assert.equal(requests.filter(r=>r.path==='sessions').length,2)
const liveFetcher:typeof fetch=async(url)=>{
  const path=String(url).split('/v1/')[1]
  if(path===`sessions/${sessionId}`)return new Response(JSON.stringify({id:sessionId,projectId:project,userMetadata:{owner:createHash('sha256').update('owner-a').digest('hex')},status:'RUNNING',expiresAt:new Date(Date.now()+600000).toISOString()}))
  if(path===`sessions/${sessionId}/debug?expiresIn=900`)return new Response(JSON.stringify({debuggerFullscreenUrl:`https://debug.browserbase.com/sessions/${sessionId}/fullscreen?token=fixture-only`}))
  throw Error('unexpected live view request')
}
assert.match(await managedLiveViewUrl(sessionId,'owner-a',env,liveFetcher),/^https:\/\/debug\.browserbase\.com\//)
assert.equal(await managedSessionIsLive(sessionId,'owner-a',env,liveFetcher),true)
assert.equal(await managedSessionIsLive(sessionId,'owner-b',env,liveFetcher),false)
assert.equal(await managedSessionIsLive(sessionId,'owner-a',env,async()=>new Response(JSON.stringify({id:sessionId,projectId:project,userMetadata:{owner:createHash('sha256').update('owner-a').digest('hex')},status:'TIMED_OUT',expiresAt:new Date(Date.now()-1000).toISOString()}))),false,'expired Browserbase sessions must offer restore')
assert.match(await managedLiveViewUrl(sessionId,'owner-a',env,async(url)=>String(url).endsWith('/debug?expiresIn=900')?new Response(JSON.stringify({debuggerFullscreenUrl:`https://www.browserbase.com/devtools-internal-compiled/index.html?token=fixture-only`})) : liveFetcher(url)),/^https:\/\/www\.browserbase\.com\//)
await assert.rejects(()=>managedLiveViewUrl('not-a-session','owner-a',env,liveFetcher),/unavailable/)
await assert.rejects(()=>managedLiveViewUrl(sessionId,'owner-b',env,liveFetcher),/owner_mismatch/)
await assert.rejects(()=>managedLiveViewUrl(sessionId,'owner-a',env,async()=>new Response(JSON.stringify({id:sessionId,projectId:'another-project',status:'RUNNING',expiresAt:new Date(Date.now()+600000).toISOString()}))),/project_mismatch/)
await assert.rejects(()=>managedLiveViewUrl(sessionId,'owner-a',env,async(url)=>String(url).endsWith('/debug?expiresIn=900')?new Response(JSON.stringify({debuggerFullscreenUrl:'https://evil.example/steal'})):liveFetcher(url)),/invalid/)
for(const value of ['http://127.0.0.1','http://localhost','http://169.254.169.254','http://[::1]','https://a:b@example.com','file:///tmp/foo'])assert.throws(()=>managedScope(value))

state=null;requests=[]
await resolveManagedSession('import-owner','https://www.swiggy.com',store,{...env,GOGO_BROWSER_CONTEXT_IMPORTS:JSON.stringify({'import-owner':{'swiggy.com':context}})},fetcher)
assert.equal(requests.filter(r=>r.path==='contexts').length,0,'explicit owner/site import restores authorized trial login')
assert.equal(requests[0].path,`contexts/${context}`,'import verifies project ownership')
state=null;requests=[]
await resolveManagedSession('different-owner','https://www.swiggy.com',store,{...env,GOGO_BROWSER_CONTEXT_IMPORTS:JSON.stringify({'import-owner':{'swiggy.com':context}})},fetcher)
assert.equal(requests.filter(r=>r.path==='contexts').length,1,'another owner never receives imported profile')

state=null;let calls=0
const unavailable:typeof fetch=async()=>{calls++;throw Error('request outcome unknown')}
await assert.rejects(()=>resolveManagedSession('owner','https://example.com',store,env,unavailable),/provider_unavailable/)
await assert.rejects(()=>resolveManagedSession('owner','https://example.com',store,env,unavailable),/outcome_unknown/)
assert.equal(calls,1,'ambiguous creation must not be blindly retried')

// Execute the real broker: cloud Chromium must retain the provider resource
// boundary even though its requests do not originate in the Vercel sandbox.
let route:any,socketRoute:any,protectedPages=0,ready=false
const contextMock={route:async(_pattern:string,fn:any)=>{route=fn},routeWebSocket:async(_pattern:string,fn:any)=>{socketRoute=fn},pages:()=>[{}],on:()=>{},newCDPSession:async()=>({send:async(method:string,args:any)=>{assert.equal(method,'Network.setBypassServiceWorker');assert.equal(args.bypass,true);protectedPages++}})}
await runInNewContext(MANAGED_BROWSER_BROKER,{
  URL,JSON,console,process:{env:{GOGO_BROWSER_CDP_URL:endpoint,GOGO_BROWSER_ALLOWED_HOSTS:JSON.stringify(['www.swiggy.com','*.www.swiggy.com','media-assets.swiggy.com']),GOGO_BROWSER_SESSION_ID:sessionId},pid:123,exit:()=>{throw Error('unexpected broker exit')}},setInterval:()=>0,
  require:(name:string)=>name==='playwright'?{chromium:{connectOverCDP:async(value:string)=>{assert.equal(value,endpoint);return {contexts:()=>[contextMock],on:()=>{}}}}}:{writeFileSync:()=>{ready=true}},
})
assert.equal(ready,true);assert.equal(protectedPages,1)
for(const [url,expected] of [['https://www.swiggy.com/x',true],['https://media-assets.swiggy.com/x',true],['https://evil.example/steal',false],['http://169.254.169.254/',false],['https://www.swiggy.com.evil.example/',false],['https://user:password@www.swiggy.com/',false]] as const){
  let result:boolean|undefined
  await route({request:()=>({url:()=>url}),continue:()=>{result=true},abort:()=>{result=false}})
  assert.equal(result,expected,url)
  result=undefined
  await socketRoute({url:()=>url.replace('https:','wss:'),connectToServer:()=>{result=true},close:()=>{result=false}})
  assert.equal(result,expected,'websocket '+url)
}
console.log('PASS: managed browser owner/site isolation, profile restore, bounded India session, no blind retry, resource restrictions')

// Captured from the public DOM on 3 Oct while diagnosing production electronics
// searches. Test the real broker against the exact stylesheet/bootstrap hosts,
// not a mock claiming that a provider journey succeeded.
for(const [site,resources] of [
 ['https://www.amazon.in/',[
  'https://m.media-amazon.com/images/I/11mVszy8FIL.js?AUIClients/AmazonRushAssetLoader',
  'https://images-na.ssl-images-amazon.com/images/I/215h87l68bL.js',
 ]],
 ['https://www.goindigo.in/',[
  'https://app-prod-skyplus6e.goindigo.in/booking/remoteEntry.js',
  'https://api-prod-skyplus.goindigo.in/bookingwidgetsearchengine/search?prefix=Bengaluru&limit=10',
 ]],
 // Captured GET ERR in the live Zomato cloud Network panel on3Oct.
 ['https://www.zomato.com/',[
  'https://b.zmtcdn.com/web/logo/low/6d289d7188aeb23d3c0c76b74915b9931587822718.png',
  'https://b.zmtcdn.com/data/o2_assets/e468d0e2ffd9aeeb9a232df7461a27fb1743099002.woff2',
 ]],
 ['https://www.flipkart.com/',[
  'https://static-assets-web.flixcart.com/batman-returns/batman-returns/p/de025efa02a5f190c3b98c1fb29aed1b/DesktopComponents.css',
  'https://rukminim2.flixcart.com/fk-p-flap/52/44/image/d2ecfddf891a3922.png?q=80',
 ]],
] as const){
 await runInNewContext(MANAGED_BROWSER_BROKER,{
  URL,JSON,console,process:{env:{GOGO_BROWSER_CDP_URL:endpoint,GOGO_BROWSER_ALLOWED_HOSTS:JSON.stringify(Object.keys(browserPageAllowlist(site))),GOGO_BROWSER_SESSION_ID:sessionId},pid:123,exit:()=>{throw Error('unexpected broker exit')}},setInterval:()=>0,
  require:(name:string)=>name==='playwright'?{chromium:{connectOverCDP:async()=>({contexts:()=>[contextMock],on:()=>{}})}}:{writeFileSync:()=>{}},
 })
 for(const url of resources){
  let permitted=false
  await route({request:()=>({url:()=>url}),continue:()=>{permitted=true},abort:()=>{permitted=false}})
  assert.equal(permitted,true,site+' must load observed resource '+new URL(url).hostname)
  assert.ok(!(new URL(url).hostname in browserPageAllowlist('https://example.com')),'resource grant is not global')
  assert.ok(!(new URL(url).hostname in browserPageAllowlist(site.replace('.com/','.com.evil.example/').replace('.in/','.in.evil.example/'))),'lookalikes cannot inherit resources')
 }
 let unrelatedAllowed=true
 await route({request:()=>({url:()=> 'https://unrelated.example/collect'}),continue:()=>{unrelatedAllowed=true},abort:()=>{unrelatedAllowed=false}})
 assert.equal(unrelatedAllowed,false,'provider resources do not authorize arbitrary egress')
}
console.log('PASS: observed Amazon/Flipkart/IndiGo resources load through the actual scoped broker')
