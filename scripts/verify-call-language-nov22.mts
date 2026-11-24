import assert from 'node:assert/strict'
import * as crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { resolveCallLanguage, sarvamCallProfile } from '../lib/agent/voice-call-language'

const owner = '-1234567'
const profile = '00000000-0000-4000-8000-000000000001'
const general = '00000000-0000-4000-8000-000000000002'
const env: Record<string,string> = {
  BOLNA_API_KEY:'fixture', SARVAM_API_KEY:'fixture', VERCEL_ENV:'production', GOGO_SARVAM_PRODUCTION:'approved',
  GOGO_SARVAM_CALLS:'on', GOGO_SARVAM_TTS:'on', GOGO_SARVAM_STT:'on', GOGO_SARVAM_USERS:owner,
  BOLNA_SARVAM_KN_TABLE_AGENT_ID:profile, BOLNA_SARVAM_HI_GENERAL_AGENT_ID:general,
}
for (const key of ['GOGO_SARVAM_PRODUCTION','GOGO_SARVAM_USERS','GOGO_SARVAM_STT','GOGO_SARVAM_TTS','GOGO_SARVAM_CALLS','SARVAM_API_KEY','BOLNA_SARVAM_KN_TABLE_AGENT_ID']) {
  assert.equal(sarvamCallProfile(owner,'Kannada','table',{...env,[key]:''}), null, key)
}
assert.equal(sarvamCallProfile(owner,'Kannada','table',{...env,BOLNA_GENERAL_AGENT_ID:profile}),null)
assert.equal(sarvamCallProfile(owner,'Kannada','table',{...env,BOLNA_SARVAM_HI_GENERAL_AGENT_ID:profile}),null)
assert.equal(sarvamCallProfile('-7654321','Kannada','table',env),null)
assert.equal(sarvamCallProfile(owner,'Hindi','general',env),general)
assert.equal(sarvamCallProfile(owner,'Hindi','table',env),null)

