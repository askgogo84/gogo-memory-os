import assert from 'node:assert/strict'
import { draftObjectiveCovered } from '../lib/agent/draft-coverage'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { isLoginDestination, isTitleOnlyObjective, verifiedBrowserAnswer } from '../lib/agent/browser-evidence'
import { detectHumanAuthGate } from '../lib/agent/browser-auth-gate'

function load(file: string, mocks: Record<string, any>, extra='', globals:Record<string,any>={}) {
  const source=readFileSync(new URL(`../lib/agent/${file}`,import.meta.url),'utf8')+extra
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const exports:any={}
  runInNewContext(code,{exports,require:(name:string)=>mocks[name]||(name==='./draft-coverage'?{draftObjectiveCovered}:undefined)||(name==='./browser-evidence'?{isLoginDestination,isTitleOnlyObjective,verifiedBrowserAnswer}:{}),process:{env:{}},Buffer,URL,console,AbortSignal,...globals})
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
  './browser-owner-lock':{acquireBrowserOwnerLock:async()=>Object.assign(async()=>{},{reserveHandoff:async()=>"transfer"})},
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
let commandExecutionFailure:any
let browserBlockReason='human_auth_required'
let browserCompleted=false,vaultCalls=0,browserActions:any[]=[],reconciliationEvidence:any,browserExecutions=0
const command=load('browser-command.ts',{
  './post-auth-outcome':{markAuthOutcomeUnknown:async(_tg:string,runId:string,meta:any)=>{metadata={...meta,browser_safe_to_retry:false};return {runId,status:'outcome_unknown'}},inspectPostAuthRun:async()=>{if(reconciliationEvidence)return reconciliationEvidence;throw new Error('reconciliation_session_unavailable')}},
  '@/lib/supabase-admin':{supabaseAdmin:db},
  '@/lib/bot/memory-redaction':{redactSecretShapedText:(s:string)=>s},
  './sentinel':{evaluateAgentSentinel:()=>({allowed:true})},
  './secure-computer':{runSecureBrowser:async()=>{browserExecutions++;if(commandExecutionFailure)throw commandExecutionFailure;return browserCompleted
    ? {status:'completed',url:'https://provider.example/account',title:'Account',summary:'Read account',forms:[],actions:[]}
    : {status:'blocked',blockReason:browserBlockReason,authReason:'device_approval',url:'https://provider.example/account',summary:'Approve sign-in',actions:browserActions}}},
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
browserActions=[{kind:'click',status:'done',consequential:true}]
await command.executeBrowser(params)
assert.equal(metadata.browser_safe_to_retry,false)
await assert.rejects(()=>command.executeBrowser(params),/reconciliation/)
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
  const execute=()=>{const row=rows[table];if(!row||!filters.every(([k,v])=>Array.isArray(v)?v.includes(row[k]):row[k]===v))return {data:null,error:null};if(tokenSaveFails&&change?.metadata_json?.handoff)return {data:null,error:{message:'save failed'}};if(change)Object.assign(row,change);return {data:structuredClone(row),error:null}}
  const q:any={select:()=>q,order:()=>q,limit:()=>q,insert:()=>q,eq:(k:string,v:any)=>{filters.push([k,v]);return q},in:(k:string,v:any[])=>{filters.push([k,v]);return q},update:(v:any)=>{change=v;return q},
    maybeSingle:async()=>execute(),then:(resolve:any)=>Promise.resolve(execute()).then(resolve)}
  return q
}}
const dispatched:string[]=[]
let provisioningFails=false
let preparationFails=false
const shared=load('secondary-auth-handoff.ts',{
  './post-auth-outcome':{inspectPostAuthRun:async()=>{if(reconciliationEvidence)return reconciliationEvidence;throw new Error('reconciliation_session_unavailable')},markAuthOutcomeUnknown:async(...args:any[])=>outcomeReader.markAuthOutcomeUnknown(...args)},
  '@/lib/supabase-admin':{supabaseAdmin:scopedDb},
  './provider-browser-handoff':{startProviderBrowserHandoff:async()=>{if(provisioningFails)throw new Error('temporary domain failure');return handoff},cancelProviderBrowserHandoff:async()=>{cancelledHandoffs++}},
  './browser-handoff':{releaseBrowserHandoff:async()=>({ok:true})},
  './life-event-worker':{prepareFlightCheckin:async(p:any)=>{assert.equal(p.resumeRunId,'run');if(preparationFails){rows.agent_runs.status='failed';rows.life_event_actions.status='blocked';delete rows.agent_runs.metadata_json.secondary_auth;throw new Error('temporary browser contention')};dispatched.push('flight_prepare');return {status:'completed'}}},
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
for(const action of [
  {kind:'click',status:'done',consequential:true},
  {kind:'submit',status:'failed',consequential:true},
  {kind:'submit',status:'done'},
]){
  await shared.attachSecondaryAuthHandoff({userId:'user',telegramId:'1',runId:'run',kind:'restaurant',result:{blockReason:'human_auth_required',authReason:'device_approval',url:'https://login.example',originalUrl:'https://provider.example',actions:[action]}})
  assert.equal(rows.agent_runs.metadata_json.auth_resume.safeToRetry,false)
  await assert.rejects(()=>shared.resumeSecondaryAuthRun({actor:{legacyTelegramId:1},runId:'run'}),/reconciliation/)
}
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

let reserved=true,policyUpdates=0,bootstraps=0,lastPolicy:any
const launches:any[]=[]
const provider=load('provider-browser-handoff.ts',{
  crypto:{randomBytes:()=>({toString:()=> 'new-token'})},
  './secure-browser-bootstrap':{ensureBrowserRuntime:async()=>{bootstraps++}},
  './browser-handoff':{BROWSER_HANDOFF_PORT:3001,HANDOFF_SERVER:'fixture',getPersistentBrowserSandbox:async(_id:string,options:any)=>{assert.equal(options.bootstrap,false);return {name:'owner',sandbox:{
    writeFiles:async()=>{},updateNetworkPolicy:async(policy:any)=>{policyUpdates++;lastPolicy=policy},domain:async()=> 'browser.example',
    runCommand:async(command:any)=>{launches.push(command);return {exitCode:command.cmd==='flock'?0:reserved?0:1}},
  }}}},
},'',{setTimeout:(f:()=>void)=>{f();return 0}})
await provider.startProviderBrowserHandoff({userId:'owner',url:'https://login.example',originalUrl:'https://provider.example'})
assert.deepEqual(Object.keys(lastPolicy.allow).sort(),['*.login.example','*.provider.example','login.example','provider.example'])
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
assert.equal(await unlock.reserveHandoff(),'reservation')
await unlock()
assert.ok(lockCommands.some(c=>c.files?.[0]?.path==='gogo-browser-release-reservation'))
const transferWrite=lockCommands.findIndex(c=>c.files?.[0]?.path==='gogo-handoff-transfer')
const releaseWrite=lockCommands.findIndex((c,i)=>i>transferWrite&&c.files?.[0]?.path==='gogo-browser-release-reservation')
assert.ok(transferWrite>=0&&releaseWrite>transferWrite,'reserve the next human owner before releasing automation')
const transferFiles=new Map([['gogo-handoff-transfer','reserved-token']])
const transferFs={existsSync:(path:string)=>transferFiles.has(path),readFileSync:(path:string)=>transferFiles.get(path)||'',writeFileSync:(path:string,value:string)=>{transferFiles.set(path,value)},unlinkSync:(path:string)=>{transferFiles.delete(path)}}
assert.throws(()=>runInNewContext(lockCommands[0].args[5],{require:()=>transferFs,process:{argv:['node','contender'],exit:()=>{throw new Error('contender blocked')}},setInterval:()=>{}}),/contender blocked/)
assert.equal(transferFiles.has('gogo-browser-held-contender'),false)
const launchScript=launches[0].args[5]
assert.throws(()=>runInNewContext(launchScript,{require:()=>transferFs,process:{argv:['node','wrong-token','url','required'],exit:()=>{throw new Error('wrong transfer token')}},setInterval:()=>{}}),/wrong transfer token/)
assert.equal(transferFiles.get('gogo-handoff-transfer'),'reserved-token')
runInNewContext(launchScript,{require:()=>transferFs,process:{argv:['node','reserved-token','url','required'],exit:()=>{throw new Error('unexpected exit')}},setInterval:()=>{}})
assert.equal(transferFiles.has('gogo-handoff-transfer'),false)
assert.equal(transferFiles.get('gogo-handoff-reserved'),'reserved-token')
let unexpectedBootstrap=0
const lockedComputer=load('secure-computer.ts',{
  './secure-browser-redaction':{redactBrowserSensitiveText:(text:string)=>text},
  '@anthropic-ai/sdk':{default:class {}},
  '@vercel/sandbox':{Sandbox:{getOrCreate:async(options:any)=>{assert.equal(options.networkPolicy,undefined);return {}}}},
  './browser-owner-lock':{acquireBrowserOwnerLock:async()=>{throw new Error('browser_handoff_in_use')}},
  './secure-browser-bootstrap':{browserSandboxNameFor:()=> 'owner',ensureBrowserRuntime:async()=>{unexpectedBootstrap++}},
},'\nexport { getComputer, BROWSER_SCRIPT, normalizeActionLog }')
await assert.rejects(()=>lockedComputer.getComputer('user','https://provider.example'),/browser_handoff_in_use/)
assert.equal(unexpectedBootstrap,0,'ordinary browser tasks must not bootstrap an active owner takeover')
console.log('Automated browser reservations and direct handoff persistence failure verified')
for(const [label,throws,expected,mode] of [['Cancel booking',false,true,'execute'],['Cancel reservation',false,true,'execute'],['Cancel booking',false,true,'read'],['Confirm reservation',false,true,'execute'],['Confirm reservation',true,true,'execute'],['Search',false,false,'execute'],['Confirm reservation',false,true,'read']] as const){
  let output:any
  const element={textContent:label,tagName:'BUTTON',id:'action',getAttribute:(name:string)=>name==='type'?'button':null}
  const page={goto:async()=>{},waitForTimeout:async()=>{},waitForFunction:async()=>{},evaluate:async()=>({url:'https://login.example',text:'Approve this sign-in'}),locator:()=>({first:()=>({evaluate:async(fn:any)=>fn(element),click:async()=>{if(throws)throw new Error('timeout after click')}})})}
  await runInNewContext(lockedComputer.BROWSER_SCRIPT,{require:()=>({chromium:{launchPersistentContext:async()=>({pages:()=>[page],close:async()=>{}})}}),
    process:{argv:['node','browser',Buffer.from(JSON.stringify({url:'https://provider.example',mode,actions:[{kind:'click',selector:'#action'}]})).toString('base64')],exit:()=>{throw new Error('unexpected script exit')}},Buffer,console:{log:(value:string)=>{output=JSON.parse(value)},error:console.error}})
  assert.equal(output.executionBeforeText,null,'baseline captured inside the action browser before the consequential control')
  const actions=lockedComputer.normalizeActionLog(output.actions)
  assert.equal(actions[0].consequential,expected,'the executed DOM control determines replay safety')
  assert.equal(actions[0].status,mode==='read'?'skipped':throws?'failed':'done')
}
console.log('Production browser script records consequential clicks and uncertain click outcomes')
let browserReads=0,finalStops=0,finalUnlocks=0
let finalChallenge:any={url:'https://login.example',title:'Sign in',text:'Approve this sign-in',forms:[],actions:[{kind:'submit',detail:'#confirm',status:'done',consequential:true}]}
const finalGateComputer=load('secure-computer.ts',{
  '@anthropic-ai/sdk':{default:class {messages={create:async()=>({content:[{type:'text',text:'{"approvedOperation":"booking","actions":[{"kind":"submit","selector":"#confirm"}]}'}]})}}},
  '@vercel/sandbox':{Sandbox:{getOrCreate:async()=>({writeFiles:async()=>{},updateNetworkPolicy:async()=>{},stop:async()=>{finalStops++},
    runCommand:async()=>({exitCode:0,stdout:async()=>JSON.stringify(browserReads++===0
      ? {url:'https://provider.example',title:'Reservation',text:'Review reservation',forms:[]}
      : finalChallenge)})})}},
  './secure-browser-redaction':{redactBrowserSensitiveText:(text:string)=>text},
  './browser-auth-gate':{detectHumanAuthGate},
  './browser-owner-lock':{acquireBrowserOwnerLock:async()=>Object.assign(async()=>{finalUnlocks++},{reserveHandoff:async()=>"transfer"})},
  './secure-browser-bootstrap':{browserSandboxNameFor:()=> 'owner',ensureBrowserRuntime:async()=>{}},
  './trust':{canAuthorizeConsequentialAction:()=>true},
})
const finalGate=await finalGateComputer.runSecureBrowser({userId:'owner',url:'https://provider.example',objective:'Confirm my reservation',mode:'execute',reserveHumanHandoff:true})
assert.equal(finalGate.status,'blocked')
assert.equal(finalGate.authReason,'device_approval')
assert.equal(finalGate.actions[0].consequential,true)
assert.equal(finalGate.originalUrl,'https://provider.example')
assert.equal(finalGate.handoffReservation,'transfer')
assert.equal(finalStops,0,'retain the browser for the human challenge opened by the final click')
assert.equal(finalUnlocks,1,'release automated ownership before human takeover')
browserReads=0
const backgroundGate=await finalGateComputer.runSecureBrowser({userId:'owner',url:'https://provider.example',objective:'Read provider',mode:'read'})
assert.equal(backgroundGate.status,'blocked')
assert.equal(backgroundGate.handoffReservation,undefined,'background callers must not reserve a takeover they cannot consume')
browserReads=0
finalChallenge={...finalChallenge,text:'Enter your password',forms:[{inputs:[{type:'password'}]}]}
const passwordGate=await finalGateComputer.runSecureBrowser({userId:'owner',url:'https://provider.example',objective:'Read provider',mode:'execute',reserveHumanHandoff:true,reservePasswordHandoff:true})
assert.equal(passwordGate.authReason,'password')
assert.equal(passwordGate.handoffReservation,'transfer','password takeover consumers must reserve the same atomic transition')
console.log('Execute-mode final-click authentication pauses before completion and sandbox teardown')

rows.agent_runs.status='paused';rows.life_event_actions.status='blocked'
rows.agent_runs.metadata_json.auth_resume={kind:'flight_prepare',safeToRetry:true}
rows.agent_runs.metadata_json.secondary_auth={kind:'flight_prepare',reason:'device_approval',safeToRetry:true}
preparationFails=true
await assert.rejects(()=>shared.resumeSecondaryAuthRun({actor:{legacyTelegramId:1,userId:'user'},runId:'run'}),/temporary browser contention/)
assert.equal(rows.agent_runs.status,'paused')
assert.equal(rows.life_event_actions.status,'blocked')
assert.equal(rows.agent_runs.metadata_json.secondary_auth.kind,'flight_prepare')
assert.equal(rows.agent_runs.metadata_json.handoff,null)
preparationFails=false
assert.equal((await shared.resumeSecondaryAuthRun({actor:{legacyTelegramId:1,userId:'user'},runId:'run'})).runId,'run')
console.log('Transient preparation failure restores paused state and supports a second same-run resume')
let executionError='browser_handoff_in_use',executionCalls=0,executionReleases=0,executionResult:any
const executionMocks={
  '@/lib/supabase-admin':{supabaseAdmin:scopedDb},
  './secure-computer':{runSecureBrowser:async()=>{executionCalls++;if(executionResult)return executionResult;throw new Error(executionError)}},
  './secondary-auth-handoff':{releaseRunAuthHandoff:async()=>{executionReleases++},attachSecondaryAuthHandoff:async()=>({runId:'run',status:'outcome_unknown',text:'Verify directly with the provider; the action will not be repeated.'})},
  './policy':{evaluateAgentExecutionPolicy:()=>({allowed:true})},
  './sentinel':{evaluateAgentSentinel:()=>({allowed:true})},
  './approval-binding':{assertApprovalBinding:()=>{}},
  './life-event-approval-binding':{checkinApprovalFingerprintInput:()=>({})},
  './restaurant-reservation':{restaurantReservationApprovalInput:()=>({})},
}
const flightExecutor=load('life-event-execution.ts',executionMocks)
const restaurantExecutor=load('restaurant-reservation-worker.ts',executionMocks)
for(const kind of ['flight','restaurant'])for(const busy of [true,false]){
  executionError=busy?'browser_handoff_in_use':'provider_connection_lost'
  rows.agent_runs={id:'run',telegram_id:'1',status:'queued',metadata_json:{plan_type:'life_event_checkin',life_event_id:'event',life_event_action_id:'action',checkin_url:'https://provider.example'}}
  rows.life_events={id:'event',telegram_id:'1',event_type:'travel',subtype:'flight',confirmation_ref:'fixture',metadata_json:{}}
  rows.life_event_actions={id:'action',telegram_id:'1',life_event_id:'event',status:kind==='flight'?'waiting_approval':'ready',payload_json:{approvalId:'approval',reservationUrl:'https://provider.example'}}
  rows.agent_approvals={id:'approval',telegram_id:'1',run_id:'run',status:'approved',action_type:'booking',execution_payload:{action:'submit_web_checkin'}}
  rows.users={id:'owner',telegram_id:1}
  const result=kind==='flight'?await flightExecutor.executeApprovedLifeEventCheckin({actor:{userId:'owner',legacyTelegramId:1},runId:'run'}):await restaurantExecutor.processOne(structuredClone(rows.life_event_actions))
  assert.equal(result.status,busy?(kind==='flight'?'paused':'queued'):'outcome_unknown')
  assert.equal(rows.agent_runs.status,result.status)
  assert.equal(rows.life_event_actions.status,busy?(kind==='flight'?'blocked':'ready'):'blocked')
  if(busy&&kind==='flight'){
    assert.equal(rows.agent_runs.metadata_json.browser_waiting,true)
    assert.equal(rows.agent_runs.metadata_json.auth_resume.kind,'flight_execute')
    assert.match(result.text,/\/run\/browser$/)
  }
  assert.equal(rows.agent_approvals.status,'approved','retain the exact approval for a retry or reconciliation')
}
console.log('Approved executors retain retryable same-run state on pre-navigation contention, but never replay uncertain failures')
let outcomePage={url:'https://provider.example/confirmation',title:'Confirmation',text:'Reservation confirmed. Check-in complete.',forms:[]},outcomeReadError:Error|undefined
const outcomeReader=load('post-auth-outcome.ts',{
  '@/lib/supabase-admin':{supabaseAdmin:scopedDb},
  './browser-handoff':{readBrowserHandoffState:async()=>{if(outcomeReadError)throw outcomeReadError;return outcomePage}},
  './browser-auth-gate':{detectHumanAuthGate},
  './secure-browser-redaction':{redactBrowserSensitiveText:(text:string)=>text},
})
const outcomeMetadata={handoff:{stateUrl:'https://browser.example/state'},auth_original_url:'https://provider.example',auth_action_log:[{kind:'click',status:'done',consequential:true}]}
const evidence=await outcomeReader.inspectPostAuthOutcome(outcomeMetadata)
assert.equal(evidence.status,'completed')
for(const text of ['Payment declined','Reservation pending','Please wait','Welcome back','Reservation confirmed but payment failed']){
  outcomePage={...outcomePage,title:'Provider',text}
  assert.equal((await outcomeReader.inspectPostAuthOutcome(outcomeMetadata)).status,'blocked','an unfinished or failed result cannot complete the run or consume approval')
}
outcomePage={...outcomePage,title:'Sign in',text:'Approve this sign-in'}
assert.equal((await outcomeReader.inspectPostAuthOutcome(outcomeMetadata)).status,'blocked')
outcomePage={...outcomePage,title:'Confirmation',text:'Reservation confirmed',url:'https://unrelated.example'}
await assert.rejects(()=>outcomeReader.inspectPostAuthOutcome(outcomeMetadata),/host_mismatch/)
await assert.rejects(()=>outcomeReader.inspectPostAuthOutcome({}),/session_unavailable/)
for(const kind of ['flight','restaurant']){
  rows.agent_runs.status='queued'
  rows.life_event_actions.status=kind==='flight'?'waiting_approval':'ready'
  const priorReleases=executionReleases
  const pending={...evidence,title:'Provider',pageText:'Processing'}
  const incomplete=kind==='flight'?await flightExecutor.executeApprovedLifeEventCheckin({actor:{userId:'owner',legacyTelegramId:1},runId:'run',reconciledResult:pending}):await restaurantExecutor.processOne(structuredClone(rows.life_event_actions),pending)
  assert.equal(incomplete.status,'paused')
  assert.equal(executionReleases,priorReleases,'retain takeover until confirmation is verified')
  assert.equal(rows.agent_approvals.status,'approved')
  rows.agent_runs.status='queued'
  rows.life_event_actions.status=kind==='flight'?'waiting_approval':'ready'
  const before=executionCalls
  const confirmedEvidence={...evidence,pageText:kind==='flight'?"You're checked in; payment for the optional upgrade failed":'Table reserved; loyalty points pending'}
  const result=kind==='flight'?await flightExecutor.executeApprovedLifeEventCheckin({actor:{userId:'owner',legacyTelegramId:1},runId:'run',reconciledResult:confirmedEvidence}):await restaurantExecutor.processOne(structuredClone(rows.life_event_actions),confirmedEvidence)
  assert.equal(result.status,'completed')
  assert.equal(executionCalls,before,'reconciliation must not navigate, plan, or replay any action')
  assert.equal(rows.agent_runs.id,'run')
  assert.equal(rows.agent_approvals.status,'executed')
  rows.agent_approvals.status='approved'
}
console.log('Post-auth provider confirmation completes the same approved execution without any browser replay')
reconciliationEvidence=evidence
const directBefore=browserExecutions
assert.equal((await command.executeBrowser(params)).status,'completed')
assert.equal(browserExecutions,directBefore)
rows.agent_runs={id:'run',telegram_id:'1',status:'paused',metadata_json:{life_event_id:'event',life_event_action_id:'action',auth_resume:{kind:'flight_execute',safeToRetry:false},handoff}}
rows.life_event_actions.status='blocked'
assert.equal((await shared.resumeSecondaryAuthRun({actor:{legacyTelegramId:1,userId:'owner'},runId:'run'})).runId,'run')
outcomePage={...outcomePage,url:'https://provider.example/confirmation',title:'Provider',text:'Table reserved'}
const specialized=await outcomeReader.inspectPostAuthOutcome({...outcomeMetadata,auth_resume:{kind:'restaurant'}})
assert.equal(specialized.status,'completed','pass the snapshot to the specialized confirmation predicate')
rows.agent_runs.status='paused'
outcomeReadError=new Error('browser_handoff_state_failed:403')
await assert.rejects(()=>outcomeReader.inspectPostAuthRun('1','run',outcomeMetadata),/403/)
assert.equal(rows.agent_runs.status,'paused','authorization errors cannot clear an active takeover')
outcomeReadError=new Error('browser_handoff_state_failed:410')
rows.life_events.lifecycle_state='in_progress'
assert.equal(await outcomeReader.inspectPostAuthRun('1','run',{...outcomeMetadata,life_event_action_id:'action',life_event_id:'event'}),null)
assert.equal(rows.life_events.lifecycle_state,'needs_attention')
assert.equal(rows.agent_runs.status,'outcome_unknown')
assert.equal(rows.agent_runs.metadata_json.handoff,undefined)
assert.equal(rows.agent_runs.metadata_json.auth_reconciliation_required,true)
rows.life_events.lifecycle_state='completed'
await outcomeReader.markAuthOutcomeUnknown('1','run',{...outcomeMetadata,life_event_id:'event'})
assert.equal(rows.life_events.lifecycle_state,'completed','stale reconciliation must not regress a terminal parent state')
outcomeReadError=undefined
provisioningFails=true
rows.life_events.lifecycle_state='in_progress'
rows.agent_runs.metadata_json.life_event_id='event'
rows.agent_runs.status='running';rows.life_event_actions.status='running'
const unavailable=await shared.attachSecondaryAuthHandoff({userId:'owner',telegramId:'1',runId:'run',kind:'restaurant',result:{blockReason:'human_auth_required',authReason:'device_approval',url:'https://login.example',originalUrl:'https://provider.example',actions:outcomeMetadata.auth_action_log}})
assert.equal(unavailable.status,'outcome_unknown')
assert.equal(rows.agent_runs.status,'outcome_unknown','unsafe provisioning failure must expose manual verification, not a stranded pause')
assert.equal(rows.agent_runs.metadata_json.handoff,undefined)
assert.equal(rows.agent_runs.metadata_json.auth_resume,undefined)
assert.equal(rows.life_events.lifecycle_state,'needs_attention')
console.log('Expired or unavailable post-action sessions enter explicit manual verification; specialized confirmation remains supported')
let trainSaveFails=false,trainCancelled=0,trainResumeRow:any
const trainDb={from:(table:string)=>{let change:any;const q:any={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,insert:()=>q,update:(value:any)=>{change=value;return q},single:async()=>({data:{id:'step'},error:null}),maybeSingle:async()=>({data:trainResumeRow,error:null}),then:(resolve:any)=>{if(trainResumeRow&&table==='agent_runs'&&change)Object.assign(trainResumeRow,change);return Promise.resolve({data:null,count:0,error:trainSaveFails&&table==='agent_runs'&&change?.metadata_json?.handoff?{message:'failed'}:null}).then(resolve)}};return q}}
const train=load('train-research.ts',{
  '@anthropic-ai/sdk':{default:class {messages={create:async()=>({content:[{type:'text',text:JSON.stringify([{trainNumber:'12345',trainName:'Fixture Express',departure:'10:00',arrival:'12:00',classes:[]}])}]})}}},'@/lib/supabase-admin':{supabaseAdmin:trainDb},
  './browser-handoff':{readBrowserHandoffState:async()=>({url:'https://www.irctc.co.in',title:'Results',text:'12345 Fixture Express 10:00 12:00'})},
  './secure-computer':{runSecureBrowser:async(params:any)=>{assert.equal(params.reserveHumanHandoff,true);assert.equal(params.reservePasswordHandoff,true);return {status:'blocked',blockReason:'human_auth_required',authReason:'device_approval',url:'https://www.irctc.co.in',handoffReservation:'train-transfer'}}},
  './provider-browser-handoff':{startProviderBrowserHandoff:async(params:any)=>{assert.equal(params.reservationToken,'train-transfer');return handoff},cancelProviderBrowserHandoff:async()=>{if(trainResumeRow)assert.equal(trainResumeRow.status,'completed','persist verified results before releasing takeover');trainCancelled++}},
})
const trainParams={actor:{userId:'owner',legacyTelegramId:1},surface:'dashboard',runId:'train-run',c:{from:{label:'A',code:'A'},to:{label:'B',code:'B'},routeLabel:'A to B',date:'2026-10-01'},inputText:'Find trains',directOnly:true}
assert.equal((await train.executeTrainRun(trainParams)).status,'paused')
trainSaveFails=true
assert.equal((await train.executeTrainRun(trainParams)).status,'failed')
assert.equal(trainCancelled,1,'train research must release takeover if its token cannot be saved')
trainSaveFails=false
trainResumeRow={id:'train-run',status:'paused',metadata_json:{context:trainParams.c,handoff:{...handoff,stateUrl:'https://browser.example/state',agentActionUrl:'https://browser.example/agent-action'}}}
assert.equal((await train.tryResumeTrainHandoff({actor:trainParams.actor,text:'CONTINUE'})).status,'completed')
assert.equal(trainCancelled,2,'completed train takeover must release the shared owner lock')
assert.equal(trainResumeRow.metadata_json.handoff,null)
for(const kind of ['flight_execute','restaurant']){
  outcomePage={...outcomePage,text:kind==='flight_execute'?"You're checked in; payment for the optional upgrade failed":'Table reserved; loyalty points pending'}
  assert.equal((await outcomeReader.inspectPostAuthOutcome({...outcomeMetadata,auth_resume:{kind}})).status,'completed')
  rows.agent_runs.status='queued'
  rows.agent_runs.metadata_json={plan_type:'life_event_checkin',life_event_id:'event',life_event_action_id:'action',checkin_url:'https://provider.example'}
  rows.life_event_actions.status=kind==='flight_execute'?'waiting_approval':'ready'
  executionResult={...evidence,status:'blocked',blockReason:'human_auth_required',authReason:'device_approval'}
  const result=kind==='flight_execute'?await flightExecutor.executeApprovedLifeEventCheckin({actor:{userId:'owner',legacyTelegramId:1},runId:'run'}):await restaurantExecutor.processOne(structuredClone(rows.life_event_actions))
  assert.equal(result.status,'outcome_unknown')
  assert.match(result.text,/Verify directly/)
  assert.doesNotMatch(result.text,/Take control/)
}

// Reported Instagram shell: zero actions/forms must pause at login, never complete.
let evidenceStops=0
let inspectionOutput:string|undefined
let evidencePage:any={url:'https://www.instagram.com/accounts/login/',title:'Instagram',text:'',forms:[]}
let modelFailure=false
let modelText='[]'
let plannedOperation:string|undefined
let queuedObservations:any[]=[]
let evidenceCredential:any=null
const evidenceComputer=load('secure-computer.ts',{
  '@anthropic-ai/sdk':{default:class {messages={create:async()=>{if(modelFailure)throw new Error('unavailable');let response=modelText;try{const parsed=JSON.parse(modelText);if(plannedOperation&&Array.isArray(parsed))response=JSON.stringify({approvedOperation:plannedOperation,actions:parsed})}catch{};return {content:[{type:'text',text:response}]}}}}},
  '@vercel/sandbox':{Sandbox:{getOrCreate:async()=>({writeFiles:async()=>{},updateNetworkPolicy:async()=>{},stop:async()=>{evidenceStops++},runCommand:async()=>({exitCode:0,stdout:async()=>inspectionOutput??JSON.stringify(queuedObservations.shift()??evidencePage)})})}},
  './secure-browser-redaction':{redactBrowserSensitiveText:(text:string)=>text},
  './browser-auth-gate':{detectHumanAuthGate},
  './browser-owner-lock':{acquireBrowserOwnerLock:async()=>Object.assign(async()=>{},{reserveHandoff:async()=>"transfer"})},
  './secure-browser-bootstrap':{browserSandboxNameFor:()=> 'owner',ensureBrowserRuntime:async()=>{}},
  '@/lib/vault/credential-store':{resolveVaultCredentialForBrowser:async()=>evidenceCredential,recordVaultBrowserOutcome:async()=>{}},
  '@/lib/vault/session-store':{upsertVaultSession:async()=>{}},
  './trust':{canAuthorizeConsequentialAction:({mode}:any)=>mode==='execute'},
})
const readParams={userId:'owner',url:'https://www.instagram.com/',objective:'Show my three most recent saved posts',mode:'read',reserveHumanHandoff:true,reservePasswordHandoff:true}
const loginShell=await evidenceComputer.runSecureBrowser(readParams)
assert.equal(loginShell.status,'blocked')
assert.equal(loginShell.authReason,'password')
assert.equal(loginShell.handoffReservation,'transfer')
assert.equal(evidenceStops,0,'human handoff must keep the browser alive')
evidencePage={url:'https://www.instagram.com/',title:'Instagram',text:'',forms:[]}
await assert.rejects(()=>evidenceComputer.runSecureBrowser(readParams),/browser_objective_unverified/)
assert.equal(evidenceStops,1,'failed read must stop the browser')
evidencePage.text='Instagram photos and videos. Explore the community and find friends.'
modelFailure=true
await assert.rejects(()=>evidenceComputer.runSecureBrowser(readParams),/browser_planning_failed/)
assert.equal(evidenceStops,2,'planning failure must stop the read browser')
modelFailure=false
modelText=JSON.stringify({complete:true,answer:'Three saved posts',evidence:['Unobserved private post content']})
await assert.rejects(()=>evidenceComputer.runSecureBrowser(readParams),/browser_objective_unverified/)
console.log('Production browser rejects empty shells, model errors, and unsupported evidence')

evidencePage={url:'https://provider.example',title:'Acme',text:'',forms:[]}
modelText=JSON.stringify({complete:true,answer:'Acme',evidence:['Acme']})
const titleResult=await evidenceComputer.runSecureBrowser({...readParams,url:'https://provider.example',objective:'Read only. Inspect this exact page and report its current document title. Do not click, fill, submit, log in, or navigate away.'})
assert.equal(titleResult.status,'completed')
assert.equal(titleResult.title,'Acme')
evidencePage={url:'https://provider.example',title:'Flights',text:'Flight EY1 departs at 02:35 and arrives at 08:35 on 28 September 2026.',forms:[]}
modelText=JSON.stringify({complete:true,answer:evidencePage.text,evidence:[evidencePage.text]})
const flightResult=await evidenceComputer.runSecureBrowser({...readParams,url:'https://provider.example',objective:'Read this flight schedule'})
assert.equal(flightResult.status,'completed')
assert.equal(flightResult.pageText,evidencePage.text,'structured consumers retain the observed body')
console.log('Title watchers and structured travel consumers retain verified observations')

evidencePage={url:'https://provider.example',title:'Acme',text:'',forms:[]}
modelText=JSON.stringify({complete:true,evidence:['Acme']})
for(const objective of ['Open https://provider.example and report the page title','What is the title of this website?','Read the document title','Open this page and tell me its title','Get the webpage title']){
 const result=await evidenceComputer.runSecureBrowser({...readParams,url:'https://provider.example',objective})
 assert.equal(result.status,'completed',objective)
 assert.equal(result.summary,'Acme')
}
console.log('Equivalent direct page-title requests accept the observed title')

for(const objective of ['Report the page title and current price','Show the title plus availability','Read the title, stock and delivery fees']){
 modelText=JSON.stringify({complete:true,evidence:['Acme']})
 await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:'https://provider.example',objective}),/browser_objective_unverified/,objective)
}
evidencePage={url:'https://provider.example',title:'Acme',text:'Amul Taaza toned milk 1 litre is available at ₹60.',forms:[]}
modelText=JSON.stringify({complete:true,evidence:['Acme',evidencePage.text]})
const combined=await evidenceComputer.runSecureBrowser({...readParams,url:'https://provider.example',objective:'Report the page title and current price'})
assert.equal(combined.status,'completed')
assert.match(combined.summary,/₹60/)
console.log('Compound title requests require actual body evidence')

