import * as sentinel from '../lib/agent/sentinel'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {createHash} from 'node:crypto'
import {otpReply} from '../lib/agent/provider-booking'
import * as evidence from '../lib/agent/browser-evidence'
import {detectHumanAuthGate} from '../lib/agent/browser-auth-gate'
import {sanitizeBrowserReadDiagnostics} from '../lib/agent/browser-read-diagnostics'
import {browserPageAllowlist} from '../lib/agent/browser-page-network'

process.env.NEXT_PUBLIC_SUPABASE_URL='https://auth-fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only'
const {shouldWithholdAuthenticationCode}=await import('../lib/agent/browser-auth-notice')
const beforeFetch=globalThis.fetch
let authRows:any[]=[]
let stepRows:any[]=[]
globalThis.fetch=async input=>{
 const target=new URL(String(input));assert.equal(target.origin,'https://auth-fixture.supabase.co')
 assert.equal(target.searchParams.get('telegram_id'),'eq.123','authentication context must be owner-scoped')
 if(target.pathname.endsWith('/agent_steps')){
  assert.equal(target.searchParams.get('run_id'),'in.(owned-instagram-run)','generic OTP evidence must belong to the current owner-selected run')
  assert.equal(target.searchParams.get('tool_name'),'eq.secure_browser')
  assert.equal(target.searchParams.get('status'),'eq.failed')
  assert.equal(target.searchParams.get('error'),'eq.human_auth_required')
  assert.equal(target.searchParams.get('output_json->>authReason'),'eq.otp')
  assert.match(target.searchParams.get('completed_at')||'',/^gte\./)
  assert.ok(target.searchParams.getAll('completed_at').some(value=>value.startsWith('lte.')))
  return new Response(JSON.stringify(stepRows),{headers:{'Content-Type':'application/json'}})
 }
 assert.equal(target.searchParams.get('type'),'eq.secure_browser')
 assert.equal(target.searchParams.get('status'),'in.(paused,running)')
 return new Response(JSON.stringify(authRows),{headers:{'Content-Type':'application/json'}})
}
const noop=new Proxy({}, {get:()=>()=>null})
function load(path:string,deps:any){
 const exports:any={}
 runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:(name:string)=>name==='./sentinel'?sentinel:deps[name]||noop,process:{env:{}},console,URL,Request,Response,Buffer,AbortSignal,setTimeout,clearTimeout})
 return exports
}

