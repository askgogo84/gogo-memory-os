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
assert.match(workspaceSkillCatalog('',false),/No matching/)
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
console.log('Hachi scoped runtime boundary fixtures passed')
