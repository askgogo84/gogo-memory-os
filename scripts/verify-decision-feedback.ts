import assert from 'node:assert/strict'
import { correctionTarget, isExplicitRoutingCorrection, captureExplicitRoutingCorrection } from '../lib/agent/decision-feedback'
import { recordShadowRouterOutcome } from '../lib/agent/shadow-router-outcome'
import { supabaseAdmin } from '../lib/supabase-admin'

const now=Date.now()
const prior={created_at:new Date(now-1000).toISOString(),metadata_json:{schema:'same-brain-v2',decision_id:'event-1',handler:'reminder-create',domain:'calendar',user_text:'When is the meeting?',outcome:'success'}}
const feedback={text:'No, I meant the calendar event',previous:prior,previousUserText:'When is the meeting?',now}
assert.equal(correctionTarget(feedback)?.handler,'reminder-create')
assert.equal(correctionTarget({...feedback,previousUserText:'Unrelated new topic'}),null)
assert.equal(correctionTarget({...feedback,now:now+3600000}),null)
assert.equal(correctionTarget({...feedback,previous:{...prior,created_at:'invalid'}}),null)
for(const text of ['No thanks','Cancel it','Yes','Did Gmail actually send it?'])assert.equal(isExplicitRoutingCorrection(text),false)
assert.equal(correctionTarget({...feedback,previous:{...prior,metadata_json:{...prior.metadata_json,decision_id:null}}}),null)

async function main(){
 const original=supabaseAdmin.from
 const inserts:any[]=[]
 const filters:any[]=[]
 let observation:any={user_text:'When is the meeting?',capability:'calendar',learned_routing:{useLearned:false}}
 ;(supabaseAdmin as any).from=(table:string)=>{
  const predicates:any[]=[]
  const chain:any={insert:async(row:any)=>{inserts.push(row);return {error:null}}}
  for(const method of ['select','eq','order','limit'])chain[method]=(...args:any[])=>{predicates.push([method,...args]);filters.push([table,method,...args]);return chain}
  chain.maybeSingle=async()=>({error:null,data:table==='conversations'?{content:'When is the meeting?'}:
   predicates.some(p=>p[1]==='event_type'&&p[2]==='decision_learning')?prior:{metadata_json:observation}})
  return chain
 }
 try {
  const target=await captureExplicitRoutingCorrection({legacyTelegramId:123} as any,feedback.text)
  assert.equal(target?.decisionId,'event-1')
  assert.equal(inserts.length,0,'answer-quality feedback alone must not suppress the route')
  observation={...observation,correction_target:target}
  await recordShadowRouterOutcome({telegramId:123,surface:'system',eventId:'correction-turn',actualHandler:'calendar-named-read',actualCapability:'calendar',status:'completed'})
  assert.equal(inserts.at(-2).metadata_json.outcome,'corrected')
  assert.equal(inserts.at(-2).metadata_json.first_route_correct,false)
  assert.equal(inserts.at(-1).metadata_json.outcome,'replacement')
  assert.equal(inserts.at(-1).metadata_json.user_text,'When is the meeting?')
  assert.equal(inserts.at(-1).metadata_json.decision_id,'event-1')
  const correctionCount=inserts.filter(r=>r.metadata_json.outcome==='corrected').length
  await recordShadowRouterOutcome({telegramId:123,surface:'system',eventId:'content-correction',actualHandler:'reminder-create',actualCapability:'calendar',status:'completed'})
  assert.equal(inserts.filter(r=>r.metadata_json.outcome==='corrected').length,correctionCount,'same-handler content correction must not become negative routing evidence')
  observation={user_text:'Test read',capability:'memory'}
  for(const [domain,handler] of [['email','gmail-context'],['calendar','calendar-named-read'],['reminders','reminder-query'],['browser','watcher-status'],['travel','travel-research'],['browser','secure-browser'],['tasks','persistent-general-plan']]){
   await recordShadowRouterOutcome({telegramId:123,surface:'system',eventId:handler,actualHandler:handler,actualCapability:domain,status:'outcome_unknown'})
   assert.equal(inserts.at(-1).metadata_json.outcome,'unknown',handler)
   assert.equal(inserts.at(-1).metadata_json.verified,false,handler)
  }
  await recordShadowRouterOutcome({telegramId:123,surface:'system',eventId:'clarify',actualHandler:'jev-clarification-guard',status:'paused'})
  assert.equal(inserts.at(-1).metadata_json.outcome,'clarified')
  assert.ok(filters.some(f=>f[1]==='eq'&&f[2]==='telegram_id'&&f[3]==='123'))
  assert.ok(filters.some(f=>f[1]==='eq'&&f[2]==='metadata_json->>event_id'&&f[3]==='correction-turn'))
 } finally {supabaseAdmin.from=original}
 console.log('Decision feedback: exact previous-turn binding, stale/ambiguous rejection, negative/replacement learning and seven-domain capture passed')
}
main().catch(error=>{console.error(error);process.exitCode=1})