try{
if(process.env.AUTH_REVIEW_CASE!=='resume'){
 const json={json:(body:any,options:any={})=>new Response(JSON.stringify(body),{status:options.status||200})}
 const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{telegram_id:123,whatsapp_id:'fixture-owner',name:'Fixture'}}),insert:()=>({error:null})}
 let normal=0
 const dash=load('app/api/dashboard/chat/route.ts',{
  'next/server':{NextResponse:json},'@/lib/dashboard/session':{getSession:async()=>({telegramId:'123'})},
  '@/lib/supabase-admin':{supabaseAdmin:{from:()=>q}},'@/lib/agent/actor':{resolveAgentActor:async()=>({legacyTelegramId:123})},
  '@/lib/agent/provider-booking':{otpReply},'@/lib/agent/browser-auth-notice':{shouldWithholdAuthenticationCode,humanAuthTakeoverReply:async()=> 'Take control'},
  '@/lib/agent/open-loops':{handleInboxReplyRead:async()=>{normal++;return{text:'ordinary clarification',handledBy:'ordinary'}}},
 })
 for(const text of ['560086','50000','2027']){
  const req=new Request('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid','content-type':'application/json'},body:JSON.stringify({text})})
  const response=await dash.POST(Object.assign(req,{nextUrl:new URL(req.url)}))
  assert.equal((await response.json()).handledBy,'ordinary',`${text}: a bare postal code, amount or year without auth state must retain normal routing`)
 }
 assert.equal(normal,3)
 for(const key of ['login_code','booking_otp'])for(const status of ['paused','running']){
  authRows=[{status,metadata_json:{[key]:{requested_at:new Date(Date.now()-30_000).toISOString()}}}]
  assert.equal(await shouldWithholdAuthenticationCode(123,'482913'),true)
 }
 for(const row of [{metadata_json:{handoff:{},state:'delivery_location_required'}},{metadata_json:{login_code:{requested_at:new Date(Date.now()-11*60_000).toISOString()}}},{metadata_json:{booking_otp:{requested_at:new Date(Date.now()+60_000).toISOString()}}}]){
  authRows=[row];assert.equal(await shouldWithholdAuthenticationCode(123,'560086'),false)
 }
 authRows=[]
 for(const text of ['otp 482913','code is 4829 13','the code is 482913','otp482913','code482913','OTP482913'])assert.equal(await shouldWithholdAuthenticationCode(123,text),true)
 // Saved-password providers such as Instagram persist the OTP reason in the
 // secure-browser step, without the phone-login/booking metadata markers.
 authRows=[{id:'owned-instagram-run',status:'paused',metadata_json:{handoff:{}}}]
 stepRows=[{id:'owned-otp-step'}]
 assert.equal(await shouldWithholdAuthenticationCode(123,'482913'),true,'generic provider OTP step evidence must withhold bare codes')
 const genericRequest=new Request('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid','content-type':'application/json'},body:JSON.stringify({text:'482913'})})
 const genericResponse=await dash.POST(Object.assign(genericRequest,{nextUrl:new URL(genericRequest.url)}))
 assert.equal((await genericResponse.json()).handledBy,'human-auth-required','the actual dashboard boundary must quarantine generic provider codes')
 stepRows=[]
 assert.equal(await shouldWithholdAuthenticationCode(123,'560086'),false,'a generic handoff without an OTP step is not authentication')
 authRows=[]
 const readBeforeFailure=globalThis.fetch
 globalThis.fetch=async()=>new Response(JSON.stringify({message:'fixture database unavailable'}),{status:400,headers:{'Content-Type':'application/json'}})
 await assert.rejects(shouldWithholdAuthenticationCode(123,'482913'),/^Error: authentication_context_lookup_failed$/,'unavailable auth context must not send a possible code into ordinary routing')
 authRows=[{id:'owned-instagram-run',status:'paused',metadata_json:{handoff:{}}}]
 globalThis.fetch=async input=>new URL(String(input)).pathname.endsWith('/agent_steps')
  ?new Response(JSON.stringify({message:'fixture step lookup unavailable'}),{status:400,headers:{'Content-Type':'application/json'}})
  :readBeforeFailure(input)
 await assert.rejects(shouldWithholdAuthenticationCode(123,'482913'),/^Error: authentication_context_lookup_failed$/,'generic provider auth lookup must also fail closed')
 authRows=[]
 globalThis.fetch=readBeforeFailure
 console.log('Ordinary numeric dashboard replies retain normal clarification routing')
}

if(process.env.AUTH_REVIEW_CASE!=='numbers'){
 const signedIn={url:'https://www.swiggy.com/my-account/orders',title:'My orders',text:'Your orders: fixture order delivered',forms:[],controls:[]}
 let vaultAttempts=0
 const commands:any[]=[]
 const computer=load('lib/agent/secure-computer.ts',{
  './browser-evidence':evidence,'./browser-auth-gate':{detectHumanAuthGate},
  './browser-read-diagnostics':{sanitizeBrowserReadDiagnostics},'./browser-page-network':{browserPageAllowlist},
  './browser-proxy':{resolveBrowserProxy:()=>null,proxyAllowlistHost:()=>null},
  './managed-browser':{managedBrowserEnabled:()=>false,ensureManagedBrowser:async()=>null},
  './persistent-commerce-browser':{ensurePersistentCommerceBrowser:async()=>{}},
  './browser-owner-lock':{acquireBrowserOwnerLock:async()=>Object.assign(async()=>{}, {reserveHandoff:async()=> 'fixture-reservation'})},
  './secure-browser-bootstrap':{browserSandboxNameFor:()=> 'fixture-sandbox',ensureBrowserRuntime:async()=>{}},
  './secure-browser-redaction':{redactBrowserSensitiveText:(text:string)=>text},
  './browser-location-gate':{needsBrowserDeliveryLocation:()=>false},
  './planner-provider':{completeAgentPlanPrompt:async()=>JSON.stringify({actions:[]}),completeVisionPrompt:async()=> '{}'},
  '@/lib/vault/credential-store':{resolveVaultCredentialForBrowser:async()=>null,recordVaultBrowserOutcome:async()=>{}},
  '@/lib/vault/session-store':{listVaultSessions:async()=>[{status:'human_challenge',domain:'swiggy.com'}],upsertVaultSession:async()=>{}},
  '@/lib/vault/providers':{findVaultProviderForDomain:()=>({key:'swiggy',domains:['swiggy.com'],phoneOnly:true}),phoneLoginProviderForDomain:()=>({key:'swiggy',domains:['swiggy.com']})},
  '@vercel/sandbox':{Sandbox:{getOrCreate:async()=>({expiresAt:new Date(Date.now()+1200000),extendTimeout:async()=>{},writeFiles:async()=>{},updateNetworkPolicy:async()=>{},stop:async()=>{},runCommand:async(cmd:any)=>{
   if(cmd.args.some((value:unknown)=>String(value).includes('gogo-vault-login.js'))){vaultAttempts++;return{exitCode:0,stdout:async()=>JSON.stringify({...signedIn,vaultLogin:{usernameFilled:false,passwordFilled:false}})}}
   const payload=JSON.parse(Buffer.from(cmd.args[3],'base64').toString('utf8'));commands.push(payload)
   return{exitCode:0,stdout:async()=>JSON.stringify({...signedIn,actions:[]})}
  }})}},
 })
 try{await computer.runSecureBrowser({userId:'fixture',runId:'fixture-run',url:signedIn.url,objective:'Read my latest order',mode:'read',phoneLogin:{number:'9876543210',telegramId:'123'},reserveHumanHandoff:true,keepAlive:true,sessionTaskId:'fixture-run',resumePage:true})}catch(error){assert.match(String(error),/browser_objective_unverified|browser_planning_failed/,'the mocked planner supplies no completion evidence')}
 assert.equal(vaultAttempts,0,'a resumed authenticated page must not retry Vault and falsely return login_unavailable')
 assert.ok(commands.length>=1)
 assert.equal(commands[0].reusePage,true,'resume inspects the same open page')
 console.log('Successful human authentication preserves the same page without speculative Vault retry')
}
}finally{globalThis.fetch=beforeFetch}

