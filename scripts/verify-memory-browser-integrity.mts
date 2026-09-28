import assert from 'node:assert/strict'
import { flightInstants, ticketInstant } from '../lib/services/travel-time'
import { isLoginDestination, verifiedBrowserAnswer } from '../lib/agent/browser-evidence'
import { buildTravelPresenceFacts, lexicalScore, renderContextBlock } from '../lib/agent/context-brain'
import { parseFlightTicketText } from '../lib/services/pdf-reader'

const first=flightInstants({from:'BLR',to:'AUH',date:'27 Sep 2026',departure:'22:15',arrival:'00:35',arrivalDate:'28 Sep 2026'})
assert.equal(first.departAt?.toISOString(),'2026-09-27T16:45:00.000Z')
assert.equal(first.arriveAt?.toISOString(),'2026-09-27T20:35:00.000Z')
const second=flightInstants({from:'Abu Dhabi',to:'New York',date:'28 Sep 2026',departure:'02:35',arrival:'08:35',arrivalDate:'28 Sep 2026'})
assert.equal(second.departAt?.toISOString(),'2026-09-27T22:35:00.000Z')
assert.equal(second.arriveAt?.toISOString(),'2026-09-28T12:35:00.000Z')
assert.equal(ticketInstant('28 Dec 2026','08:35','America/New_York')?.toISOString(),'2026-12-28T13:35:00.000Z')
assert.equal(ticketInstant('31 Feb 2026','08:35','Asia/Kolkata'),null)
assert.equal(ticketInstant('8 Mar 2026','02:30','America/New_York'),null)
assert.equal(flightInstants({from:'unknown airport',to:'JFK',date:'28 Sep 2026',departure:'02:35'}).departAt,null)
assert.equal(flightInstants({from:'BLR',to:'AUH',date:'27 Sep 2026',departure:'22:15',arrival:'00:35'}).arriveAt,null)
const parsed=parseFlightTicketText('PNR: TEST99 EY239 BLR 22:15 27 Sep 2026 AUH 00:35 28 Sep 2026')
assert.equal(parsed?.flights[0]?.arrivalDate,'28 Sep 2026')

const rows=[{id:'leg',type:'flight',from_city:'Abu Dhabi',to_city:'New York',depart_at:second.departAt!.toISOString(),arrive_at:second.arriveAt!.toISOString(),passengers:['Divyashree Urs'],flight_no:'EY1',booking_group:'trip'}]
const facts=buildTravelPresenceFacts(rows,Date.parse('2026-09-28T06:00Z'))
const ticket=facts.find(f=>f.source==='travel_ticket')!
assert.match(ticket.summary,/Divyashree Urs/)
assert.match(ticket.summary,/08:35.*America\/New_York/)
assert.ok(lexicalScore('What time Divya is landing in newyork',ticket.summary)>0.3)
assert.doesNotMatch(facts.find(f=>f.source==='travel_presence')!.summary,/places the user/)
const invalid=buildTravelPresenceFacts([{...rows[0],arrive_at:'2026-09-26T00:00Z'}],Date.parse('2026-09-28T06:00Z'))
assert.equal(invalid.filter(f=>f.source==='travel_presence').length,0)
assert.equal(invalid[0].endAt,null)
const block=renderContextBlock({query:'Divya landing',generatedAt:new Date().toISOString(),memoryEnabled:true,retrievalIncomplete:true,facts:[ticket],provenance:{lifeEvents:0,travelTickets:1,openLoops:0,semanticMemories:0,insights:0,typedContext:0}})
assert.match(block,/Divyashree Urs/)
assert.match(block,/Retrieval is incomplete/)