evidencePage={url:'https://provider.example/status',title:'Status',text:'Status: operational',forms:[]}
modelText=JSON.stringify({complete:true,evidence:[evidencePage.text]})
const shortResult=await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Read the service status'})
assert.equal(shortResult.status,'completed')
assert.equal(shortResult.summary,'Status: operational')

for(const body of ['OK','UP','Healthy']){
 evidencePage={url:'https://provider.example/status',title:'Status',text:body,forms:[]}
 modelText=JSON.stringify({complete:true,evidence:[body]})
 const result=await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Read the service status'})
 assert.equal(result.summary,body)
}

for(const body of ['Loading...','Please wait','Just a moment','Loading products...','Please wait while we fetch availability']){
 evidencePage={url:'https://provider.example/status',title:'Status',text:body,forms:[]}
 modelText=JSON.stringify({complete:true,evidence:[body]})
 await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Read the service status'}),/browser_objective_unverified/)
}
evidencePage={url:'https://provider.example/status',title:'OK',text:'OK',forms:[]}
modelText=JSON.stringify({complete:true,evidence:['OK']})
assert.equal((await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Read the service status'})).summary,'OK')

for(const badOutput of ['', 'invalid-json']){
 const before=evidenceStops
 inspectionOutput=badOutput
 await assert.rejects(()=>evidenceComputer.runSecureBrowser(readParams))
 assert.equal(evidenceStops,before+1,'initial inspection failure must stop the sandbox')
}
inspectionOutput=undefined

evidencePage={url:'https://provider.example',title:'Provider',text:'The provider page is loaded and ready for the requested action.',forms:[]}
modelFailure=true
for(const mode of ['draft','execute']){
 const before=evidenceStops
 await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,mode}),/browser_planning_failed/)
 assert.equal(evidenceStops,before+1,`${mode} planning failure stops its sandbox`)
}
modelFailure=false