// Execute the native bearer boundary itself; a valid token is not current owner authority.
{
 const token='fixture-mobile-token-'.repeat(3),userId='11111111-1111-4111-8111-111111111111',sessionId='22222222-2222-4222-8222-222222222222'
 const liveSession={id:sessionId,user_id:userId,platform:'ios',expires_at:new Date(Date.now()+60_000).toISOString(),revoked_at:null}
 const liveUser={id:userId,telegram_id:'123',whatsapp_id:'+15555550123',name:'Fixture',access_status:'active'}
 async function mobileProbe(options:any={}){
  const calls:any[]=[],session=options.session===null?null:{...liveSession,...options.session},user=options.user===null?null:{...liveUser,...options.user}
  const db={from(table:string){calls.push([table,'from']);let writing=false
   const q:any={select:(fields:string)=>{calls.push([table,'select',fields]);return q},eq:(key:string,value:any)=>{calls.push([table,'eq',key,value]);return q},is:(key:string,value:any)=>{calls.push([table,'is',key,value]);return q},gt:(key:string,value:any)=>{calls.push([table,'gt',key,value]);return q},update:(body:any)=>{writing=true;calls.push([table,'update',body]);if(options.touchSyncThrow)throw new Error('fixture touch unavailable');return q},
    maybeSingle:async()=>{if(options.throwTable===table)throw new Error('fixture lookup unavailable');return{data:table==='mobile_sessions'?session:user,error:options.errorTable===table?{code:'FIXTURE',message:'fixture private error'}:null}},
    then:(yes:any,no:any)=>options.touchReject?Promise.reject(new Error('fixture touch rejection')).then(yes,no):Promise.resolve({data:null,error:options.touchError?{code:'FIXTURE',message:'fixture private touch error'}:null}).then(yes,no)}
   return q}}
  const mobile=load('lib/mobile-auth/session.ts',{'crypto':{createHash},'@/lib/supabase-admin':{supabaseAdmin:db}})
  const request=new Request('https://fixture.invalid/api/agent/home',{headers:options.noHeader?{}:{authorization:options.header??`Bearer ${token}`}})
  const actor=await mobile.resolveMobileActor(request);await Promise.resolve();await Promise.resolve()
  return{actor,calls,mobile,request}
 }
 const failed:string[]=[]
 async function group(name:string,test:()=>Promise<void>){try{await test();console.log(`Mobile boundary PASS: ${name}`)}catch(error){failed.push(name);console.error(`Mobile boundary FAIL: ${name}: ${String(error)}`)}}
 const noTouch=(result:any)=>assert.equal(result.calls.filter((c:any)=>c[1]==='update').length,0,'denied sessions must not touch last_seen')
 await group('blocked and unreadable current owner',async()=>{
  for(const options of [{user:{access_status:'blocked'}},{user:{access_status:undefined}},{user:{access_status:'unknown'}},{user:null},{errorTable:'users'},{throwTable:'users'},{errorTable:'mobile_sessions'},{throwTable:'mobile_sessions'}]){const r=await mobileProbe(options);assert.equal(r.actor,null);noTouch(r)}
 })
 await group('exact safe owner and returned UUID binding',async()=>{
  for(const value of ['9007199254740993','9007199254740992',9007199254740992,' 123','123 ','+123','00123','1e3','0',0,-0,1.5,true,null,{},['123']]){const r=await mobileProbe({user:{telegram_id:value}});assert.equal(r.actor,null,`must deny ${String(value)}`);noTouch(r)}
  for(const user of [{id:'foreign-owner'},{id:123},{whatsapp_id:null},{whatsapp_id:'  '},{whatsapp_id:{}}]){const r=await mobileProbe({user});assert.equal(r.actor,null);noTouch(r)}
 })
 await group('invalid session cannot read private user',async()=>{
  for(const session of [null,{user_id:''},{user_id:123},{id:''},{id:123},{user_id:' '+userId},{platform:'web'},{revoked_at:new Date().toISOString()},{revoked_at:undefined},{expires_at:'invalid'},{expires_at:null},{expires_at:new Date(Date.now()-1).toISOString()}]){const r=await mobileProbe({session});assert.equal(r.actor,null);assert.equal(r.calls.filter((c:any)=>c[0]==='users').length,0);noTouch(r)}
  for(const options of [{noHeader:true},{header:'Basic fixture'},{header:'Bearer short'}]){const r=await mobileProbe(options);assert.equal(r.actor,null);assert.equal(r.calls.length,0)}
 })
 await group('safe positive negative null-status platform and exact predicates',async()=>{
  for(const value of ['123','-123','9007199254740991','-9007199254740991',123,-123])for(const platform of ['ios','android'])for(const status of ['active',null]){
   const r=await mobileProbe({user:{telegram_id:value,access_status:status},session:{platform}})
   assert.equal(r.actor?.legacyTelegramId,Number(value));assert.equal(r.actor?.userId,userId);assert.equal(r.actor?.platform,platform)
   assert.ok(r.calls.some((c:any)=>c[0]==='users'&&c[1]==='select'&&c[2].split(/,\s*/).includes('access_status')))
   assert.ok(r.calls.some((c:any)=>c[0]==='users'&&c[1]==='eq'&&c[2]==='id'&&c[3]===userId))
   assert.ok(r.calls.some((c:any)=>c[0]==='mobile_sessions'&&c[1]==='eq'&&c[2]==='session_token_hash'&&c[3]===createHash('sha256').update(token).digest('hex')))
   assert.equal(r.calls.filter((c:any)=>c[1]==='update').length,1)
   const touchAt=r.calls.findIndex((c:any)=>c[1]==='update'),touch=r.calls.slice(touchAt)
   assert.ok(touch.some((c:any)=>c[1]==='eq'&&c[2]==='id'&&c[3]===sessionId));assert.ok(touch.some((c:any)=>c[1]==='eq'&&c[2]==='user_id'&&c[3]===userId));assert.ok(touch.some((c:any)=>c[1]==='is'&&c[2]==='revoked_at'&&c[3]===null))
  }
 })
 await group('best effort last_seen errors never authenticate denied owner or break valid owner',async()=>{
  for(const options of [{touchError:true},{touchSyncThrow:true},{touchReject:true}]){const r=await mobileProbe(options);assert.equal(r.actor?.legacyTelegramId,123)}
 })
 await group('actual agent bearer branch denies without dashboard fallback',async()=>{
  class FixtureResponse extends Response{static json(body:any,options:any={}){return new FixtureResponse(JSON.stringify(body),options)}}
  for(const options of [{user:{access_status:'blocked'}},{user:{telegram_id:'9007199254740993'}},{user:{telegram_id:'-123'},session:{platform:'android'}}]){
   const r=await mobileProbe(options)
   const boundary=load('lib/agent/session.ts',{'next/server':{NextResponse:FixtureResponse},'@/lib/dashboard/session':{getSession:async()=>{throw new Error('bearer must never fall back to dashboard')}},'@/lib/dashboard/guard':{verifySameOrigin:()=>null},'@/lib/mobile-auth/session':r.mobile})
   const result=await boundary.requireAgentSession(r.request)
   if(r.actor){assert.equal(result.telegramId,'-123');assert.equal(result.userId,userId);assert.equal(result.surface,'android')}
   else{assert.equal(result.status,401);assert.equal((await result.json()).error,'unauthorized');noTouch(r)}
  }
 })
 if(failed.length)throw new Error(`Mobile boundary failures: ${failed.join('; ')}`)
}
