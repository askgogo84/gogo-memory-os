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
const noop=new Proxy({}, {get:()=>()=>null})
function load(path:string,deps:any){
 const exports:any={}
 runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:(name:string)=>deps[name]||noop,process:{env:{}},console,URL,Request,Response,Buffer,AbortSignal,setTimeout,clearTimeout})
 return exports
}

if(process.env.AUTH_REVIEW_CASE!=='resume'){
 const json={json:(body:any,options:any={})=>new Response(JSON.stringify(body),{status:options.status||200})}
 const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{telegram_id:123,whatsapp_id:'fixture-owner',name:'Fixture'}}),insert:()=>({error:null})}
 let normal=0
 const dash=load('app/api/dashboard/chat/route.ts',{
  'next/server':{NextResponse:json},'@/lib/dashboard/session':{getSession:async()=>({telegramId:'123'})},
  '@/lib/supabase-admin':{supabaseAdmin:{from:()=>q}},'@/lib/agent/actor':{resolveAgentActor:async()=>({legacyTelegramId:123})},
  '@/lib/agent/provider-booking':{otpReply},'@/lib/agent/browser-auth-notice':{humanAuthTakeoverReply:async()=> 'Take control'},
  '@/lib/agent/open-loops':{handleInboxReplyRead:async()=>{normal++;return{text:'ordinary clarification',handledBy:'ordinary'}}},
 })
 for(const text of ['560086','50000','2027']){
  const req=new Request('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid','content-type':'application/json'},body:JSON.stringify({text})})
  const response=await dash.POST(Object.assign(req,{nextUrl:new URL(req.url)}))
  assert.equal((await response.json()).handledBy,'ordinary',`${text}: a bare postal code, amount or year without auth state must retain normal routing`)
 }
 assert.equal(normal,3)
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
