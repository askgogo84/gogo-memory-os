import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { detectHumanAuthGate } from '../lib/agent/browser-auth-gate'

function load(file: string, mocks: Record<string, any>, extra='', globals:Record<string,any>={}) {
  const source=readFileSync(new URL(`../lib/agent/${file}`,import.meta.url),'utf8')+extra
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const exports:any={}
  runInNewContext(code,{exports,require:(name:string)=>mocks[name]||{},process:{env:{}},Buffer,URL,console,AbortSignal,...globals})
  return exports
}

const handoff={takeoverUrl:'https://browser.example/?token=fixture',releaseUrl:'https://browser.example/release?token=fixture'}
let stopped=0,started=0,released=0
let ticketPage={title:'Sign in – Provider',text:'Check your phone and tap Yes'}
const sandbox={writeFiles:async()=>{},updateNetworkPolicy:async()=>{},stop:async()=>{stopped++},
  runCommand:async()=>({exitCode:0,stdout:async()=>JSON.stringify(ticketPage)})}
const reader=load('secure-ticket-reader.ts',{
  '@vercel/sandbox':{Sandbox:{getOrCreate:async()=>sandbox}},
  './browser-auth-gate':{detectHumanAuthGate},
  './provider-challenge':{detectProviderChallenge:()=>({challenged:false})},
  './secure-browser-bootstrap':{browserSandboxNameFor:()=> 'fixture',ensureBrowserRuntime:async()=>{}},
  './provider-browser-handoff':{startProviderBrowserHandoff:async()=>{started++;return handoff}},
  './browser-handoff':{releaseBrowserHandoff:async(_url:string,options:any)=>{assert.equal(options.allowExpired,true);released++;return {ok:false,expired:true}}},
})
const paused=await reader.readProviderTicketPage({userId:'user',url:'https://provider.example/ticket'})
assert.equal(paused.authReason,'device_approval')
assert.equal(paused.authHandoff, handoff)
assert.equal(stopped,0,'human takeover must retain the sandbox')
ticketPage={title:'Your ticket',text:'Confirmed ticket ABC'}
const resumed=await reader.readProviderTicketPage({userId:'user',url:'https://provider.example/ticket',resumeHandoff:paused.authHandoff})
assert.equal(released,1,'explicit continuation releases the profile lock')
assert.equal(resumed.status,'completed')
assert.equal(stopped,1,'completed read cleans up the sandbox')
ticketPage={title:'Sign in',text:'Check your phone'}
await reader.readProviderTicketPage({userId:'user',url:'https://provider.example/ticket',humanHandoff:false})
assert.equal(started,1,'background watchers must not create an undisclosed takeover')

let metadata:any={objective:'Read my account',url:'https://provider.example/account',mode:'read'}
const mutations:any[]=[]
const db={from:(table:string)=>{
  let change:any
  const q:any={select:()=>q,eq:()=>q,insert:(value:any)=>{mutations.push({table,insert:value});return q},
    update:(value:any)=>{change=value;mutations.push({table,update:value});return q},
    maybeSingle:async()=>({data:{metadata_json:metadata},error:null}),
    then:(resolve:any)=>{if(change?.metadata_json)metadata=change.metadata_json;return Promise.resolve({error:null}).then(resolve)}}
  return q
}}
let browserCompleted=false,vaultCalls=0
const command=load('browser-command.ts',{
  '@/lib/supabase-admin':{supabaseAdmin:db},
  '@/lib/bot/memory-redaction':{redactSecretShapedText:(s:string)=>s},
  './sentinel':{evaluateAgentSentinel:()=>({allowed:true})},
  './secure-computer':{runSecureBrowser:async()=>browserCompleted
    ? {status:'completed',url:'https://provider.example/account',title:'Account',summary:'Read account',forms:[],actions:[]}
    : {status:'blocked',blockReason:'human_auth_required',authReason:'device_approval',url:'https://provider.example/account',summary:'Approve sign-in'}},
  '@/lib/vault/connect-link':{buildVaultAddLink:async()=>{vaultCalls++;return null}},
  './provider-browser-handoff':{startProviderBrowserHandoff:async()=>handoff},
  './browser-handoff':{releaseBrowserHandoff:async(_url:string,options:any)=>{assert.equal(options.allowExpired,true);released++;return {ok:false,expired:true}}},
},'\nexport { executeBrowser }')
const params={actor:{userId:'user',legacyTelegramId:1},runId:'same-run',stepId:'same-step',command:{url:metadata.url,objective:metadata.objective,risk:'low'},mode:'read'}
const blocked=await command.executeBrowser(params)
assert.equal(blocked.runId,'same-run')
assert.equal(blocked.status,'paused')
assert.equal(metadata.handoff,handoff)
assert.equal(metadata.objective,'Read my account')
assert.equal(vaultCalls,0,'device approval must not send the user back through Vault login')
assert.match(blocked.text,/Resume this task/)
browserCompleted=true
const continued=await command.executeBrowser(params)
assert.equal(continued.runId,'same-run')
assert.equal(continued.status,'completed')
assert.equal(metadata.handoff,undefined)
assert.equal(released,2)
assert.equal(mutations.some(m=>m.table==='agent_runs'&&m.insert),false,'handoff must never replace the run')
console.log('Device auth takeover, ticket lifetime, and same-run continuation verified')
const computerSource=readFileSync(new URL('../lib/agent/secure-computer.ts',import.meta.url),'utf8')
assert.match(computerSource,/authGate\.reason==='password'\|\|\(!authGate\.required&&loginish\)/,
  'a detected secondary challenge must never trigger a Vault password attempt')

let releaseStatus=410
const releaseModule=load('browser-handoff.ts',{'@anthropic-ai/sdk':{default:class {}}},'',{
  fetch:async()=>{if(releaseStatus===0)throw new Error('expired endpoint');return {ok:releaseStatus===200,status:releaseStatus,json:async()=>({ok:true})}},
})
for(const status of [404,410,502,503,504,0]){
  releaseStatus=status
  assert.equal((await releaseModule.releaseBrowserHandoff(handoff.releaseUrl,{allowExpired:true})).expired,true)
}
releaseStatus=403
await assert.rejects(()=>releaseModule.releaseBrowserHandoff(handoff.releaseUrl,{allowExpired:true}),/403/,
  'authorization failures must not be treated as expiration')
console.log('Expired takeover recovery preserves same-task continuation without weakening authorization')
