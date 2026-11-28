import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL||='https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY||='fixture'
const {validVoiceRequest,governedVoiceFetch}=await import('../lib/agent/governed-provider-call')
const {voicePlanHash}=await import('../lib/agent/voice-call-execution')
const {makeGovernedRuntime}=await import('../lib/agent/governed-runtime')
const plan={to:'+919999999999',venue:'Fixture',governedCall:{version:'bolna-approved-v1',agentId:'fixture-id',from:'+918000000000',contact:'',maxSeconds:180}}
assert.notEqual(voicePlanHash('101',plan),voicePlanHash('101',{...plan,governedCall:{...plan.governedCall,maxSeconds:179}}))
const url='https://api.bolna.ai/call',body=JSON.stringify({agent_id:'fixture-id',recipient_phone_number:plan.to,from_phone_number:plan.governedCall.from,user_data:{venue:'Fixture'}})
const init={method:'POST',body}
assert.equal(validVoiceRequest('bolna.call.v1',url,init,body),true)
assert.equal(validVoiceRequest('bolna.call.v1',url,init,'different'),false)
assert.equal(validVoiceRequest('bolna.call.v1','https://api.bolna.ai/v2/agent',init,body),false)
assert.equal(validVoiceRequest('bolna.execution.read.v1','https://api.bolna.ai/executions/fixture-id',{method:'GET'}),true)
assert.equal(validVoiceRequest('bolna.execution.read.v1','https://api.bolna.ai/executions/fixture-id?other=1',{method:'GET'}),false)
let permit=true,calls=0,tariff=true
const now=Date.now(),scope={kind:'personal' as const,id:'101',actorId:'101',runId:'voice-fixture'}
const runtime=makeGovernedRuntime(scope,{rpc:async(name)=>({data:name.includes('reserve')?'reserved':'settled',error:null}),authorize:async()=>true,currentRun:async()=>true,tariff:async()=>null,connectorTariff:async operation=>tariff?{operation,max_cost_micros:100,valid_until:new Date(now+60000).toISOString(),verified_source:'fixture'}:null,now:()=>now,nextAttempt:()=> 'fixture-attempt'})
const deps={selection:()=>({kind:'governed' as const,owner:'101'}),open:async()=>runtime,now:()=>now,fetcher:async()=>{calls++;return new Response(JSON.stringify({execution_id:'fixture-accepted'}))}}
const request={operation:'bolna.call.v1' as const,owner:'101',url,init,expectedBody:body,authorize:async()=>permit}
permit=false;await assert.rejects(()=>governedVoiceFetch(request,deps),/not_authorized/);assert.equal(calls,0)
permit=true;tariff=false;await assert.rejects(()=>governedVoiceFetch(request,deps),/price_unavailable/);assert.equal(calls,0)
tariff=true;assert.equal((await governedVoiceFetch(request,deps)).status,200);assert.equal(calls,1)
await assert.rejects(()=>governedVoiceFetch({...request,owner:'102'},deps),/identity_mismatch/);assert.equal(calls,1)
console.log('Governed voice plan binding, exact endpoints, price/authority denial and receipt fixture passed; no real call')