for(const mode of ['draft','execute']){
 for(const plan of ['[]','invalid-json','[{"kind":"unsupported"}]']){
  modelText=plan
  const before=evidenceStops
  await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,mode}),/browser_objective_unverified/)
  assert.equal(evidenceStops,before+1,'unverified write mode stops sandbox')
 }
}
console.log('Write-mode runs cannot complete without observed action evidence')

plannedOperation='booking'
evidencePage.executionBeforeText='Review the requested operation.'
evidencePage.executionAfterText='Awaiting provider response.'
modelText=JSON.stringify([{kind:'fill',selector:'#name',value:'Example'},{kind:'submit',selector:'#confirm'}])
evidencePage.actions=[{kind:'fill',status:'done'},{kind:'submit',status:'failed',consequential:true}]
await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,mode:'execute'}),/browser_objective_unverified/)
evidencePage.actions=[{kind:'fill',status:'done'},{kind:'submit',status:'done',consequential:true}]
await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,mode:'execute'}),/browser_objective_unverified/)
console.log('Execute mode rejects partial failures and missing provider confirmation')

for(const confirmation of ['Reservation confirmed.','Reservation is not confirmed.','If your reservation is confirmed, you will receive email.','Reservation pending.']){
 queuedObservations=[{...evidencePage,text:'Review reservation.'},{...evidencePage,text:confirmation,executionAfterText:confirmation}]
 const execute=()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Confirm my reservation',mode:'execute'})
 if(confirmation==='Reservation confirmed.')assert.equal((await execute()).summary,'Reservation confirmed')
 else await assert.rejects(execute,/browser_objective_unverified/)
}
queuedObservations=[{...evidencePage,text:'Reservation confirmed.'},{...evidencePage,text:'Reservation confirmed.',executionBeforeText:'Reservation confirmed.',executionAfterText:'Reservation confirmed.'}]
await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Confirm my reservation',mode:'execute'}),/browser_objective_unverified/)
console.log('Local confirmation requires new affirmative provider evidence, not stale, pending or conditional text')

