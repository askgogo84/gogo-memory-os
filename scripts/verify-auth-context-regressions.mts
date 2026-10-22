import * as sentinel from '../lib/agent/sentinel'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
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
