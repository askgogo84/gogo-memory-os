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
let browserCompleted=false,vaultCalls=0,browserActions:any[]=[],reconciliationEvidence:any,browserExecutions=0
const command=load('browser-command.ts',{
  './post-auth-outcome':{inspectPostAuthRun:async()=>{if(reconciliationEvidence)return reconciliationEvidence;throw new Error('reconciliation_session_unavailable')}},
  '@/lib/supabase-admin':{supabaseAdmin:db},
  '@/lib/bot/memory-redaction':{redactSecretShapedText:(s:string)=>s},
  './sentinel':{evaluateAgentSentinel:()=>({allowed:true})},
  './secure-computer':{runSecureBrowser:async()=>{browserExecutions++;return browserCompleted
    ? {status:'completed',url:'https://provider.example/account',title:'Account',summary:'Read account',forms:[],actions:[]}
    : {status:'blocked',blockReason:'human_auth_required',authReason:'device_approval',url:'https://provider.example/account',summary:'Approve sign-in',actions:browserActions}}},
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
  {kind:'click',status:'failed',consequential:true},
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
for(const [label,throws,expected,mode] of [['Confirm reservation',false,true,'execute'],['Confirm reservation',true,true,'execute'],['Search',false,false,'execute'],['Confirm reservation',false,true,'read']] as const){
  let output:any
  const element={textContent:label,tagName:'BUTTON',id:'action',getAttribute:(name:string)=>name==='type'?'button':null}
  const page={goto:async()=>{},waitForTimeout:async()=>{},evaluate:async()=>({url:'https://login.example',text:'Approve this sign-in'}),locator:()=>({first:()=>({evaluate:async(fn:any)=>fn(element),click:async()=>{if(throws)throw new Error('timeout after click')}})})}
  await runInNewContext(lockedComputer.BROWSER_SCRIPT,{require:()=>({chromium:{launchPersistentContext:async()=>({pages:()=>[page],close:async()=>{}})}}),
    process:{argv:['node','browser',Buffer.from(JSON.stringify({url:'https://provider.example',mode,actions:[{kind:'click',selector:'#action'}]})).toString('base64')],exit:()=>{throw new Error('unexpected script exit')}},Buffer,console:{log:(value:string)=>{output=JSON.parse(value)},error:console.error}})
  const actions=lockedComputer.normalizeActionLog(output.actions)
  assert.equal(actions[0].consequential,expected,'the executed DOM control determines replay safety')
  assert.equal(actions[0].status,mode==='read'?'skipped':throws?'failed':'done')
}
console.log('Production browser script records consequential clicks and uncertain click outcomes')
let browserReads=0,finalStops=0,finalUnlocks=0
const finalGateComputer=load('secure-computer.ts',{
  '@anthropic-ai/sdk':{default:class {messages={create:async()=>({content:[{type:'text',text:'[{"kind":"click","selector":"#confirm"}]'}]})}}},
  '@vercel/sandbox':{Sandbox:{getOrCreate:async()=>({writeFiles:async()=>{},updateNetworkPolicy:async()=>{},stop:async()=>{finalStops++},
    runCommand:async()=>({exitCode:0,stdout:async()=>JSON.stringify(browserReads++===0
      ? {url:'https://provider.example',title:'Reservation',text:'Review reservation',forms:[]}
      : {url:'https://login.example',title:'Sign in',text:'Approve this sign-in',forms:[],actions:[{kind:'click',detail:'#confirm',status:'done',consequential:true}]})})})}},
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
let trainSaveFails=false,trainCancelled=0
const trainDb={from:(table:string)=>{let change:any;const q:any={select:()=>q,eq:()=>q,insert:()=>q,update:(value:any)=>{change=value;return q},single:async()=>({data:{id:'step'},error:null}),then:(resolve:any)=>Promise.resolve({data:null,count:0,error:trainSaveFails&&table==='agent_runs'&&change?.metadata_json?.handoff?{message:'failed'}:null}).then(resolve)};return q}}
const train=load('train-research.ts',{
  '@anthropic-ai/sdk':{default:class {}},'@/lib/supabase-admin':{supabaseAdmin:trainDb},
  './secure-computer':{runSecureBrowser:async(params:any)=>{assert.equal(params.reserveHumanHandoff,true);return {status:'blocked',blockReason:'human_auth_required',authReason:'device_approval',url:'https://www.irctc.co.in',handoffReservation:'train-transfer'}}},
  './provider-browser-handoff':{startProviderBrowserHandoff:async(params:any)=>{assert.equal(params.reservationToken,'train-transfer');return handoff},cancelProviderBrowserHandoff:async()=>{trainCancelled++}},
})
const trainParams={actor:{userId:'owner',legacyTelegramId:1},surface:'dashboard',runId:'train-run',c:{from:{label:'A',code:'A'},to:{label:'B',code:'B'},routeLabel:'A to B',date:'2026-10-01'},inputText:'Find trains',directOnly:true}
assert.equal((await train.executeTrainRun(trainParams)).status,'paused')
trainSaveFails=true
assert.equal((await train.executeTrainRun(trainParams)).status,'failed')
assert.equal(trainCancelled,1,'train research must release takeover if its token cannot be saved')
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