plannedOperation='application'
queuedObservations=[{...evidencePage,text:'Review application.'},{...evidencePage,text:'Application submitted successfully.',executionAfterText:'Application submitted successfully.'}]
assert.equal((await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Submit this application',mode:'execute'})).summary,'Application submitted successfully')
plannedOperation='application'
queuedObservations=[{...evidencePage,text:'Review application.'},{...evidencePage,text:'Awaiting provider response.'}]
await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Submit this application',mode:'execute'}),(error:any)=>error.message==='browser_objective_unverified'&&error.browserExecutionStarted===true)
console.log('Generic applications confirm locally; uncertain submissions carry a no-replay marker')

plannedOperation='booking'
evidenceCredential={username:'fixture',secret:'fixture-only',provider:'fixture',domain:'provider.example',credentialId:'fixture',telegramId:17}
queuedObservations=[{url:'https://provider.example/login',title:'Sign in',text:'Enter your password',forms:[{inputs:[{type:'password'}]}]},{...evidencePage,text:'Reservation confirmed.'},{...evidencePage,text:'Reservation confirmed.',executionBeforeText:'Reservation confirmed.',executionAfterText:'Reservation confirmed.'}]
await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Confirm my reservation',mode:'execute'}),/browser_objective_unverified/)
assert.equal(queuedObservations.length,0,'execute after Vault login consumes the authenticated baseline')
evidenceCredential=null
metadata={url:'https://provider.example',objective:'Submit application'}
commandExecutionFailure=Object.assign(new Error('browser_objective_unverified'),{browserExecutionStarted:true})
const uncertainSubmission=await command.executeBrowser({...params,mode:'execute'})
assert.equal(uncertainSubmission.status,'outcome_unknown')
assert.equal(metadata.browser_safe_to_retry,false)
const noReplayCount=browserExecutions
reconciliationEvidence=undefined
await assert.rejects(()=>command.executeBrowser({...params,mode:'execute'}),/reconciliation/)
assert.equal(browserExecutions,noReplayCount,'unknown submission cannot be automatically replayed')
commandExecutionFailure=undefined
console.log('Post-Vault baseline rejects stale confirmation and uncertain command state blocks replay')

queuedObservations=[{...evidencePage,text:'Review reservation.'},{...evidencePage,text:'Reservation confirmed.',executionBeforeText:'Reservation confirmed.',executionAfterText:'Reservation confirmed.'}]
await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Confirm my reservation',mode:'execute'}),/browser_objective_unverified/)
console.log('Confirmation present only after the action-browser reload cannot count as new success')

queuedObservations=[{...evidencePage,text:'Review reservation.'},{...evidencePage,text:'Reservation confirmed.',executionBeforeText:'Review reservation.',executionAfterText:'Booking submission pending.'}]
await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Confirm my reservation',mode:'execute'}),/browser_objective_unverified/)
function evaluateObservation(fn:any,input:any,observation:any){
 if(input?.confirmationSnapshot)return runInNewContext('('+fn.toString()+')(input)',{input,document:observation.receiptDocument||{body:{innerText:observation.text}}})
 return {...observation,text:observation.text.slice(0,18000)}
}

let boundaryOutput:any,simulatedPage='Review reservation.'
const boundaryPage={goto:async(url:string)=>{simulatedPage=url.endsWith('/history')?'Reservation confirmed.':'Review reservation.'},waitForTimeout:async()=>{},waitForFunction:async()=>{},evaluate:async(fn:any,input:any)=>evaluateObservation(fn,input,{url:'https://provider.example',text:simulatedPage}),locator:()=>({first:()=>({evaluate:async(fn:any)=>fn({textContent:'Confirm reservation',tagName:'BUTTON',id:'confirm',getAttribute:()=>null}),click:async()=>{simulatedPage='Booking submission pending.'}})})}
await runInNewContext(lockedComputer.BROWSER_SCRIPT,{require:()=>({chromium:{launchPersistentContext:async()=>({pages:()=>[boundaryPage],close:async()=>{}})}}),process:{argv:['node','browser',Buffer.from(JSON.stringify({url:'https://provider.example',mode:'execute',confirmationPattern:'(?:booking|reservation)',actions:[{kind:'submit',selector:'#confirm'},{kind:'goto',url:'https://provider.example/history'}]})).toString('base64')],exit:()=>{throw new Error('unexpected script exit')}},Buffer,console:{log:(value:string)=>{boundaryOutput=JSON.parse(value)},error:console.error}})
assert.equal(boundaryOutput.text,'Reservation confirmed.')
assert.equal(boundaryOutput.executionBeforeText,'')
assert.equal(boundaryOutput.executionAfterText,'')
console.log('Subsequent navigation cannot replace the immediate provider submission result')

simulatedPage='Review reservation.'
let boundaryClicks=0
const misleadingControlPage={...boundaryPage,locator:()=>({first:()=>({evaluate:async(fn:any)=>fn({textContent:'Confirm reservation',tagName:'BUTTON',id:'confirm',getAttribute:()=>null}),click:async()=>{simulatedPage=++boundaryClicks===1?'Booking submission pending.':'Reservation confirmed.'}})})}
await runInNewContext(lockedComputer.BROWSER_SCRIPT,{require:()=>({chromium:{launchPersistentContext:async()=>({pages:()=>[misleadingControlPage],close:async()=>{}})}}),process:{argv:['node','browser',Buffer.from(JSON.stringify({url:'https://provider.example',mode:'execute',confirmationPattern:'(?:booking|reservation)',actions:[{kind:'submit',selector:'#confirm'},{kind:'click',selector:'#view-reservation'}]})).toString('base64')],exit:()=>{throw new Error('unexpected script exit')}},Buffer,console:{log:(value:string)=>{boundaryOutput=JSON.parse(value)},error:console.error}})
assert.equal(boundaryOutput.text,'Reservation confirmed.')
assert.equal(boundaryOutput.actions.filter((action:any)=>action.consequential).length,2)
assert.equal(boundaryOutput.executionBeforeText,'')
assert.equal(boundaryOutput.executionAfterText,'')
console.log('Later consequential-labelled controls cannot overwrite the original submission evidence')

for(const [objective,confirmation] of [['Cancel my booking','Booking cancelled'],['Cancel my reservation','Reservation canceled'],['Cancel my booking','Your booking has been cancelled'],['Check in for my flight','You are checked in'],['Check in for my flight','You are now checked in'],['Check in for my flight','Checked in successfully']]){
 plannedOperation=objective.startsWith('Cancel')?'cancellation':'check_in'
 queuedObservations=[{...evidencePage,text:'Review the operation.'},{...evidencePage,text:confirmation,executionBeforeText:'Review the operation.',executionAfterText:confirmation}]
 assert.equal((await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective,mode:'execute'})).summary,confirmation)
}
for(const [objective,confirmation] of [['Cancel my booking','Your booking is not cancelled'],['Cancel my reservation','When reservation canceled, contact us'],['Check in for my flight','You are not checked in'],['Check in for my flight','Once checked in, print the pass']]){
 plannedOperation=objective.startsWith('Cancel')?'cancellation':'check_in'
 queuedObservations=[{...evidencePage,text:'Review the operation.'},{...evidencePage,text:confirmation,executionBeforeText:'Review the operation.',executionAfterText:confirmation}]
 await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective,mode:'execute'}),/browser_objective_unverified/)
}
console.log('Normal cancellation/check-in verb confirmations work while negatives and conditions remain unverified')

