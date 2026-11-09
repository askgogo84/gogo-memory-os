import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// TEST-ONLY: run the original functions in isolated synthetic contexts.
// No runtime imports, network calls, credentials, real database or provider access.
function original(path,name,bindings){
  const file=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
  const node=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)
  assert.ok(node,'missing original source '+path+'::'+name)
  const code=ts.transpileModule(node.getText(file).replace(/^export\s+/,''),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},reportDiagnostics:true
  })
  assert.ok(!code.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error),'source transpilation failure')
  return vm.runInNewContext(code.outputText+'\n'+name,{
    ...bindings,Date,Error,console:{error(){}},
    fetch:async()=>{throw Error('NETWORK_FORBIDDEN_IN_SYNTHETIC_TEST')}
  },{timeout:1000})
}
function fakeQuery(value){
  const q={select(){return q},eq(){return q},not(){return q},order(){return q},limit(){return q},
    then(ok,bad){return Promise.resolve().then(value).then(ok,bad)}}
  return q
}
async function pushOutcome(devices,error=null){
  const db={from(table){assert.equal(table,'agent_devices');return fakeQuery(()=>({data:devices,error}))}}
  const fn=original('lib/agent/push.ts','sendAgentPush',{supabaseAdmin:db})
  return await fn('73001',{title:'Inert boarding pass',body:'No actual push'})
}
async function outbox(senderResult={sent:1,failed:0},pending=[{id:'synthetic-notice'}],claim={
  telegramId:'73001',runId:'synthetic-run',lifeEventId:'synthetic-trip',scheduleRevision:'v1'
}){
  const updates=[],claims=[],calls=[]
  const db={
    from(table){
      assert.equal(table,'boarding_pass_outbox')
      return {
        select(){return fakeQuery(()=>({data:pending,error:null}))},
        update(payload){return fakeQuery(()=>{updates.push({...payload});return {data:null,error:null}})}
      }
    },
    async rpc(name,args){
      assert.equal(name,'gogo_claim_boarding_pass_notice')
      claims.push(args.p_id)
      return {data:claim,error:null}
    }
  }
  const sendAgentPush=async(id,body)=>{
    calls.push({id,title:body.title,runId:body.data?.runId})
    return senderResult
  }
  const fn=original('lib/agent/life-event-email-worker.ts','deliverBoardingPassNotices',{
    supabaseAdmin:db,sendAgentPush
  })
  await fn()
  return {updates,claims,calls}
}
let controls=0,controlFailures=0,safety=0,safetyFailures=0
async function check(name,kind,fn){
  if(kind==='CONTROL')controls++;else safety++
  try{await fn();console.log(kind+' PASS: '+name)}
  catch(e){
    if(kind==='CONTROL')controlFailures++;else safetyFailures++
    console.error(kind+' FAIL: '+name+': '+String(e?.message||e))
  }
}
await check('no pending notice causes no send','CONTROL',async()=>{
  const r=await outbox(undefined,[])
  assert.equal(r.calls.length,0);assert.equal(r.updates.length,0)
})
await check('unclaimed notice causes no send','CONTROL',async()=>{
  const r=await outbox(undefined,undefined,null)
  assert.equal(r.calls.length,0);assert.equal(r.updates.length,0)
})
await check('one provider-accepted push ticket is recorded as sent, not verified delivered','CONTROL',async()=>{
  const r=await outbox({sent:1,failed:0})
  assert.equal(r.calls.length,1);assert.equal(r.calls[0].id,'73001')
  assert.equal(r.updates[0].status,'sent')
})
await check('definitively rejected push is recorded failed','CONTROL',async()=>{
  const r=await outbox({sent:0,failed:1})
  assert.equal(r.updates[0].status,'failed')
})
await check('NO registered device cannot mark boarding-pass outbox sent','SAFETY',async()=>{
  const actual=await pushOutcome([])
  assert.equal(actual.sent,0);assert.equal(actual.failed,0)
  const r=await outbox(actual)
  assert.notEqual(r.updates[0]?.status,'sent','no device and no provider send were recorded sent')
})
await check('device-query error cannot mark boarding-pass outbox sent','SAFETY',async()=>{
  const actual=await pushOutcome([],{message:'synthetic device DB outage'})
  assert.equal(actual.sent,0);assert.equal(actual.failed,0)
  const r=await outbox(actual)
  assert.notEqual(r.updates[0]?.status,'sent','failed device lookup was recorded sent')
})
await check('blank registered token cannot mark boarding-pass outbox sent','SAFETY',async()=>{
  const actual=await pushOutcome([{id:'synthetic-device',expo_push_token:'   '}])
  assert.equal(actual.sent,0);assert.equal(actual.failed,0)
  const r=await outbox(actual)
  assert.notEqual(r.updates[0]?.status,'sent','blank device token/no send was recorded sent')
})
console.log('SUMMARY '+(controls-controlFailures)+'/'+controls+' positive controls PASS; '+
  (safety-safetyFailures)+'/'+safety+' safety assertions PASS; '+controlFailures+' harness failures')
if(controlFailures){console.error('INVALID HARNESS; DO NOT INFER SOURCE DEFECT');process.exitCode=2}
else if(safetyFailures){console.error('EXPECTED SAFETY RED; DO NOT MERGE OR DEPLOY');process.exitCode=1}
