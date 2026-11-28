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
console.log('Hachi scoped runtime boundary fixtures passed')