simulatedPage='Dismiss this popup.'
const dismissalPage={...boundaryPage,locator:(selector:string)=>({first:()=>({evaluate:async(fn:any)=>fn({textContent:selector==='#dismiss'?'Cancel':'Confirm reservation',tagName:'BUTTON',id:selector,getAttribute:()=>null}),click:async()=>{simulatedPage=selector==='#dismiss'?'Review the new reservation.':'Reservation confirmed.'}})})}
await runInNewContext(lockedComputer.BROWSER_SCRIPT,{require:()=>({chromium:{launchPersistentContext:async()=>({pages:()=>[dismissalPage],close:async()=>{}})}}),process:{argv:['node','browser',Buffer.from(JSON.stringify({url:'https://provider.example',mode:'execute',confirmationPattern:'(?:booking|reservation)',actions:[{kind:'click',selector:'#dismiss'},{kind:'submit',selector:'#confirm'}]})).toString('base64')],exit:()=>{throw new Error('unexpected script exit')}},Buffer,console:{log:(value:string)=>{boundaryOutput=JSON.parse(value)},error:console.error}})
assert.equal(boundaryOutput.executionBeforeText,'')
assert.equal(boundaryOutput.executionAfterText,'Reservation confirmed')
console.log('A plain Cancel dismissal cannot own evidence for an approved booking')