const iso='2026-11-22T12:00:00+05:30'
class FixedDate extends Date { constructor(...a:any[]){super(...(a.length?a:[iso]) as [])} static now(){return Date.parse(iso)} }
function load(file:string,mocks:Record<string,unknown>){
  const mod:any={}
  const src=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  runInNewContext(src,{exports:mod,require:(name:string)=>{
    if(!(name in mocks))throw Error('Unexpected import '+name)
    return mocks[name]
  },process:{env},Date:FixedDate,Intl,console,AbortSignal,fetch:()=>{throw Error('unexpected transport')}})
  return mod
}
const execution=load('lib/agent/voice-call-execution.ts',{'node:crypto':crypto,'@/lib/services/delivery-state':{}})
let stored:any=null, last='', claims=0
const savedNames:string[]=[]
const db={from:(table:string)=>{
  const q:any={insert:async(row:any)=>{if(table==='memories')savedNames.push(row.content);return {error:null}},select:()=>q,eq:()=>q,like:()=>q,order:()=>q,limit:async()=>({data:table==='conversations'?[{role:'assistant',content:last}]:[]})}
  return q
}}
// Real restaurant parser with inert dependencies; this fixture must never perform reservation research.
const rr=load('lib/agent/restaurant-reservation.ts',{
  'node:crypto':crypto,'@/lib/supabase-admin':{supabaseAdmin:db},'./india-locality':{},
  '@/lib/web-search':{},'@/lib/timezone':{},'./secure-computer':{},'./approval-binding':{},
  './context-brain':{},'@/lib/bot/pending-questions':{},'./reservation-dining-context':{},
  './provider-booking':{},'./reservation-guest-name':{},
})
let venueLookups=0
const v=load('lib/agent/voice-call.ts',{
  'node:crypto':crypto,'@/lib/supabase-admin':{supabaseAdmin:db},
  './policy':{capabilityPaused:()=>false},
  '@/lib/agent/restaurant-reservation':rr,
  '@/lib/web-search':{searchWebResults:async()=>{venueLookups++;throw Error('unexpected venue lookup')}},
  './voice-call-language':{resolveCallLanguage,sarvamCallProfile:(id:string,l:string,k:string)=>sarvamCallProfile(id,l,k,env)},
  './voice-call-execution':{...execution,beginApprovedVoiceCall:async()=>{claims++;return {status:'blocked'}}},
  '@/lib/bot/handlers/followup-state':{saveFollowupState:async(_id:any,_kind:any,value:any)=>{stored=value},getLatestFollowupState:async()=>({payload:stored})},
})
const actor={legacyTelegramId:-1234567,userId:'fixture',whatsappId:'919999999999',name:'Owner'}
const chat=(text:string)=>v.tryVoiceCall({actor,text,surface:'web'})
const card=await chat('test call me; speak in Kannada')
assert.match(card.text,/Call language: Kannada/)
assert.equal(claims,0)
assert.equal(stored.plan.voiceAgentId,profile)
assert.equal(stored.approvalHash,execution.voicePlanHash(owner,stored.plan))
assert.notEqual(stored.approvalHash,execution.voicePlanHash(owner,{...stored.plan,callLanguage:'Hindi'}))
assert.notEqual(stored.approvalHash,execution.voicePlanHash(owner,{...stored.plan,voiceAgentId:general}))
const {callLanguage,voiceAgentId,...english}=stored.plan
const legacyFields=['venue','to','source','guestName','partySize','date','dateLabel','timeLabel','flexWindow','seating','purpose','test','createdAt','startClock','kind','opening','details']
const old=crypto.createHash('sha256').update(JSON.stringify([owner,...legacyFields.map(k=>english[k]??null)])).digest('hex')
assert.equal(execution.voicePlanHash(owner,english),old)
assert.equal(v.parseCallCommand('yes call; speak in Kannada'),null)
last=card.text
const observed:any[]=[]
const transport=async(url:string,init:any)=>{observed.push([url,JSON.parse(init.body)]);return new Response('{"execution_id":"fixture-execution"}')}
await assert.rejects(v.placeCall(stored.plan,'',transport,'-999'))
assert.equal(observed.length,0)
assert.equal(await v.placeCall(stored.plan,'+919999999999',transport,owner),'fixture-execution')
assert.equal(observed.length,1)
assert.equal(observed[0][0],'https://api.bolna.ai/call')
assert.equal(observed[0][1].agent_id,profile)
assert.equal(observed[0][1].user_data.contact_number,'')
env.BOLNA_SARVAM_KN_TABLE_AGENT_ID='00000000-0000-4000-8000-000000000009'
assert.match((await chat('yes call')).text,/profile.*changed/i)
assert.equal(claims,0)
assert.match((await chat('test call me; speak in Spanish')).text,/unavailable/i)
assert.equal(sarvamCallProfile(owner,'constructor','table',env),null)
for (const [language,code,lastDigit] of [['Tamil','TA','3'],['Telugu','TE','5']] as const) {
  const tableKey = `BOLNA_SARVAM_${code}_TABLE_AGENT_ID`
  const generalKey = `BOLNA_SARVAM_${code}_GENERAL_AGENT_ID`
  const tableAgent = '00000000-0000-4000-8000-00000000000' + lastDigit
  const generalAgent = '00000000-0000-4000-8000-00000000000' + (Number(lastDigit)+1)
  assert.match((await chat('test call me; speak in '+language)).text,/unavailable/i)
  env[tableKey] = tableAgent
  env[generalKey] = generalAgent
  last = (await chat('test call me; speak in '+language)).text
  assert.match(last,new RegExp('Call language: '+language))
  assert.equal(stored.plan.voiceAgentId,tableAgent)
  assert.equal(stored.approvalHash,execution.voicePlanHash(owner,stored.plan))
  assert.equal(await v.placeCall(stored.plan,'+919999999999',transport,owner),'fixture-execution')
  assert.equal(observed.at(-1)[1].agent_id,tableAgent)
  delete env[tableKey]
  assert.match((await chat('yes call')).text,/profile.*changed/i)
  assert.equal(claims,0)
  const generalCard = await chat('call Example Hotel on 080 2345 6789 and ask whether a room is available; speak in '+language)
  assert.match(generalCard.text,new RegExp('Call language: '+language))
  assert.equal(stored.plan.voiceAgentId,generalAgent)
  assert.equal(await v.placeCall(stored.plan,'+919999999999',transport,owner),'fixture-execution')
  assert.equal(observed.at(-1)[1].agent_id,generalAgent)
  assert.equal(Object.hasOwn(observed.at(-1)[1].user_data,'contact_number'),false)
  env[tableKey] = generalAgent
  assert.equal(sarvamCallProfile(owner,language,'general',env),null,'an agent cannot be reused across call types')
  delete env[tableKey]
  delete env[generalKey]
}
const prompt='Please confirm the Indian business telephone number.'
const state={type:'followup_state',kind:v.CALL_NUMBER_STATE,created_at:iso,payload:{owner,prompt,original:'call Example Salon and ask if they open Sunday under the name Nithin; speak in Hindi'}}
const resumed=v.generalCallFromNumberReply(state,'080 2345 6789',prompt,owner)
assert.equal(resumed,'call Example Salon on +918023456789 and ask if they open Sunday under the name Nithin; speak in Hindi')
for (const [venue,ask] of [
  ['Example Salon','book a haircut tomorrow at 6pm'],
  ['Example Hotel','ask whether a room is available on Sunday'],
  ['Example Clinic','ask if they are open on Sunday'],
]) {
  const reply=await chat('call '+venue+' on 080 2345 6789 and '+ask+'; speak in Hindi')
  assert.match(reply.text,/Call language: Hindi/)
  assert.equal(stored.plan.kind,'general')
  assert.equal(stored.plan.voiceAgentId,general)
  assert.doesNotMatch(stored.plan.purpose,/speak in Hindi/i)
  const before=observed.length
  assert.equal(await v.placeCall(stored.plan,'+919999999999',transport,owner),'fixture-execution')
  assert.equal(observed.length,before+1)
  const payload=observed[before][1]
  assert.equal(payload.agent_id,general)
  assert.equal(payload.recipient_phone_number,'+918023456789')
  assert.equal(Object.hasOwn(payload.user_data,'contact_number'),false)
}
for (const sep of ['. ','\n',', ','; ']) {
  await chat('call Example Salon on 080 2345 6789 and book a haircut under the name Nithin'+sep+'speak in Hindi')
  assert.equal(stored.plan.guestName,'Nithin')
  assert.equal(savedNames.at(-1),'BOOKING_NAME:Nithin')
}
const enquiry=await chat('call Example School on 080 2345 6789 and ask whether the class is in Hindi')
assert.doesNotMatch(enquiry.text,/Call language:/)
assert.equal(stored.plan.callLanguage,undefined)
// Invalid explicit dates must never be converted to a same-day table-call plan.
const beforeInvalid=stored, namesBeforeInvalid=savedNames.length, claimsBeforeInvalid=claims
for(const date of ['2026-11-31','2027-02-29','31 November 2026']){
  for(const phone of ['',' on 080 2345 6789']){
    const result=await chat('call Toit'+phone+' and book a table for 2 on '+date+' at 7pm under the name Fixture Guest')
    assert.match(result.text,/not a valid calendar date/,date)
    assert.equal(result.handledBy,'voice-call')
    assert.equal(stored,beforeInvalid,'no new plan saved')
  }
}
assert.equal(venueLookups,0,'invalid dates stop before phone lookup')
assert.equal(savedNames.length,namesBeforeInvalid,'no remembered booking name from rejected request')
assert.equal(claims,claimsBeforeInvalid,'no approval claimed')
for(const [date,expected] of [[' on 2028-02-29','2028-02-29'],['','2026-11-22']]){
  const valid=await chat('call Toit on 080 2345 6789 and book a table for 2'+date+' at 7pm')
  assert.equal(valid.handledBy,'voice-call-plan')
  assert.equal(stored.plan.date,expected)
  assert.equal(stored.approvalHash,execution.voicePlanHash(owner,stored.plan))
}
assert.equal(claims,claimsBeforeInvalid,'valid plans still require a separate yes')
assert.equal(venueLookups,0)
console.log('PASS: localized test plan, legacy approval identity, exact profile and owner, fixture transport, number follow-up and revocation.')
