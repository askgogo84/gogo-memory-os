import assert from 'node:assert/strict'
import fs from 'node:fs'
import { scoreBoardingPassCandidate, buildBoardingPassSearchTexts, eligibleBoardingPassMessages, assertBoardingPassSchedule, completeAction, publishBoardingPass } from '../lib/agent/life-event-email-worker'

const worker=fs.readFileSync('lib/agent/life-event-email-worker.ts','utf8')
const route=fs.readFileSync('app/api/cron/life-events/route.ts','utf8')
const genericWorker=fs.readFileSync('lib/agent/life-event-worker.ts','utf8')

const searches=buildBoardingPassSearchTexts({provider:'IndiGo',confirmation_ref:'ABC123',metadata_json:{flightNo:'6E614'}},{payload_json:{}})
assert.ok(searches.length>=3,'must search multiple boarding/check-in alternatives')
assert.ok(searches.some(x=>/boarding pass/i.test(x)))
assert.ok(searches.some(x=>/check-in confirmation/i.test(x)))
assert.ok(searches.every(x=>/ABC123|6E614|IndiGo/i.test(x)),'each search must retain trip identity')

const exact=scoreBoardingPassCandidate({subject:'Your IndiGo boarding pass for 6E 614',snippet:'PNR ABC123',provider:'IndiGo',confirmationRef:'ABC123',flightNo:'6E614'})
assert.equal(exact.accepted,true,'strong trip-bound boarding-pass evidence should match')
const promo=scoreBoardingPassCandidate({subject:'Boarding pass sale offer',snippet:'Save 20%',provider:'IndiGo',confirmationRef:'ABC123',flightNo:'6E614'})
assert.equal(promo.accepted,false,'promo copy without trip identity in the message must not match')
const providerOnly=scoreBoardingPassCandidate({subject:'Your IndiGo boarding pass is ready',snippet:'Download your boarding pass',provider:'IndiGo'})
assert.equal(providerOnly.accepted,false,'airline/provider name alone must never close a flight watch without PNR or flight number')
assert.equal(providerOnly.tripIdentitySignals,0,'provider must not count as trip-specific identity')

assert.match(worker,/\.eq\('action_type',\s*'email_watch'\)/,'email worker must own only email_watch actions')
assert.match(worker,/tripIdentitySignals\s*>?=\s*1/,'candidate acceptance must require trip-specific identity')
assert.match(worker,/duplicateSuppressed/,'duplicate boarding-pass evidence must be suppressed')
assert.match(worker,/gmailMessageId/,'Gmail provenance must be persisted')
const exclusions=genericWorker.match(/\.neq\('action_type',\s*'email_watch'\)/g)||[]
assert.ok(exclusions.length>=2,'generic life-event worker must exclude email_watch from both due and stale queries')
const emailPos=route.indexOf('processDueLifeEventEmailWatches()')
const genericPos=route.indexOf('processDueLifeEventActions()')
assert.ok(emailPos>=0&&genericPos>emailPos,'email watches must run before the generic life-event worker in the same cron invocation')

console.log('✅ Gmail boarding-pass lifecycle regression passed')

const rescheduledWatch={payload_json:{excludedGmailMessageIds:['old-pass',null,'older-pass']}}
assert.deepEqual(eligibleBoardingPassMessages([{id:'old-pass'},{id:'new-pass'}],rescheduledWatch).map(row=>row.id),['new-pass'])
assert.deepEqual(eligibleBoardingPassMessages([{id:'old-pass'},{id:'older-pass'}],rescheduledWatch),[],'only old boarding passes must leave the watch searching')
console.log('Rescheduled boarding-pass watches exclude previous matches before scoring or attachment reads')

assert.doesNotThrow(()=>assertBoardingPassSchedule({payload_json:{}},{metadata_json:{}}))
assert.doesNotThrow(()=>assertBoardingPassSchedule({payload_json:{scheduleRevision:'current'}},{metadata_json:{ticketScheduleRevision:'current'}}))
assert.throws(()=>assertBoardingPassSchedule({payload_json:{}},{metadata_json:{ticketScheduleRevision:'corrected'}}),/life_event_schedule_changed/)
assert.throws(()=>assertBoardingPassSchedule({payload_json:{scheduleRevision:'old'}},{metadata_json:{ticketScheduleRevision:'corrected'}}),/life_event_schedule_changed/)

const {supabaseAdmin}=await import('../lib/supabase-admin')
const savedFrom=supabaseAdmin.from
try{
 let result:any=null
 const filters:any[]=[]
 ;(supabaseAdmin as any).from=()=>{
  const q:any={update:()=>q,eq:(...args:any[])=>{filters.push(args);return q},is:(...args:any[])=>{filters.push(args);return q},select:()=>q,maybeSingle:async()=>({data:result,error:null})}
  return q
 }
 await assert.rejects(()=>completeAction({id:'watch',payload_json:{scheduleRevision:'old'}}),/life_event_schedule_changed/)
 assert.ok(filters.some(([key,value])=>key==='payload_json->>scheduleRevision'&&value==='old'))
 result={id:'watch',payload_json:{scheduleRevision:'old'}}
 await completeAction({id:'watch',payload_json:{scheduleRevision:'old'}})
 result={id:'watch',payload_json:{scheduleRevision:'new'}}
 await assert.rejects(()=>completeAction({id:'watch',payload_json:{scheduleRevision:'old'}}),/life_event_schedule_changed/)
}finally{(supabaseAdmin as any).from=savedFrom}

const savedRpc=supabaseAdmin.rpc
try{
 ;(supabaseAdmin as any).rpc=async(name:string,args:any)=>{
  assert.equal(name,'gogo_publish_boarding_pass')
  assert.equal(args.p_revision,'claimed')
  return {data:'recorded-run',error:null}
 }
 assert.equal(await publishBoardingPass({id:'watch',payload_json:{scheduleRevision:'claimed'}},{id:'event'},'17',{gmailMessageId:'pass'}),'recorded-run')
 ;(supabaseAdmin as any).rpc=async()=>({data:null,error:{message:'life_event_schedule_changed'}})
 await assert.rejects(()=>publishBoardingPass({id:'watch'},{id:'event'},'17',{}),/life_event_schedule_changed/)
}finally{(supabaseAdmin as any).rpc=savedRpc}