for(const [objective,operation,confirmation] of [
 ['Book a refundable fare with free cancellation','booking','Reservation confirmed'],
 ['Book a fare I can cancel for free','booking','Reservation confirmed'],
 ["I can't travel so please cancel my booking",'cancellation','Booking cancelled'],
 ['Could you cancel my booking?','cancellation','Booking cancelled'],
 ["I'd like to cancel my reservation",'cancellation','Booking cancelled'],
 ['Open the site, cancel my booking','cancellation','Booking cancelled'],
 ['Book this fare; do not cancel my existing booking','booking','Reservation confirmed'],
 ['Click Cancel to dismiss the modal, then book the room','booking','Reservation confirmed']]){
 plannedOperation=operation
 queuedObservations=[{...evidencePage,text:'Review the approved operation.'},{...evidencePage,text:confirmation,executionBeforeText:'Review the approved operation.',executionAfterText:confirmation}]
 assert.equal((await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective,mode:'execute'})).summary,confirmation)
}
plannedOperation=undefined
queuedObservations=[{...evidencePage,text:'Review the operation.'}]
await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Book a fare',mode:'execute'}),(error:any)=>error.message==='browser_objective_unverified'&&error.browserExecutionStarted===false)
console.log('Execution consistently uses the preclassified operation; missing classification fails before any action')

plannedOperation='booking'
for(const baseline of ['RESERVATION CONFIRMED','Reservation   confirmed','Reservation\nconfirmed','Reservation has\nbeen confirmed']){
 queuedObservations=[{...evidencePage,text:'Review reservation.'},{...evidencePage,text:'Reservation confirmed',executionBeforeText:baseline,executionAfterText:'Reservation confirmed'}]
 await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Confirm my reservation',mode:'execute'}),/browser_objective_unverified/)
}
console.log('Case and whitespace changes cannot make stale confirmation evidence new')

let applyStage='Open the application.'
const applyPage={goto:async()=>{},waitForTimeout:async()=>{},waitForFunction:async()=>{},evaluate:async(fn:any,input:any)=>evaluateObservation(fn,input,{url:'https://provider.example',text:applyStage}),locator:(selector:string)=>({first:()=>({evaluate:async(fn:any)=>fn({textContent:selector==='#apply'?'Apply':'Submit application',tagName:'BUTTON',id:selector,getAttribute:()=>null}),click:async()=>{applyStage=selector==='#apply'?'Application submitted previously. Fill this new form.':'Application submitted successfully.'}})})}
await runInNewContext(lockedComputer.BROWSER_SCRIPT,{require:()=>({chromium:{launchPersistentContext:async()=>({pages:()=>[applyPage],close:async()=>{}})}}),process:{argv:['node','browser',Buffer.from(JSON.stringify({url:'https://provider.example',mode:'execute',confirmationPattern:'(?:application|form|submission)',actions:[{kind:'click',selector:'#apply'},{kind:'submit',selector:'#submit'}]})).toString('base64')],exit:()=>{throw new Error('unexpected script exit')}},Buffer,console:{log:(value:string)=>{boundaryOutput=JSON.parse(value)},error:console.error}})
assert.equal(boundaryOutput.executionBeforeText,'Application submitted')
assert.equal(boundaryOutput.executionAfterText,'Application submitted successfully')
metadata={url:'https://provider.example',objective:'Submit application'}
browserBlockReason='provider_access_limited';browserActions=[{kind:'submit',status:'done',consequential:true}];browserCompleted=false
const blockedAfterSubmit=await command.executeBrowser({...params,mode:'execute'})
assert.equal(blockedAfterSubmit.status,'outcome_unknown')
assert.equal(metadata.browser_safe_to_retry,false)
console.log('Application entry cannot own final-submit evidence; provider blocks after submission preserve uncertainty')