assert.equal(isLoginDestination({url:'https://www.instagram.com/accounts/login/',title:'Instagram',text:''}),true)
assert.equal(isLoginDestination({url:'https://shop.example/products',text:'Sign in. Read about your new device. Check your phone for your ticket.'}),false)
assert.equal(verifiedBrowserAnswer({complete:true,answer:'Done',evidence:['Instagram']},'Instagram'),null)
assert.equal(verifiedBrowserAnswer({complete:true,answer:'Three saved posts',evidence:['Saved post 1: a holiday']},'Instagram Sign in to see photos and videos from your friends.'),null)
assert.equal(verifiedBrowserAnswer({complete:false,answer:'No result',evidence:[]},'Amul Taaza milk is available for delivery in your area.'),null)
const observed='Amul Taaza toned milk 1 litre. Available at ₹60 in Indiranagar. Delivery fee ₹25.'
assert.equal(verifiedBrowserAnswer({complete:true,answer:'Amul Taaza 1 litre: ₹60; delivery ₹25.',evidence:['Amul Taaza toned milk 1 litre.','Available at ₹60 in Indiranagar.','Delivery fee ₹25.']},observed),'Amul Taaza 1 litre: ₹60; delivery ₹25.')
console.log('Memory/browser integrity: international dates, passenger recall, invalid-arrival rejection, login shell, and observed evidence passed')

const {recallQuery}=await import('../lib/agent/recall-query')
assert.match(recallQuery('When is she landing?',[{role:'user',content:'Divya flies to New York'},{role:'assistant',content:'Invented Rome booking'}]),/Divya flies to New York/)
assert.doesNotMatch(recallQuery('When is she landing?',[{role:'user',content:'Divya flies to New York'},{role:'assistant',content:'Invented Rome booking'}]),/Rome/)
assert.equal(recallQuery('Check milk prices on Blinkit',[{role:'user',content:'Divya flies to New York'}]),'Check milk prices on Blinkit')

// Exercise retrieval with the embedding service down and prove owner/consent isolation.
const {readFileSync}=await import('node:fs')
const {runInNewContext}=await import('node:vm')
const ts=await import('typescript')
const crypto=await import('node:crypto')
const redaction=await import('../lib/bot/memory-redaction')
const memoryIndex=await import('../lib/services/memory-index')
const travelTime=await import('../lib/services/travel-time')
let consentEnabled=true
const queries:Array<{table:string;filters:Array<[string,unknown]>}>=[]
const stores:Record<string,any[]>={
  memories:[{id:'old-fact',telegram_id:17,content:'Divyashree arrives in New York on 28 September',created_at:'2020-01-01'},
    {id:'secret',telegram_id:17,content:'Divya password: never surface this'},
    {id:'internal',telegram_id:17,content:'askgogo_usage: Divya'},
    {id:'other-owner',telegram_id:18,content:'Divya lives elsewhere'}],
  memory_embeddings:[],
}
const database={from:(table:string)=>{
  const filters:Array<[string,unknown]>=[]
  queries.push({table,filters})
  const result=()=>({data:table==='user_consent_settings'?{memory_enabled:consentEnabled}:table==='user_memory_profile'?null:(stores[table]||[]).filter(row=>filters.every(([key,value])=>String(row[key])===String(value))),error:null})
  const q:any={select:()=>q,eq:(key:string,value:unknown)=>{filters.push([key,value]);return q},is:()=>q,or:()=>q,in:()=>q,gte:()=>q,lte:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>result(),then:(resolve:any)=>Promise.resolve(result()).then(resolve)}
  return q
}}
const exports:any={}
const mocks:any={'node:crypto':crypto,'@/lib/supabase-admin':{supabaseAdmin:database},'@/lib/services/embeddings':{embedText:async()=>{throw new Error('fixture embedding outage')}},'@/lib/bot/memory-redaction':redaction,'@/lib/services/memory-index':memoryIndex,'@/lib/services/travel-time':travelTime,'./typed-object-context':{latestTypedContext:async()=>null}}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/context-brain.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>mocks[name],console,Date,Intl})
const actor={legacyTelegramId:17,userId:'fixture-owner'}
const recalled=await exports.buildContextPack({actor,text:'When does Divya arrive in New York?'})
assert.ok(recalled.facts.some((fact:any)=>fact.id==='semantic:old-fact'))
assert.equal(recalled.retrievalIncomplete,true)
assert.ok(recalled.facts.every((fact:any)=>!['semantic:secret','semantic:internal','semantic:other-owner'].includes(fact.id)))
assert.ok(queries.every(query=>query.filters.some(([key,value])=>key==='telegram_id'&&String(value)==='17')))
consentEnabled=false
queries.length=0
const disabled=await exports.buildContextPack({actor,text:'When does Divya arrive in New York?'})
assert.equal(disabled.memoryEnabled,false)
assert.ok(!queries.some(query=>['memories','memory_embeddings'].includes(query.table)))
console.log('Embedding-outage fallback, owner isolation, secret filtering and memory consent passed')

