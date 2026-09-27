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
  './browser-owner-lock':{acquireBrowserOwnerLock:async()=>async()=>{}},
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
let directSaveFails=false,directCancelled=0
const db={from:(table:string)=>{
  let change:any
  const q:any={select:()=>q,eq:()=>q,insert:(value:any)=>{mutations.push({table,insert:value});return q},
    update:(value:any)=>{change=value;mutations.push({table,update:value});return q},
    maybeSingle:async()=>({data:{metadata_json:metadata},error:null}),
    then:(resolve:any)=>{if(directSaveFails&&change?.metadata_json?.handoff)return Promise.resolve({error:{message:'save failed'}}).then(resolve);if(change?.metadata_json)metadata=change.metadata_json;return Promise.resolve({error:null}).then(resolve)}}
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
  './provider-browser-handoff':{startProviderBrowserHandoff:async()=>handoff,cancelProviderBrowserHandoff:async()=>{directCancelled++}},
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
browserCompleted=false;directSaveFails=true
await assert.rejects(()=>command.executeBrowser(params),/browser_handoff_save_failed/)
assert.equal(directCancelled,1,'direct browser commands must clean up an unsaved takeover')
directSaveFails=false
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

// Exercise the shared owner-scoped handoff and dispatch for every life-event consumer.
const rows:any={agent_runs:{id:'run',telegram_id:'1',status:'paused',metadata_json:{life_event_id:'event',life_event_action_id:'action',constraint:'saved'}},
  life_events:{id:'event',telegram_id:'1'},life_event_actions:{id:'action',telegram_id:'1',life_event_id:'event',status:'blocked'}}
let tokenSaveFails=false,cancelledHandoffs=0
const scopedDb={from:(table:string)=>{
  const filters:Array<[string,any]>=[];let change:any
  const execute=()=>{const row=rows[table];if(!row||!filters.every(([k,v])=>row[k]===v))return {data:null,error:null};if(tokenSaveFails&&change?.metadata_json?.handoff)return {data:null,error:{message:'save failed'}};if(change)Object.assign(row,change);return {data:structuredClone(row),error:null}}
  const q:any={select:()=>q,eq:(k:string,v:any)=>{filters.push([k,v]);return q},update:(v:any)=>{change=v;return q},
    maybeSingle:async()=>execute(),then:(resolve:any)=>Promise.resolve(execute()).then(resolve)}
  return q
}}
const dispatched:string[]=[]
let provisioningFails=false
const shared=load('secondary-auth-handoff.ts',{
  '@/lib/supabase-admin':{supabaseAdmin:scopedDb},
  './provider-browser-handoff':{startProviderBrowserHandoff:async()=>{if(provisioningFails)throw new Error('temporary domain failure');return handoff},cancelProviderBrowserHandoff:async()=>{cancelledHandoffs++}},
  './browser-handoff':{releaseBrowserHandoff:async()=>({ok:true})},
  './life-event-worker':{prepareFlightCheckin:async(p:any)=>{assert.equal(p.resumeRunId,'run');dispatched.push('flight_prepare');return {status:'completed'}}},
  './life-event-execution':{executeApprovedLifeEventCheckin:async(p:any)=>{assert.equal(p.runId,'run');dispatched.push('flight_execute');return {status:'completed'}}},
  './life-event-integration-worker':{processLifecycleMonitor:async(_a:any,_e:any,_t:any,runId:string)=>{assert.equal(runId,'run');dispatched.push('lifecycle_monitor');return {status:'completed'}}},
  './restaurant-reservation-worker':{processOne:async(p:any)=>{assert.equal(p.id,'action');dispatched.push('restaurant');return {status:'completed'}}},
})
for(const kind of ['flight_prepare','flight_execute','restaurant','lifecycle_monitor']){
  rows.agent_runs.status='paused';rows.life_event_actions.status='blocked'
  await shared.attachSecondaryAuthHandoff({userId:'user',telegramId:'1',runId:'run',kind,result:{blockReason:'human_auth_required',authReason:'device_approval',url:'https://provider.example',actions:[]}})
  assert.equal(rows.agent_runs.metadata_json.constraint,'saved')
  assert.equal(rows.agent_runs.metadata_json.handoff, handoff)
  const result=await shared.resumeSecondaryAuthRun({actor:{legacyTelegramId:1,userId:'user'},runId:'run'})
  assert.equal(result.runId,'run')
}
assert.deepEqual(dispatched,['flight_prepare','flight_execute','restaurant','lifecycle_monitor'])
rows.agent_runs.status='paused';rows.life_event_actions.status='blocked'
rows.agent_runs.metadata_json.auth_resume.safeToRetry=false
await assert.rejects(()=>shared.resumeSecondaryAuthRun({actor:{legacyTelegramId:1},runId:'run'}),/reconciliation/)
await assert.rejects(()=>shared.resumeSecondaryAuthRun({actor:{legacyTelegramId:2},runId:'run'}),/run_missing/)
for(const file of ['life-event-worker.ts','life-event-execution.ts','restaurant-reservation-worker.ts','life-event-integration-worker.ts']){
  const source=readFileSync(new URL(`../lib/agent/${file}`,import.meta.url),'utf8')
  assert.match(source,/await attachSecondaryAuthHandoff\(/,`${file} must create and persist takeover`)
  const policyGuard=source.search(/if\s*\(\s*!policy\.allowed/)
  assert.ok(policyGuard>=0&&source.indexOf('await releaseRunAuthHandoff(')>policyGuard,`${file} must retain policy gating`)
}
console.log('All life-event secondary-auth consumers preserve owner, run, constraints, and executor routing')

provisioningFails=true
rows.agent_runs.status='running';rows.life_event_actions.status='running'
const retryLink=await shared.attachSecondaryAuthHandoff({userId:'user',telegramId:'1',runId:'run',kind:'restaurant',result:{blockReason:'human_auth_required',authReason:'device_approval',url:'https://provider.example',actions:[]}})
assert.match(retryLink,/\/run\/browser$/)
assert.equal(rows.agent_runs.status,'paused')
assert.equal(rows.life_event_actions.status,'blocked')
assert.equal(rows.agent_runs.metadata_json.handoff,null)
await shared.releaseRunAuthHandoff('1','run')
assert.equal(rows.agent_runs.metadata_json.secondary_auth,undefined,'consume display marker even when provisioning failed')
assert.equal(rows.agent_runs.metadata_json.auth_resume.kind,'restaurant','retain executor context separately from auth UI state')
provisioningFails=false;tokenSaveFails=true
await shared.attachSecondaryAuthHandoff({userId:'user',telegramId:'1',runId:'run',kind:'restaurant',result:{blockReason:'human_auth_required',authReason:'device_approval',url:'https://provider.example',actions:[]}})
assert.equal(cancelledHandoffs,1,'release the owner lock if the takeover token cannot be persisted')
assert.equal(rows.agent_runs.status,'paused')
tokenSaveFails=false

let reserved=true,policyUpdates=0,bootstraps=0
const launches:any[]=[]
const provider=load('provider-browser-handoff.ts',{
  crypto:{randomBytes:()=>({toString:()=> 'new-token'})},
  './secure-browser-bootstrap':{ensureBrowserRuntime:async()=>{bootstraps++}},
  './browser-handoff':{BROWSER_HANDOFF_PORT:3001,HANDOFF_SERVER:'fixture',getPersistentBrowserSandbox:async(_id:string,options:any)=>{assert.equal(options.bootstrap,false);return {name:'owner',sandbox:{
    writeFiles:async()=>{},updateNetworkPolicy:async()=>{policyUpdates++},domain:async()=> 'browser.example',
    runCommand:async(command:any)=>{launches.push(command);return {exitCode:command.cmd==='flock'?0:reserved?0:1}},
  }}}},
},'',{setTimeout:(f:()=>void)=>{f();return 0}})
await provider.startProviderBrowserHandoff({userId:'owner',url:'https://provider.example'})
assert.equal(policyUpdates,1)
assert.equal(launches[0].cmd,'flock')
assert.equal(launches[0].args[0],'-n')
assert.equal(launches[0].detached,true)
reserved=false
await assert.rejects(()=>provider.startProviderBrowserHandoff({userId:'owner',url:'https://other.example'}),/in_use/)
assert.equal(policyUpdates,1,'a contending task must not change the active takeover network policy')
assert.equal(bootstraps,1,'a contending task must not bootstrap or replace the setup policy')
assert.equal(launches.some(c=>JSON.stringify(c).includes('pkill')),false,'never replace a live owner takeover token')
console.log('Provisioning failure, consumed auth markers, and concurrent owner takeover safety verified')

let lockAvailable=false
const lockCommands:any[]=[]
const lockModule=load('browser-owner-lock.ts',{'node:crypto':{randomBytes:()=>({toString:()=> 'reservation'})}},'',{setTimeout:(f:()=>void)=>{f();return 0}})
const lockSandbox={runCommand:async(c:any)=>{lockCommands.push(c);return {exitCode:c.cmd==='flock'?0:lockAvailable?0:1}},writeFiles:async(files:any)=>{lockCommands.push({files})}}
await assert.rejects(()=>lockModule.acquireBrowserOwnerLock(lockSandbox),/browser_handoff_in_use/)
assert.equal(lockCommands[0].args[2],'gogo-handoff.lock','automated readers and takeover must reserve the same lock')
lockAvailable=true
const unlock=await lockModule.acquireBrowserOwnerLock(lockSandbox)
await unlock()
assert.ok(lockCommands.some(c=>c.files?.[0]?.path==='gogo-browser-release-reservation'))
let unexpectedBootstrap=0
const lockedComputer=load('secure-computer.ts',{
  '@anthropic-ai/sdk':{default:class {}},
  '@vercel/sandbox':{Sandbox:{getOrCreate:async(options:any)=>{assert.equal(options.networkPolicy,undefined);return {}}}},
  './browser-owner-lock':{acquireBrowserOwnerLock:async()=>{throw new Error('browser_handoff_in_use')}},
  './secure-browser-bootstrap':{browserSandboxNameFor:()=> 'owner',ensureBrowserRuntime:async()=>{unexpectedBootstrap++}},
},'\nexport { getComputer }')
await assert.rejects(()=>lockedComputer.getComputer('user','https://provider.example'),/browser_handoff_in_use/)
assert.equal(unexpectedBootstrap,0,'ordinary browser tasks must not bootstrap an active owner takeover')
console.log('Automated browser reservations and direct handoff persistence failure verified')