let capturedConfirmationPredicate:any
let asyncPageText='Review purchase.',settled=false
const asyncPage={goto:async()=>{},waitForTimeout:async()=>{},waitForFunction:async(predicate:any,input:any,options:any)=>{
 capturedConfirmationPredicate=predicate
 assert.equal(options.timeout,15000);assert.equal(options.polling,250)
 for(let poll=0;poll<10;poll++){
  if(poll===5)asyncPageText='Order placed'
  const ready=runInNewContext('('+predicate.toString()+')(input)',{input,document:{body:{innerText:asyncPageText}}})
  if(poll<5)assert.equal(ready,false,'an idle intermediate page cannot finish the wait')
  if(ready){settled=true;return}
 }
 throw new Error('confirmation timeout')
},evaluate:async(fn:any,input:any)=>evaluateObservation(fn,input,{url:'https://provider.example',text:asyncPageText}),locator:()=>({first:()=>({click:async()=>{asyncPageText='Processing your order'}})})}
await runInNewContext(lockedComputer.BROWSER_SCRIPT,{require:()=>({chromium:{launchPersistentContext:async()=>({pages:()=>[asyncPage],close:async()=>{}})}}),process:{argv:['node','browser',Buffer.from(JSON.stringify({url:'https://provider.example',mode:'execute',confirmationPattern:'(?:order|purchase)',actions:[{kind:'submit',selector:'#place-order'}]})).toString('base64')],exit:()=>{throw new Error('unexpected script exit')}},Buffer,console:{log:(value:string)=>{boundaryOutput=JSON.parse(value)},error:console.error}})
assert.equal(settled,true)
assert.equal(boundaryOutput.executionAfterText,'Order placed')
plannedOperation='purchase'
queuedObservations=[{...evidencePage,text:'Review purchase.'},{...evidencePage,text:'Order placed',executionBeforeText:'Review purchase.',executionAfterText:'Order placed'}]
assert.equal((await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Place my approved order',mode:'execute'})).summary,'Order placed')
console.log('Delayed post-submit DOM confirmation is polled before capture; an idle intermediate page cannot finish the wait')

plannedOperation='purchase'
for(const [before,after] of [['Order placed · updated 2 minutes ago','Order placed · updated 3 minutes ago'],['Order has been placed','Order placed'],['Order successfully placed','Order placed'],['Review order','No order placed'],['Review order','Order placed unsuccessfully'],['Review order','Order placed?']]){
 queuedObservations=[{...evidencePage,text:before},{...evidencePage,text:after,executionBeforeText:before,executionAfterText:after}]
 await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Place my order',mode:'execute'}),/browser_objective_unverified/)
 assert.equal(runInNewContext('('+capturedConfirmationPredicate.toString()+')(input)',{input:{before,pattern:'(?:order|purchase)'},document:{body:{innerText:after}}}),false)
}
for(const [operation,before,after] of [['payment','Review payment','Payment processed'],['payment','Review payment','Payment has been processed'],['purchase','No order placed','Order placed']]){
 plannedOperation=operation
 queuedObservations=[{...evidencePage,text:before},{...evidencePage,text:after,executionBeforeText:before,executionAfterText:after}]
 assert.equal((await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Complete the approved operation',mode:'execute'})).summary,after)
}
console.log('Stable confirmation phrases ignore mutable timestamps; direct processed payments work; negatives cannot become success')

for(const stale of [true,false]){
 let longBody='x'.repeat(20000)+(stale?'\nOrder placed':'\nReview purchase')
 const longPage={goto:async()=>{},waitForTimeout:async()=>{},waitForFunction:async()=>{},evaluate:async(fn:any,input:any)=>evaluateObservation(fn,input,{url:'https://provider.example',text:longBody}),locator:()=>({first:()=>({click:async()=>{longBody=stale?'Order placed':'x'.repeat(20000)+'\nOrder placed'}})})}
 await runInNewContext(lockedComputer.BROWSER_SCRIPT,{require:()=>({chromium:{launchPersistentContext:async()=>({pages:()=>[longPage],close:async()=>{}})}}),process:{argv:['node','browser',Buffer.from(JSON.stringify({url:'https://provider.example',mode:'execute',confirmationPattern:'(?:order|purchase)',actions:[{kind:'submit',selector:'#place-order'}]})).toString('base64')],exit:()=>{throw new Error('unexpected script exit')}},Buffer,console:{log:(value:string)=>{boundaryOutput=JSON.parse(value)},error:console.error}})
 assert.equal(boundaryOutput.executionBeforeText,stale?'Order placed':'')
 assert.equal(boundaryOutput.executionAfterText,'Order placed')
 plannedOperation='purchase';modelText=JSON.stringify([{kind:'submit',selector:'#place-order'}])
 queuedObservations=[{...evidencePage,text:'Review purchase.'},boundaryOutput]
 const execute=()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Place my order',mode:'execute'})
 if(stale)await assert.rejects(execute,/browser_objective_unverified/)
 else assert.equal((await execute()).summary,'Order placed')
}
console.log('Full-DOM phrase snapshots retain late confirmations and reject stale evidence moving into the text prefix')

plannedOperation='purchase';modelText=JSON.stringify([{kind:'submit',selector:'#place-order'}])
for(const confirmation of ['Thank you for your order','Thanks for your purchase','Successfully placed your order','Order complete']){
 queuedObservations=[{...evidencePage,text:'Review purchase.'},{...evidencePage,text:confirmation,actions:[{kind:'submit',status:'done',consequential:true}],executionBeforeText:'',executionAfterText:confirmation}]
 assert.equal((await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Place my order',mode:'execute'})).summary,confirmation)
}
for(const [before,after] of [['Thank you for your order','Order placed'],['Order placed','Thanks for your purchase']]){
 queuedObservations=[{...evidencePage,text:'Review purchase.'},{...evidencePage,text:after,actions:[{kind:'submit',status:'done',consequential:true}],executionBeforeText:before,executionAfterText:after}]
 await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Place my order',mode:'execute'}),/browser_objective_unverified/)
}
console.log('Thank-you/reversed receipts confirm purchases, while changing confirmation wording alone remains stale')

plannedOperation='application';modelText=JSON.stringify([{kind:'submit',selector:'#submit'}])
queuedObservations=[{...evidencePage,text:'Application submitted'},{...evidencePage,text:'Application submitted\nApplication submitted',actions:[{kind:'submit',status:'done',consequential:true}],executionBeforeText:'Application submitted',executionAfterText:'Application submitted\nApplication submitted'}]
assert.equal((await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Submit the new application',mode:'execute'})).summary,'Application submitted')
assert.equal(runInNewContext('('+capturedConfirmationPredicate.toString()+')(input)',{input:{before:'Application submitted',pattern:'(?:application|form|submission)'},document:{body:{innerText:'Application submitted\nApplication submitted'}}}),true)
assert.equal(runInNewContext('('+capturedConfirmationPredicate.toString()+')(input)',{input:{before:'Order placed',pattern:'(?:order|purchase)'},document:{body:{innerText:'Order placed. Thank you for your order'}}}),false,'synonymous wording on the same receipt line is one occurrence')
console.log('A new confirmation occurrence is retained alongside old records without double-counting same-line receipt wording')

plannedOperation='purchase'
for(const [before,after] of [
 ['Order placed. Thank you for your order','Order placed.\nThank you for your order'],
 ['Order placed.\nThank you for your order','Order placed. Thank you for your order'],
 ['Order placed. Thank you for your order','Order\nplaced.\nThank you for your order'],
]){
 queuedObservations=[{...evidencePage,text:before},{...evidencePage,text:after,actions:[{kind:'submit',status:'done',consequential:true}],executionBeforeText:before,executionAfterText:after}]
 await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Place my order',mode:'execute'}),/browser_objective_unverified/)
 assert.equal(runInNewContext('('+capturedConfirmationPredicate.toString()+')(input)',{input:{before,pattern:'(?:order|purchase)'},document:{body:{innerText:after}}}),false)
}
console.log('Receipt reflow across sentences and words never creates new confirmation evidence')

// Real DOM-shaped receipt records preserve mixed confirmation wording without
// treating synonymous text inside a single receipt as separate records.
const receiptDocument=(texts:string[])=>{
 const nodes=texts.map(innerText=>({innerText,getClientRects:()=>[{}],contains:(other:any)=>false}))
 return {body:{innerText:texts.join('\n')},querySelectorAll:()=>nodes}
}
const oldReceipts=JSON.stringify({receiptRecords:['Order placed','Order placed']})
const newReceipts=JSON.stringify({receiptRecords:['Order placed','Order placed','Thank you for your order']})
assert.equal(runInNewContext('('+capturedConfirmationPredicate.toString()+')(input)',{input:{before:oldReceipts,pattern:'(?:order|purchase)'},document:receiptDocument(['Order placed','Order placed','Thank you for your order'])}),true)
for(const wrapped of ['Order placed. Thank you for your order','Order placed.\nThank you for your order']){
 assert.equal(runInNewContext('('+capturedConfirmationPredicate.toString()+')(input)',{input:{before:JSON.stringify({receiptRecords:['Order placed']}),pattern:'(?:order|purchase)'},document:receiptDocument([wrapped])}),false)
}
plannedOperation='purchase';modelText=JSON.stringify([{kind:'submit',selector:'#place-order'}])
queuedObservations=[{...evidencePage,text:'Review purchase'},{...evidencePage,text:'Thank you for your order',actions:[{kind:'submit',status:'done',consequential:true}],executionBeforeText:oldReceipts,executionAfterText:newReceipts}]
assert.equal((await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Place my order',mode:'execute'})).summary,'Thank you for your order')
console.log('Separate DOM receipt records preserve a new differently worded receipt alongside older history')

let receiptTexts=['Order placed','Order placed']
const recordPage={goto:async()=>{},waitForTimeout:async()=>{},waitForFunction:async()=>{},evaluate:async(fn:any,input:any)=>evaluateObservation(fn,input,{url:'https://provider.example',text:receiptTexts.join('\n'),receiptDocument:receiptDocument(receiptTexts)}),locator:()=>({first:()=>({click:async()=>{receiptTexts.push('Thank you for your order')}})})}
await runInNewContext(lockedComputer.BROWSER_SCRIPT,{require:()=>({chromium:{launchPersistentContext:async()=>({pages:()=>[recordPage],close:async()=>{}})}}),process:{argv:['node','browser',Buffer.from(JSON.stringify({url:'https://provider.example',mode:'execute',confirmationPattern:'(?:order|purchase)',actions:[{kind:'submit',selector:'#place-order'}]})).toString('base64')],exit:()=>{throw new Error('unexpected script exit')}},Buffer,console:{log:(value:string)=>{boundaryOutput=JSON.parse(value)},error:console.error}})
assert.equal(JSON.parse(boundaryOutput.executionBeforeText).receiptRecords.length,2)
assert.equal(JSON.parse(boundaryOutput.executionAfterText).receiptRecords.length,3)
console.log('Actual browser script preserves the full receipt-record snapshots at submission')

const priorIds=JSON.stringify({receiptRecords:[{id:'data-order-id:old-1',phrase:'Order placed'},{id:'data-order-id:old-2',phrase:'Order placed'}]})
const afterIds=JSON.stringify({receiptRecords:[{id:'data-order-id:old-2',phrase:'Order placed'},{id:'data-order-id:new-3',phrase:'Thank you for your order'}]})
const cappedNodes=['old-2','new-3'].map((id,i)=>({innerText:i?'Thank you for your order':'Order placed',getClientRects:()=>[{}],contains:(other:any)=>false,getAttribute:(key:string)=>key==='data-order-id'?id:null}))
assert.equal(runInNewContext('('+capturedConfirmationPredicate.toString()+')(input)',{input:{before:priorIds,pattern:'(?:order|purchase)'},document:{body:{innerText:'Order placed\nThank you for your order'},querySelectorAll:()=>cappedNodes}}),true)
queuedObservations=[{...evidencePage,text:'Review purchase'},{...evidencePage,text:'Thank you for your order',actions:[{kind:'submit',status:'done',consequential:true}],executionBeforeText:priorIds,executionAfterText:afterIds}]
assert.equal((await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Place my order',mode:'execute'})).summary,'Thank you for your order')
console.log('Stable provider receipt identities detect new results in capped history')

const parentReceipts=['old-2','new-3'].map(id=>({innerText:'Order placed',getClientRects:()=>[{}],getAttribute:(key:string)=>key==='data-order-id'?id:null,contains:(node:any)=>node.parent===id}))
const nestedReceipts=parentReceipts.map((parent,i)=>({parent:i?'new-3':'old-2',innerText:'Order placed',getClientRects:()=>[{}],getAttribute:()=>null,contains:()=>false,closest:()=>parent}))
assert.equal(runInNewContext('('+capturedConfirmationPredicate.toString()+')(input)',{input:{before:priorIds,pattern:'(?:order|purchase)'},document:{body:{innerText:'Order placed\nOrder placed'},querySelectorAll:(selector:string)=>selector.startsWith('[data-')?[...parentReceipts,...nestedReceipts]:[]}}),true)
console.log('Nested receipt content preserves its enclosing provider identity')

const mixedBefore=JSON.stringify({receiptRecords:[{id:'data-order-id:old-1',phrase:'Order placed'},{id:null,nodeKey:'anonymous-node',phrase:'Order placed'}]})
const mixedAfter=JSON.stringify({receiptRecords:[{id:'data-order-id:new-3',phrase:'Order placed'},{id:null,phrase:'Order placed'}]})
const mixedNodes=[{innerText:'Order placed',getClientRects:()=>[{}],contains:()=>false,getAttribute:()=> 'new-3'},{innerText:'Order placed',getClientRects:()=>[{}],contains:()=>false,getAttribute:()=>null}]
assert.equal(runInNewContext('('+capturedConfirmationPredicate.toString()+')(input)',{input:{before:mixedBefore,pattern:'(?:order|purchase)'},document:{body:{innerText:'Order placed'},querySelectorAll:()=>mixedNodes}}),true)
queuedObservations=[{...evidencePage,text:'Review purchase'},{...evidencePage,text:'Order placed',actions:[{kind:'submit',status:'done',consequential:true}],executionBeforeText:mixedBefore,executionAfterText:mixedAfter}]
assert.equal((await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Place my order',mode:'execute'})).summary,'Order placed')
const hydrated=JSON.stringify({receiptRecords:[{id:'data-order-id:old-1',phrase:'Order placed'},{id:'data-order-id:new-3',nodeKey:'anonymous-node',phrase:'Order placed'}]})
queuedObservations=[{...evidencePage,text:'Review purchase'},{...evidencePage,text:'Order placed',actions:[{kind:'submit',status:'done',consequential:true}],executionBeforeText:mixedBefore,executionAfterText:hydrated}]
await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Place my order',mode:'execute'}),/browser_objective_unverified/)
console.log('Anonymous status does not hide new IDs; enriching an anonymous old receipt alone is not new evidence')

const unrelatedStatusGone=JSON.stringify({receiptRecords:[{id:'data-order-id:old-1',phrase:'Order placed'},{id:'data-order-id:new-3',nodeKey:'new-receipt-node',phrase:'Order placed'}]})
queuedObservations=[{...evidencePage,text:'Review purchase'},{...evidencePage,text:'Order placed',actions:[{kind:'submit',status:'done',consequential:true}],executionBeforeText:mixedBefore,executionAfterText:unrelatedStatusGone}]
assert.equal((await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Place my order',mode:'execute'})).summary,'Order placed')
console.log('Unrelated anonymous status loss cannot cancel directly identified new receipt evidence')

plannedOperation=undefined
modelText=JSON.stringify({approvedOperation:'none',draftReady:false,actions:[{kind:'click',selector:'#start'}]})
queuedObservations=[{...evidencePage,text:'Start application'},{...evidencePage,text:'Application form',actions:[{kind:'click',status:'done'}],draftVerified:false}]
await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Prepare application with name: "Example"' ,mode:'draft'}),/browser_objective_unverified/)
modelText=JSON.stringify({approvedOperation:'none',draftReady:true,actions:[{kind:'fill',selector:'#name',value:'Example'}]})
queuedObservations=[{...evidencePage,text:'Application form'},{...evidencePage,text:'Application form',forms:[{inputs:[{selector:'#name',name:'name',label:'Name'}]}],actions:[{kind:'fill',status:'done'}],draftVerified:true}]
assert.equal((await evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Prepare application with name: "Example"' ,mode:'draft'})).status,'prepared')
queuedObservations=[{...evidencePage,text:'Application form'},{...evidencePage,text:'Application form',forms:[{inputs:[{selector:'#name',name:'name',label:'Name'},{selector:'#email',name:'email',label:'Email'}]}],actions:[{kind:'fill',status:'done'}],draftVerified:true}]
await assert.rejects(()=>evidenceComputer.runSecureBrowser({...readParams,url:evidencePage.url,objective:'Prepare application with name: "Example", email: "example@example.com"',mode:'draft'}),/browser_objective_unverified/)
let draftFieldValue=''
const draftPage={goto:async()=>{},waitForTimeout:async()=>{},evaluate:async()=>({url:'https://provider.example',text:'Draft form'}),locator:()=>({first:()=>({fill:async(value:string)=>{draftFieldValue=value},inputValue:async()=>draftFieldValue})})}
await runInNewContext(lockedComputer.BROWSER_SCRIPT,{require:()=>({chromium:{launchPersistentContext:async()=>({pages:()=>[draftPage],close:async()=>{}})}}),process:{argv:['node','browser',Buffer.from(JSON.stringify({url:'https://provider.example',mode:'draft',actions:[{kind:'fill',selector:'#name',value:'Example'}]})).toString('base64')],exit:()=>{throw new Error('unexpected script exit')}},Buffer,console:{log:(value:string)=>{boundaryOutput=JSON.parse(value)},error:console.error}})
assert.equal(boundaryOutput.draftVerified,true)
console.log('Draft completion requires a complete field plan and final DOM value verification; opening a form is insufficient')

const coveragePage={forms:[{inputs:[{selector:'#name',name:'name',label:'Name'},{selector:'#email',name:'email',label:'Email'}]}]}
const nameAction={kind:'fill',selector:'#name',value:'Example'}
assert.equal(draftObjectiveCovered('Prepare application with name: "Example", email: "example@example.com"',coveragePage,[nameAction]),false)
assert.equal(draftObjectiveCovered('Prepare application with name: "Example", email: "example@example.com"',coveragePage,[nameAction,{kind:'fill',selector:'#email',value:'example@example.com'}]),true)
assert.equal(draftObjectiveCovered('Prepare application with name: "Example" and also attach my CV',coveragePage,[nameAction]),false)
assert.equal(draftObjectiveCovered('Prepare application with name: "Example"',coveragePage,[{...nameAction,selector:'#email'}]),false)
assert.equal(draftObjectiveCovered('Prepare application with name: "Example"',coveragePage,[{...nameAction,value:'Wrong'}]),false)

const checkboxPage={forms:[{inputs:[{selector:'#terms',name:'terms',label:'Terms',type:'checkbox'}]}]}
assert.equal(draftObjectiveCovered('Prepare form with terms: "checked"',checkboxPage,[{kind:'check',selector:'#terms'}]),true)
assert.equal(draftObjectiveCovered('Prepare form with terms: "true"',checkboxPage,[{kind:'check',selector:'#terms'}]),true)
assert.equal(draftObjectiveCovered('Prepare form with terms: "false"',checkboxPage,[{kind:'check',selector:'#terms'}]),false)
assert.equal(draftObjectiveCovered('Prepare form with terms: "checked"',{forms:[{inputs:[{selector:'#terms',name:'terms',type:'text'}]}]},[{kind:'check',selector:'#terms'}]),false)

assert.equal(draftObjectiveCovered('Prepare web check-in for EY1. Booking reference/PNR: ABC123.',{},[]),null)
assert.equal(draftObjectiveCovered('Read the current status for this booking.',{},[]),null)
assert.equal(draftObjectiveCovered('Select product variant/size "M" and add exactly one item to the cart/bag.',{},[]),null)

assert.equal(draftObjectiveCovered('Fill the application — Country: "India", DOB: "1990-01-01"',{},[]),false)
assert.equal(draftObjectiveCovered('Fill draft — Custom field: "value"',{},[]),false)
assert.equal(draftObjectiveCovered("Fill form — Country: 'India'",{},[]),false)
assert.equal(draftObjectiveCovered('Fill form — Country = "India"',{},[]),false)