for(const from of ['MAA','HYD','CCU','COK','GOI','GOX','Chennai','Kochi']){
 const leg=flightInstants({from,to:'BLR',date:'28 Sep 2026',departure:'10:00',arrival:'11:15'})
 assert.equal(leg.departAt?.toISOString(),'2026-09-28T04:30:00.000Z',from)
 assert.equal(leg.arriveAt?.toISOString(),'2026-09-28T05:45:00.000Z',from)
}
assert.equal(flightInstants({from:'MAA',to:'BLR',date:'28 Sep 2026',departure:'23:15',arrival:'00:15'}).arriveAt,null)
assert.equal(verifiedBrowserAnswer({complete:true,answer:'Acme',evidence:['Acme']},'', 'Acme',true),'Acme')
assert.equal(verifiedBrowserAnswer({complete:true,answer:'Three posts',evidence:['Instagram']},'', 'Instagram'),null)
assert.equal(memoryIndex.recallableMemoryText('Divya passport S1234567 expires 12/09/2030','documents'),'Divya passport [redacted] expires [redacted]')
assert.equal(memoryIndex.recallableMemoryText('Divya passport S1234567','memories'),null)
console.log('Title-only observations, supported Indian airports, same-day arrivals and safe document recall passed')

// A read step must not require a newly created reminder or invoke a mutation path.
const {executeVerifiedMissionReminder}=await import('../lib/agent/mission-tools')
const {supabaseAdmin}=await import('../lib/supabase-admin')
const originalFrom=supabaseAdmin.from
let reminderQueries=0,reminderReadFails=false
;(supabaseAdmin as any).from=(table:string)=>{
 assert.equal(table,'reminders');reminderQueries++
 const q:any={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(value,17);if(key==='sent')assert.equal(value,false);return q},gte:()=>q,order:()=>q,limit:async()=>({data:[],error:reminderReadFails?{message:'fixture outage'}:null})}
 return q
}
try{
 const result=await executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Review active reminders for this trip',instruction:'Review active reminders for this trip on 28 Sep 2026 at 2:35 am'},missionText:'Review the saved trip'})
 assert.ok('readOnly' in result.output&&result.output.readOnly===true)
 assert.equal(reminderQueries,1)
 assert.match(result.text,/No upcoming unsent reminders/)
 reminderReadFails=true
 await assert.rejects(()=>executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Review reminders',instruction:'Review active reminders'},missionText:'Review the trip'}),/mission_reminder_read_failed/)
}finally{(supabaseAdmin as any).from=originalFrom}
console.log('Reminder review remains read-only even when the request includes a date and time')

const {buildLegs}=await import('../lib/services/travel-tickets')
for(const from of ['NDLS','SBC','New Delhi']){
 const leg=buildLegs({type:'train',from,to:'Bengaluru',date:'28 Sep 2026',departure:'10:00',arrival:'12:00',trainNo:'12345',trainName:'Fixture',pnr:'fixture',passengers:['Fixture']})[0]
 assert.equal(leg.departAt?.toISOString(),'2026-09-28T04:30:00.000Z',from)
}
console.log('Indian rail station codes retain IST departure parsing')
