import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const {makeGovernedRuntime,verifiedCeiling,meteredUsage,governedEnabled}=await import('../lib/agent/governed-runtime')
const {skillQuery,personalSkillCatalog,workspaceSkillCatalog}=await import('../lib/agent/governed-skill-catalog')
const now=Date.parse('2026-11-28T03:00:00Z')
const price={model:'model-verified',max_total_tokens:100,micros_per_token:7,valid_until:'2026-11-29T00:00:00Z',verified_source:'fixture:reviewed'}
const response={model:price.model,usage:{input_tokens:5,output_tokens:2,cache_read_input_tokens:3,cache_creation_input_tokens:1}}
assert.deepEqual(verifiedCeiling(price,price.model,now),{tokens:100,costMicrosInr:700})
assert.equal(verifiedCeiling(price,'different',now),null)
assert.equal(verifiedCeiling({...price,valid_until:'2026-11-27'},price.model,now),null)
assert.equal(verifiedCeiling({...price,max_total_tokens:Number.MAX_SAFE_INTEGER},price.model,now),null)
assert.deepEqual(meteredUsage(response,price),{tokens:11,costMicrosInr:77})
assert.equal(meteredUsage({...response,model:'other'},price),null)
assert.equal(meteredUsage({...response,usage:{input_tokens:5,output_tokens:-1}},price),null)
assert.equal(governedEnabled('personal','101',{}),false)
assert.equal(governedEnabled('personal','101',{GOGO_HACHI_ENFORCEMENT:'1',GOGO_HACHI_PERSONAL_OWNERS:'1010'}),false)
assert.equal(governedEnabled('personal','101',{GOGO_HACHI_ENFORCEMENT:'1',GOGO_HACHI_PERSONAL_OWNERS:'101'}),true)
const scope={kind:'personal' as const,id:'101',actorId:'101',runId:'test-run'}
let calls=0,attempt=0,authorized=true,current=true,tariff:any=price,reserve='reserved'
const receipts:{name:string;args:Record<string,unknown>}[]=[]
const deps={
  rpc:async(name:string,args:Record<string,unknown>)=>{receipts.push({name,args});return {data:name.includes('reserve')?reserve:'settled',error:null}},
  authorize:async()=>authorized,currentRun:async()=>current,tariff:async()=>tariff,now:()=>now,nextAttempt:()=>String(++attempt)
}
const rt=makeGovernedRuntime(scope,deps)
const execute=async()=>{calls++;return response}
assert.equal((await rt.model(price.model,execute,()=>true)).state,'completed')
assert.equal(calls,1)
assert.equal(receipts[0].args.p_cost_micros,700)
assert.equal(receipts[1].args.p_cost_micros,77)
reserve='cost'
assert.equal((await rt.model(price.model,execute,()=>true)).state,'blocked')
assert.equal(calls,1)
reserve='reserved';tariff=null
assert.equal((await rt.model(price.model,execute,()=>true)).state,'blocked')
assert.equal(calls,1)
tariff=price;authorized=false
assert.equal((await rt.model(price.model,execute,()=>true)).state,'blocked')
assert.equal(calls,1)
authorized=true;current=false
assert.equal((await rt.model(price.model,execute,()=>true)).state,'blocked')
current=true
assert.equal((await rt.local('web_search',execute,()=>true)).state,'blocked')
assert.equal(calls,1)
assert.equal((await rt.local('events_list',execute,()=>true)).state,'completed')
assert.equal(calls,2)
assert.equal((await rt.local('workspace_recorded_ask',execute,()=>true)).state,'blocked')
const ws=makeGovernedRuntime({kind:'workspace',id:'00000000-0000-4000-8000-000000000001',actorId:'101',runId:'ws-run'},deps)
assert.equal((await ws.local('workspace_recorded_ask',execute,()=>true)).state,'completed')
assert.equal((await ws.local('events_list',execute,()=>true)).state,'blocked')
assert.equal(calls,3)
assert.equal(skillQuery('show skills'),'')
assert.equal(skillQuery('find skill for calendar'),'calendar')
assert.equal(skillQuery('please execute skill'),null)
assert.match(await personalSkillCatalog('',async()=> 'read'),/people\.brief/)
assert.doesNotMatch(await personalSkillCatalog('',async()=> 'read'),/merchant\.order|workspace\.orders/)
assert.match(await personalSkillCatalog('',async()=> 'off'),/No matching/)
assert.doesNotMatch(workspaceSkillCatalog('',true),/people\.brief|thread\.reply/)
assert.match(workspaceSkillCatalog('stock',true),/workspace\.stock\.summary/)
assert.match(workspaceSkillCatalog('',false),/workspace\.shared\.reports/)
assert.match(workspaceSkillCatalog('stock',false),/No matching/)
const {selectGovernedOwner,governedModelCall,openAICompatibleReceipt}=await import('../lib/agent/governed-model-call')
const env={GOGO_HACHI_ENFORCEMENT:'1',GOGO_HACHI_PERSONAL_OWNERS:'101'}
assert.deepEqual(selectGovernedOwner('101','101',env),{kind:'governed',owner:'101'})
assert.deepEqual(selectGovernedOwner(undefined,'101',env),{kind:'governed',owner:'101'})
assert.deepEqual(selectGovernedOwner('102','101',env),{kind:'invalid'})
assert.deepEqual(selectGovernedOwner('101',Number.MAX_SAFE_INTEGER+1,env),{kind:'invalid'})
assert.deepEqual(selectGovernedOwner('102','102',env),{kind:'legacy'})
assert.deepEqual(selectGovernedOwner('101','101',{}),{kind:'legacy'})
assert.deepEqual(openAICompatibleReceipt({model:'gpt-exact',usage:{prompt_tokens:20,completion_tokens:5,prompt_tokens_details:{cached_tokens:10}}}),{model:'gpt-exact',usage:{input_tokens:20,output_tokens:5}})
let guardedCalls=0
const adapterDeps={selection:()=>({kind:'governed' as const,owner:'101'}),open:async()=>rt,now:()=>now}
const result=await governedModelCall(price.model,async guarded=>{assert.equal(guarded,true);guardedCalls++;return response},x=>x,'101',adapterDeps)
assert.deepEqual(result,response)
reserve='cost'
await assert.rejects(()=>governedModelCall(price.model,async()=>{guardedCalls++;return response},x=>x,'101',adapterDeps),/governed_model_cost/)
assert.equal(guardedCalls,1)
reserve='reserved'
await assert.rejects(()=>governedModelCall(price.model,async()=>{guardedCalls++;return response},x=>x,'101',{...adapterDeps,open:async()=>null}),/policy_unavailable/)
assert.equal(guardedCalls,1)
await assert.rejects(()=>governedModelCall(price.model,async()=>{guardedCalls++;return response},x=>x,'101',{...adapterDeps,selection:()=>({kind:'invalid'})}),/identity_mismatch/)
assert.equal(guardedCalls,1)
await assert.rejects(()=>governedModelCall(price.model,async()=>{guardedCalls++;throw Error('transport')},x=>x,'101',adapterDeps),/attempt_outcome_unverified/)
assert.equal(guardedCalls,2)
assert.equal(receipts.at(-1)?.args.p_cost_micros,null)
const {validBoundedSearch,governedSearchFetch}=await import('../lib/agent/governed-search-call')
const url='https://api.tavily.com/search'
const init={method:'POST',body:JSON.stringify({api_key:'fixture',query:'test',topic:'general',search_depth:'basic',max_results:5,include_answer:false})}
assert.equal(validBoundedSearch('tavily.basic.v1',url,init),true)
assert.equal(validBoundedSearch('tavily.basic.v1','https://other.example/search',init),false)
assert.equal(validBoundedSearch('tavily.basic.v1',url,{...init,body:JSON.stringify({...JSON.parse(init.body),search_depth:'advanced'})}),false)
assert.equal(validBoundedSearch('tavily.basic.v1',url,{...init,body:JSON.stringify({...JSON.parse(init.body),include_raw_content:true})}),false)
const searchPrice={operation:'tavily.basic.v1',max_cost_micros:9,valid_until:price.valid_until,verified_source:'fixture:reviewed'}
let searchTariff:any=searchPrice,searchCalls=0
const searchRt=makeGovernedRuntime(scope,{...deps,operationTariff:async()=>searchTariff})
const searchDeps={selection:adapterDeps.selection,open:async()=>searchRt,now:()=>now,fetcher:async(input:any,options?:RequestInit)=>{
  assert.equal(input,url);assert.equal(options?.redirect,'error');searchCalls++
  return new Response(JSON.stringify({results:[]}),{headers:{'Content-Type':'application/json'}})
}}
assert.equal((await governedSearchFetch('tavily.basic.v1',url,init,searchDeps)).status,200)
assert.equal(searchCalls,1)
assert.equal(receipts.at(-1)?.args.p_cost_micros,9)
reserve='cost'
await assert.rejects(()=>governedSearchFetch('tavily.basic.v1',url,init,searchDeps),/governed_model_cost/)
assert.equal(searchCalls,1)
reserve='reserved';searchTariff=null
await assert.rejects(()=>governedSearchFetch('tavily.basic.v1',url,init,searchDeps),/price_unavailable/)
assert.equal(searchCalls,1)
searchTariff=searchPrice
await assert.rejects(()=>governedSearchFetch('tavily.basic.v1','https://other.example/search',init,searchDeps),/unpriced_search_shape/)
assert.equal(searchCalls,1)
await assert.rejects(()=>governedSearchFetch('tavily.basic.v1',url,init,{...searchDeps,fetcher:async()=>{searchCalls++;return new Response('error',{status:503})}}),/attempt_outcome_unverified/)
assert.equal(searchCalls,2)
assert.equal(receipts.at(-1)?.args.p_cost_micros,null)
// The actual nested adapter uses the SAME run, not a new per-provider scope.
const {currentGovernedRun,withGovernedPersonalRun}=await import('../lib/agent/governed-run-context')
searchCalls=0
const beforeNested=receipts.length
const nestedDeps={...searchDeps,open:async()=>{throw Error('must reuse parent')}}
assert.equal((await searchRt.nestedSearch('web_search',async()=>{
  assert.equal(currentGovernedRun()?.owner,'101')
  return governedSearchFetch('tavily.basic.v1',url,init,nestedDeps)
},()=>true)).state,'completed')
assert.equal(searchCalls,1)
assert.equal(currentGovernedRun(),null)
const nestedReceipts=receipts.slice(beforeNested)
assert.equal(nestedReceipts.filter(x=>x.name.includes('reserve')).length,2)
assert.ok(nestedReceipts.every(x=>x.args.p_run_id===scope.runId&&x.args.p_actor_id==='101'))
assert.equal(nestedReceipts.filter(x=>x.name.includes('reserve')).map(x=>Number(x.args.p_cost_micros)).reduce((a,b)=>a+b,0),9)
await withGovernedPersonalRun('101',searchRt,()=>true,async()=>{
  await assert.rejects(()=>governedSearchFetch('tavily.basic.v1',url,init,{...nestedDeps,selection:()=>({kind:'governed',owner:'102'})}),/nested_scope_mismatch/)
  await assert.rejects(()=>governedSearchFetch('tavily.basic.v1',url,init,{...nestedDeps,selection:()=>({kind:'legacy'})}),/nested_scope_mismatch/)
})
assert.equal(searchCalls,1)
let late:(()=>Promise<Response>)|undefined
await withGovernedPersonalRun('101',searchRt,()=>true,async()=>{
  // Capture a real async continuation. Closing the parent invalidates it.
  const parent=currentGovernedRun()!
  late=async()=>{assert.equal(parent.inTime(),false);return new Response('closed')}
})
await late!()
assert.equal((await searchRt.nestedSearch('web_search',async()=>{searchCalls++;return 'not reached'},()=>false)).state,'blocked')
assert.equal(searchCalls,1)
const {authorizeGovernedFetch,withReservedOutbound,exactReservedModelBody}=await import('../lib/agent/governed-outbound-fence')
assert.equal(exactReservedModelBody({model:'claude-fixture',stream:true},'claude-fixture'),false)
assert.equal(exactReservedModelBody({model:'claude-fixture',tools:[{type:'web_search_20250305'}]},'claude-fixture'),false)
assert.equal(await authorizeGovernedFetch('https://example.com'), 'legacy')
const fixtureEnv={NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co'}
await withGovernedPersonalRun('101',searchRt,()=>true,async()=>{
  assert.equal(await authorizeGovernedFetch('https://fixture.supabase.co/rest/v1/users',{},fixtureEnv),'database')
  await assert.rejects(()=>authorizeGovernedFetch('https://api.openai.com/v1/chat/completions',{method:'POST'},fixtureEnv),/unreserved/)
  await assert.rejects(()=>authorizeGovernedFetch('https://fixture.supabase.co.evil.example/rest/v1/users',{},fixtureEnv),/unreserved/)
  await withReservedOutbound('model','claude-fixture',async()=>{
    const request={method:'POST',body:JSON.stringify({model:'claude-fixture',messages:[]})}
    assert.equal(await authorizeGovernedFetch('https://api.anthropic.com/v1/messages',request,fixtureEnv),'provider')
    await assert.rejects(()=>authorizeGovernedFetch('https://api.anthropic.com/v1/messages',request,fixtureEnv),/unreserved/)
  })
  await withReservedOutbound('search','tavily.basic.v1',async()=>{
    await assert.rejects(()=>authorizeGovernedFetch('https://example.com',{method:'POST'},fixtureEnv),/shape/)
    assert.equal(await authorizeGovernedFetch(url,init,fixtureEnv),'provider')
  })
})
// Foreground budget is one lazy run across model and search calls, even
// concurrent initial attempts. No independent fallback after a failed open.
const {withGovernedForeground,bindGovernedForegroundOwner,currentGovernedForeground,foregroundRuntime}=await import('../lib/agent/governed-run-context')
let opens=0
const sharedDeps={...adapterDeps,open:async()=>{opens++;return searchRt}}
const sharedSearch={...searchDeps,open:sharedDeps.open}
await withGovernedForeground(async()=>{
  bindGovernedForegroundOwner('101')
  const result=await Promise.all([governedModelCall(price.model,async()=>response,x=>x,'101',sharedDeps),governedSearchFetch('tavily.basic.v1',url,init,sharedSearch)])
  assert.equal(result[0].model,price.model);assert.equal(result[1].status,200)
  assert.equal(opens,1,'one foreground budget even with concurrent first calls')
  reserve='steps'
  const callsBefore=searchCalls
  await assert.rejects(()=>governedSearchFetch('tavily.basic.v1',url,init,sharedSearch),/governed_model_steps/)
  assert.equal(searchCalls,callsBefore)
  assert.equal(opens,1)
  assert.throws(()=>bindGovernedForegroundOwner('102'),/foreground_identity/)
  reserve='reserved'
})
assert.equal(currentGovernedForeground(),null)
await withGovernedForeground(async()=>{
  bindGovernedForegroundOwner('101')
  const absent=await foregroundRuntime('101',async()=>{opens++;return null})
  assert.equal(absent,null)
  assert.equal(await foregroundRuntime('101',async()=>{opens++;return searchRt}),null)
  assert.equal(opens,2)
})
const {withTrustedMeterWrite}=await import('../lib/agent/governed-outbound-fence')
let deferred:Promise<unknown>|undefined,release!:()=>void
const trigger=new Promise<void>(r=>{release=r})
await withGovernedPersonalRun('101',searchRt,()=>true,async()=>{
  await withReservedOutbound('model','claude-fixture',async()=>{
    deferred=trigger.then(()=>withTrustedMeterWrite(async()=>{
      assert.equal(await authorizeGovernedFetch('https://fixture.supabase.co/rest/v1/admin_rate_card?select=key',{method:'GET'},fixtureEnv),'database')
      assert.equal(await authorizeGovernedFetch('https://fixture.supabase.co/rest/v1/admin_cost_events',{method:'POST'},fixtureEnv),'database')
      await assert.rejects(()=>authorizeGovernedFetch('https://fixture.supabase.co/rest/v1/users',{method:'GET'},fixtureEnv),/meter_egress_denied/)
      await assert.rejects(()=>authorizeGovernedFetch('https://api.anthropic.com/v1/messages',{method:'POST'},fixtureEnv),/meter_egress_denied/)
    }))
  })
})
release();await deferred
const {googleRequestShape}=await import('../lib/agent/governed-connector-shapes')
const {governedGoogleFetch,credentialAuthorized}=await import('../lib/agent/governed-google-read')
const {createHash}=await import('node:crypto')
const fingerprint=(s:string)=>createHash('sha256').update(s).digest('hex')
const calendarUrl='https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=40'
const calendarInit={headers:{Authorization:'Bearer access-fixture'}}
assert.ok(googleRequestShape('google.calendar.read',calendarUrl,calendarInit))
assert.equal(googleRequestShape('google.calendar.read',calendarUrl,{...calendarInit,method:'POST'}),null)
assert.equal(googleRequestShape('google.calendar.read',calendarUrl.replace('maxResults=40','maxResults=999'),calendarInit),null)
assert.equal(googleRequestShape('google.gmail.read','https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:calendarInit.headers}),null)
assert.equal(googleRequestShape('google.gmail.read','https://gmail.googleapis.com.evil.example/gmail/v1/users/me/messages',calendarInit),null)
const connectorPrice={operation:'google.calendar.read',max_cost_micros:0,valid_until:price.valid_until,verified_source:'fixture:reviewed'}
let googleCalls=0,credentialLive=true,permissionLive=true,priceLive=true
const googleRt=makeGovernedRuntime(scope,{...deps,connectorTariff:async op=>priceLive?{...connectorPrice,operation:op}:null})
const credentialSnapshot={refreshHashes:new Set([fingerprint('refresh-fixture')]),accessHashes:new Set<string>()}
const googleDeps={selection:adapterDeps.selection,open:async()=>googleRt,now:()=>now,permission:async()=>permissionLive,snapshot:async()=>credentialLive?credentialSnapshot:null,
  fetcher:async(input:any)=>{googleCalls++;return String(input).includes('oauth2.googleapis.com/token')?new Response(JSON.stringify({access_token:'access-fixture',expires_in:3600})):new Response(JSON.stringify({items:[]}))}}
const refreshInit={method:'POST',body:new URLSearchParams({refresh_token:'refresh-fixture',client_id:'fixture-client',client_secret:'fixture-secret',grant_type:'refresh_token'})}
const tokenUrl='https://oauth2.googleapis.com/token'
await assert.rejects(()=>governedGoogleFetch('google.calendar.read',calendarUrl,calendarInit,'101',googleDeps),/not_authorized/)
assert.equal(googleCalls,0)
assert.equal((await governedGoogleFetch('google.calendar.refresh',tokenUrl,refreshInit,'101',googleDeps)).status,200)
assert.equal((await governedGoogleFetch('google.calendar.read',calendarUrl,calendarInit,'101',googleDeps)).status,200)
assert.equal(googleCalls,2)
credentialLive=false
await assert.rejects(()=>governedGoogleFetch('google.calendar.read',calendarUrl,calendarInit,'101',googleDeps),/not_authorized/)
credentialLive=true;permissionLive=false
await assert.rejects(()=>governedGoogleFetch('google.calendar.read',calendarUrl,calendarInit,'101',googleDeps),/not_authorized/)
permissionLive=true;priceLive=false
await assert.rejects(()=>governedGoogleFetch('google.calendar.read',calendarUrl,calendarInit,'101',googleDeps),/price_unavailable/)
assert.equal(googleCalls,2)
priceLive=true
await assert.rejects(()=>governedGoogleFetch('google.calendar.read',calendarUrl,{headers:{Authorization:'Bearer another-owner-token'}},'101',googleDeps),/not_authorized/)
assert.equal(googleCalls,2)
await withReservedOutbound('connector',calendarUrl,async()=>{
  await assert.rejects(()=>authorizeGovernedFetch(calendarUrl,{method:'POST'},fixtureEnv),/shape/)
  assert.equal(await authorizeGovernedFetch(calendarUrl,calendarInit,fixtureEnv),'provider')
  await assert.rejects(()=>authorizeGovernedFetch(calendarUrl,calendarInit,fixtureEnv),/unreserved/)
},'GET')
console.log('Hachi scoped runtime boundary fixtures passed')


// Actual nested run/connector boundaries: authorization is not cached across
// acquisition, pages, nested children or the final physical dispatch fence.
let recoveryLive=true,guardedPages=0
const guard=async()=>recoveryLive
const connectorDeps={...googleDeps,fetcher:async()=>{guardedPages++;return new Response(JSON.stringify({items:[]}))},snapshot:async()=>({refreshHashes:new Set<string>(),accessHashes:new Set([fingerprint('access-fixture')])})}
await withGovernedPersonalRun('101',googleRt,()=>true,async()=>{
  assert.equal((await governedGoogleFetch('google.calendar.read',calendarUrl,calendarInit,'101',connectorDeps)).status,200)
  recoveryLive=false
  await assert.rejects(()=>governedGoogleFetch('google.calendar.read',calendarUrl,calendarInit,'101',connectorDeps),/not_authorized|revoked/)
  assert.equal(guardedPages,1)
  await assert.rejects(()=>withGovernedPersonalRun('101',googleRt,()=>true,async()=>{guardedPages++}),/authority_revoked/)
},guard)
recoveryLive=true
await withGovernedPersonalRun('101',googleRt,()=>true,async()=>{
  await withReservedOutbound('connector',calendarUrl,async()=>{
    recoveryLive=false
    await assert.rejects(()=>authorizeGovernedFetch(calendarUrl,calendarInit,fixtureEnv),/authority_revoked/)
  },'GET')
},guard)
assert.equal(guardedPages,1)
console.log('Inherited recovery authorization rechecked for actual nested connector and physical dispatch boundaries')


// Read API cannot become a mutation. Exact approved body and fresh callback
// are required before the priced Gmail provider request; revoked grant never
// reaches the transport. These are inert fixture requests, not real mail.
const {governedApprovedGmailFetch}=await import('../lib/agent/governed-google-read')
const {gmailSendWireBody}=await import('../lib/services/google-gmail')
const gmailUrl='https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const sendBody=gmailSendWireBody({threadId:'fixture_thread',to:'fixture@example.invalid',subject:'Fixture',body:'Only fixture'})
const sendInit={method:'POST',headers:{Authorization:'Bearer access-fixture','Content-Type':'application/json'},body:sendBody}
assert.ok(googleRequestShape('google.gmail.send',gmailUrl,sendInit))
await assert.rejects(()=>governedGoogleFetch('google.gmail.send',gmailUrl,sendInit,'101',connectorDeps),/exact_send_approval_required/)
let sendLive=true,mailDispatches=0
const mailDeps={...connectorDeps,fetcher:async()=>{mailDispatches++;return new Response(JSON.stringify({id:'sent-fixture',threadId:'fixture_thread'}))}}
const authority={actorId:'fixture-user-uuid',senderAccount:'fixture@example.test',expectedBody:sendBody,authorize:async()=>sendLive}
await assert.rejects(()=>governedApprovedGmailFetch(gmailUrl,{...sendInit,body:JSON.stringify({raw:'tampered'})},'101',authority,mailDeps),/exact_send_approval_required/)
sendLive=false
await assert.rejects(()=>governedApprovedGmailFetch(gmailUrl,sendInit,'101',authority,mailDeps),/not_authorized/)
assert.equal(mailDispatches,0)
sendLive=true
assert.equal((await governedApprovedGmailFetch(gmailUrl,sendInit,'101',authority,mailDeps)).status,200)
assert.equal(mailDispatches,1)
await withReservedOutbound('connector',gmailUrl,async()=>{
  sendLive=false
  await assert.rejects(()=>authorizeGovernedFetch(gmailUrl,sendInit,fixtureEnv),/authority_revoked/)
},'POST',authority.authorize)
assert.equal(mailDispatches,1)
console.log('Approved Gmail connector wire payload, current authority, read/write separation and physical fence fixtures passed')


// Pin governance across a mid-request kill-switch or owner-selection change.
// The actual adapter must not invoke its legacy callback after revocation.
const savedEnforcement=process.env.GOGO_HACHI_ENFORCEMENT,savedOwners=process.env.GOGO_HACHI_PERSONAL_OWNERS
try{
  process.env.GOGO_HACHI_ENFORCEMENT='1'
  process.env.GOGO_HACHI_PERSONAL_OWNERS='101'
  await withGovernedForeground(async()=>{
    bindGovernedForegroundOwner('101')
    process.env.GOGO_HACHI_ENFORCEMENT='0'
    let calls=0
    await assert.rejects(()=>governedModelCall('claude-fixture',async()=>{calls++;return response},x=>x,'101'),/identity_mismatch|governance_revoked/)
    assert.equal(calls,0)
    assert.equal((await import('../lib/agent/governed-model-call')).selectedModelOwner('101').kind,'invalid')
  })
  await withGovernedForeground(async()=>{
    bindGovernedForegroundOwner('101',true)
    let calls=0
    await assert.rejects(()=>governedModelCall('claude-fixture',async()=>{calls++;return response},x=>x,'101'),/identity_mismatch|governance_revoked/)
    assert.equal(calls,0)
  })
}finally{
  if(savedEnforcement===undefined)delete process.env.GOGO_HACHI_ENFORCEMENT;else process.env.GOGO_HACHI_ENFORCEMENT=savedEnforcement
  if(savedOwners===undefined)delete process.env.GOGO_HACHI_PERSONAL_OWNERS;else process.env.GOGO_HACHI_PERSONAL_OWNERS=savedOwners
}
console.log('Originally governed foreground and resumed worker cannot downgrade to legacy after selection revocation')


// Selected Calendar move permits only an exact time-only PATCH with If-Match;
// the ordinary read adapter cannot dispatch it. No real Calendar is modified.
const {governedApprovedCalendarMoveFetch}=await import('../lib/agent/governed-google-read')
const moveUrl='https://www.googleapis.com/calendar/v3/calendars/primary/events/fixture-event'
const moveBody=JSON.stringify({start:{dateTime:'2026-12-01T10:00:00Z',timeZone:'Asia/Kolkata'},end:{dateTime:'2026-12-01T11:00:00Z',timeZone:'Asia/Kolkata'}})
const moveInit={method:'PATCH',headers:{Authorization:'Bearer access-fixture','If-Match':'"fixture-etag"','Content-Type':'application/json'},body:moveBody}
assert.ok(googleRequestShape('google.calendar.move',moveUrl,moveInit))
assert.equal(googleRequestShape('google.calendar.move',moveUrl,{...moveInit,headers:{...moveInit.headers,'If-Match':'*'}}),null)
assert.equal(googleRequestShape('google.calendar.move',moveUrl,{...moveInit,body:JSON.stringify({...JSON.parse(moveBody),attendees:[]})}),null)
assert.equal(googleRequestShape('google.calendar.move',moveUrl+'?sendUpdates=all',moveInit),null)
await assert.rejects(()=>governedGoogleFetch('google.calendar.move',moveUrl,moveInit,'101',connectorDeps),/exact_send_approval_required/)
let moveAllowed=true,moveDispatches=0
const moveDeps={...connectorDeps,fetcher:async()=>{moveDispatches++;return new Response(JSON.stringify({id:'fixture-event',status:'confirmed'}))}}
const moveAuthority={actorId:'fixture-user-uuid',credentialKey:fingerprint('refresh-fixture'),expectedUrl:moveUrl,expectedBody:moveBody,expectedEtag:'"fixture-etag"',authorize:async()=>moveAllowed}
await assert.rejects(()=>governedApprovedCalendarMoveFetch(moveUrl,{...moveInit,headers:{...moveInit.headers,'If-Match':'"different"'}},'101',moveAuthority,moveDeps),/exact_calendar_approval_required/)
moveAllowed=false
await assert.rejects(()=>governedApprovedCalendarMoveFetch(moveUrl,moveInit,'101',moveAuthority,moveDeps),/not_authorized/)
assert.equal(moveDispatches,0)
moveAllowed=true
assert.equal((await governedApprovedCalendarMoveFetch(moveUrl,moveInit,'101',moveAuthority,moveDeps)).status,200)
assert.equal(moveDispatches,1)
console.log('Calendar exact event/version/time approval boundary passed in inert fixture')
