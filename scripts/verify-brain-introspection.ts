import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isSameBrainIntrospection, formatBrainIntrospection, trySameBrainIntrospection } from '../lib/agent/brain-introspection'
import { supabaseAdmin } from '../lib/supabase-admin'

for(const text of ['How is Same Brain learning from my outcomes?','What have you learned from my corrections?','Which routes are shadow-only?','Show routing confidence','Same Brain v2','What can you route automatically?'])assert.equal(isSameBrainIntrospection(text),true,text)
for(const text of ['Send an email about Same Brain','Remind me to review the learning system','Book a Same Brain meeting','Search Gmail for Same Brain','What do I have on my calendar tomorrow?'])assert.equal(isSameBrainIntrospection(text),false,text)
const row=(outcome:string,verified=false)=>({event_type:'decision_learning',created_at:'2026-09-25T00:00:00Z',metadata_json:{schema:'same-brain-v2',decision_id:'one',domain:'email',handler:'gmail-context',outcome,verified,user_text:'PRIVATE_BODY',object_ref:'PRIVATE_PROVIDER_ID'}})
const report=formatBrainIntrospection([row('corrected'),row('verified_success',true),row('verified_success',true),{event_type:'shadow_brain_observation',metadata_json:{learned_routing:{useLearned:false,handler:null,reason:'PRIVATE_REASON'}}}])
assert.match(report,/Verified successes: 0/)
assert.match(report,/Corrections: 1; failures: 0/)
assert.match(report,/Shadow-only decisions observed: 1/)
assert.match(report,/insufficient evidence/)
assert.doesNotMatch(report,/PRIVATE_/)
assert.match(formatBrainIntrospection([]),/Insufficient learning evidence/)

async function main(){
  const original=supabaseAdmin.from, calls:any[]=[]
  let failed=false
  ;(supabaseAdmin as any).from=(table:string)=>{
    calls.push(['from',table]);const q:any={then:(resolve:any)=>Promise.resolve({data:failed?null:[row('verified_success',true)],error:failed?{message:'private error'}:null}).then(resolve)}
    for(const method of ['select','eq','in','gte','order','limit'])q[method]=(...args:any[])=>{calls.push([method,...args]);return q}
    return q
  }
  try{
    const p={actor:{legacyTelegramId:123},text:'How is Same Brain learning?'}
    const reply=await trySameBrainIntrospection(p)
    assert.equal(reply?.handledBy,'same-brain-introspection');assert.equal(reply?.mutated,false)
    assert.match(reply!.text,/Verified successes: 1/)
    assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='telegram_id'&&c[2]==='123'))
    failed=true
    assert.equal((await trySameBrainIntrospection(p))?.status,'unavailable')
    assert.doesNotMatch((await trySameBrainIntrospection(p))!.text,/private error/)
    calls.length=0
    assert.equal(await trySameBrainIntrospection({...p,text:'Send email about Same Brain'}),null)
    assert.equal(calls.length,0)
  }finally{supabaseAdmin.from=original}
  // Ensure both public ingress routes invoke the tested handler before semantic routing.
  for(const path of ['app/api/dashboard/chat/route.ts','app/api/webhooks/whatsapp/route.ts']){
    const source=readFileSync(path,'utf8')
    assert.ok(source.indexOf('await trySameBrainIntrospection(')<source.indexOf('await observeShadowBrainTurn('),path)
  }
  const agentSource=readFileSync('app/api/agent/run/route.ts','utf8')
  assert.ok(agentSource.indexOf('await trySameBrainIntrospection(')<agentSource.indexOf('await prepareGeneralPlanForActor('))
  console.log('Brain introspection: matching, read-only ingress, tenant scope, replay/correction evidence, privacy and unavailable-store fallback passed')
}
main().catch(e=>{console.error(e);process.exitCode=1})
