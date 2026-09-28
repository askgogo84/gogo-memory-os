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

const rows=[{id:'leg',type:'flight',from_city:'Abu Dhabi',to_city:'New York',depart_at:second.departAt!.toISOString(),arrive_at:second.arriveAt!.toISOString(),passengers:['Divyashree Example'],flight_no:'EY1',booking_group:'trip'}]
const facts=buildTravelPresenceFacts(rows,Date.parse('2026-09-28T06:00Z'))
const ticket=facts.find(f=>f.source==='travel_ticket')!
assert.match(ticket.summary,/Divyashree Example/)
assert.match(ticket.summary,/08:35.*America\/New_York/)
assert.ok(lexicalScore('What time Divya is landing in newyork',ticket.summary)>0.3)
assert.doesNotMatch(facts.find(f=>f.source==='travel_presence')!.summary,/places the user/)
const invalid=buildTravelPresenceFacts([{...rows[0],arrive_at:'2026-09-26T00:00Z'}],Date.parse('2026-09-28T06:00Z'))
assert.equal(invalid.filter(f=>f.source==='travel_presence').length,0)
assert.equal(invalid[0].endAt,null)
const block=renderContextBlock({query:'Divya landing',generatedAt:new Date().toISOString(),memoryEnabled:true,retrievalIncomplete:true,facts:[ticket],provenance:{lifeEvents:0,travelTickets:1,openLoops:0,semanticMemories:0,insights:0,typedContext:0}})
assert.match(block,/Divyashree Example/)
assert.match(block,/Retrieval is incomplete/)

assert.equal(isLoginDestination({url:'https://www.instagram.com/accounts/login/',title:'Instagram',text:''}),true)
assert.equal(isLoginDestination({url:'https://shop.example/products',text:'Sign in. Read about your new device. Check your phone for your ticket.'}),false)
assert.equal(verifiedBrowserAnswer({complete:true,answer:'Done',evidence:['Instagram']},'Instagram','Instagram'),null)
assert.equal(verifiedBrowserAnswer({complete:true,answer:'Three saved posts',evidence:['Saved post 1: a holiday']},'Instagram Sign in to see photos and videos from your friends.'),null)
assert.equal(verifiedBrowserAnswer({complete:false,answer:'No result',evidence:[]},'Amul Taaza milk is available for delivery in your area.'),null)
const observed='Amul Taaza toned milk 1 litre. Available at ₹60 in Indiranagar. Delivery fee ₹25.'
assert.equal(verifiedBrowserAnswer({complete:true,answer:'Amul Taaza 1 litre: ₹60; delivery ₹25.',evidence:['Amul Taaza toned milk 1 litre.','Available at ₹60 in Indiranagar.','Delivery fee ₹25.']},observed),'Amul Taaza toned milk 1 litre.\nAvailable at ₹60 in Indiranagar.\nDelivery fee ₹25.')
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
let consentEnabled=true,profileLookupFails=false,insightLookupFails=false,embeddingFails=true
const queries:Array<{table:string;filters:Array<[string,unknown]>}>=[]
const stores:Record<string,any[]>={
  memories:[{id:'old-fact',telegram_id:17,content:'Divyashree arrives in New York on 28 September',created_at:'2020-01-01'},
    {id:'secret',telegram_id:17,content:'Divya password: never surface this'},
    {id:'internal',telegram_id:17,content:'askgogo_usage: Divya'},
    {id:'other-owner',telegram_id:18,content:'Divya lives elsewhere'}],
  memory_embeddings:[],
}
const database={rpc:async()=>({data:[],error:null}),from:(table:string)=>{
  const filters:Array<[string,unknown]>=[]
  queries.push({table,filters})
  const result=()=>({data:table==='user_consent_settings'?{memory_enabled:consentEnabled}:table==='user_memory_profile'?null:(stores[table]||[]).filter(row=>filters.every(([key,value])=>String(row[key])===String(value))),error:(table==='user_memory_profile'&&profileLookupFails||table==='user_insights'&&insightLookupFails)?{message:'fixture lookup outage'}:null})
  const q:any={select:()=>q,eq:(key:string,value:unknown)=>{filters.push([key,value]);return q},is:()=>q,or:()=>q,in:()=>q,gte:()=>q,lte:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>result(),then:(resolve:any)=>Promise.resolve(result()).then(resolve)}
  return q
}}
const exports:any={}
const mocks:any={'node:crypto':crypto,'@/lib/supabase-admin':{supabaseAdmin:database},'@/lib/services/embeddings':{embedText:async()=>{if(embeddingFails)throw new Error('fixture embedding outage');return []}},'@/lib/bot/memory-redaction':redaction,'@/lib/services/memory-index':memoryIndex,'@/lib/services/travel-time':travelTime,'./typed-object-context':{latestTypedContext:async()=>null}}
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

for(const from of ['MAA','HYD','CCU','COK','GOI','GOX','Chennai']){
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
const {executeVerifiedMissionReminder,reminderStepIntent}=await import('../lib/agent/mission-tools')
const {supabaseAdmin}=await import('../lib/supabase-admin')
const originalFrom=supabaseAdmin.from
let reminderQueries=0,reminderReadFails=false
;(supabaseAdmin as any).from=(table:string)=>{
 assert.equal(table,'reminders');reminderQueries++
 const q:any={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(value,17);if(key==='sent')assert.equal(value,false);return q},gte:()=>q,order:()=>q,range:async()=>({data:[],error:reminderReadFails?{message:'fixture outage'}:null})}
 return q
}
try{
 const result=await executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Review active reminders for this trip',instruction:'Review active reminders for this trip on 28 Sep 2026 at 2:35 am'},missionText:'Review the saved trip'})
 assert.ok('readOnly' in result.output&&result.output.readOnly===true)
 assert.equal(reminderQueries,1)
 assert.match(result.text,/No upcoming unsent reminders/)
 const prefixed=await executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Review reminders',instruction:'For 28 Sep 2026 at 2:35 am, inspect the saved entries'},missionText:'Review the trip'})
 assert.ok('readOnly' in prefixed.output&&prefixed.output.readOnly===true)
 const beforeMixed=reminderQueries
 await assert.rejects(()=>executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Review and create reminders',instruction:'Check my reminders and create a reminder for 28 Sep 2026 at 5 pm'},missionText:'Review and create a reminder'}),/mixed_read_write_requires_separate_steps/)
 assert.equal(reminderQueries,beforeMixed,'mixed operations must not be falsely completed or partially mutated')
 const prohibited=await executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Review only',instruction:'Review active reminders. Do not create, edit or delete anything.'},missionText:'Review only'})
 assert.ok('readOnly' in prohibited.output&&prohibited.output.readOnly===true)
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

const chicago=buildTravelPresenceFacts([{...rows[0],to_city:'Chicago',raw:{arrivalTimezone:'America/Chicago'}}],Date.parse('2026-09-28T06:00Z')).find(f=>f.source==='travel_ticket')!
assert.match(chicago.summary,/07:35.*America\/Chicago/)
console.log('Explicit arrival timezone survives recall for cities outside the built-in map')

const {parseFlightTicketTextSafe}=await import('../lib/services/pdf-reader-whatsapp')
const whatsappTicket=parseFlightTicketTextSafe('PNR: TEST99 EY239 BLR 22:15 27 Sep 2026 AUH 00:35 28 Sep 2026')!
assert.equal(whatsappTicket.flights[0].arrivalDate,'28 Sep 2026')
assert.equal(buildLegs(whatsappTicket)[0].arriveAt?.toISOString(),'2026-09-27T20:35:00.000Z')
for(const [code,zone] of Object.entries({SFO:'America/Los_Angeles',LAX:'America/Los_Angeles',ORD:'America/Chicago',CDG:'Europe/Paris',DOH:'Asia/Qatar'})){
 assert.equal(travelTime.ticketTimezone(code),zone)
 assert.ok(flightInstants({from:code,to:'BLR',date:'28 Sep 2026',departure:'10:00'}).departAt,code)
}
const contradicted=verifiedBrowserAnswer({complete:true,answer:'Unavailable at ₹600',evidence:['Available at ₹60 in Indiranagar.']},observed)
assert.equal(contradicted,'Available at ₹60 in Indiranagar.')
assert.doesNotMatch(contradicted!,/600|Unavailable/)
console.log('WhatsApp PDF ingestion, worldwide IATA codes and extractive browser answers passed')

assert.equal(travelTime.ticketTimezone('Kochi'),null,'ambiguous India/Japan city names need an airport code or explicit zone')
assert.equal(travelTime.ticketTimezone('Kochi','Asia/Kolkata'),'Asia/Kolkata')

assert.equal(reminderStepIntent({title:'Reminders',instruction:'For 28 Sep 2026 at 2:35 am, inspect the saved entries'}),'read')
assert.equal(reminderStepIntent({title:'Create check-in reminder',instruction:'Create a reminder to review travel documents on 28 Sep 2026 at 5 pm'}),'write')
assert.equal(reminderStepIntent({title:'Reminders',instruction:'28 Sep 2026 at 5 pm'}),'unknown')
consentEnabled=true;embeddingFails=false
for(const kind of ['profile','insight']){
 profileLookupFails=kind==='profile';insightLookupFails=kind==='insight'
 const pack=await exports.buildContextPack({actor,text:'What is my saved context?'})
 assert.equal(pack.retrievalIncomplete,true,kind)
}
console.log('Whole-step reminder classification and partial profile/insight outage disclosure passed')

assert.equal(travelTime.ticketTimezone('IST'),'Europe/Istanbul')
assert.equal(flightInstants({from:'IST',to:'BLR',date:'28 Sep 2026',departure:'10:00'}).departAt?.toISOString(),'2026-09-28T07:00:00.000Z')
for(const [code,zone] of Object.entries({EST:'America/Chicago',MST:'Europe/Amsterdam',HST:'America/New_York'}))assert.equal(travelTime.ticketTimezone(code),zone,code)
assert.equal(reminderStepIntent({title:'Cancel reminder',instruction:'Cancel the reminder for 28 Sep 2026 at 5 pm'}),'unknown')
console.log('Airport-code precedence and unsupported reminder mutation guards passed')

for(const instruction of ['Review my reminders before creating one for 5 pm','Review my reminders before adding one for 5 pm','Review reminders after setting one for 5 pm','Review reminders before making a new one','Inspect saved entries while scheduling a new reminder']){
 assert.equal(reminderStepIntent({title:'Review reminders',instruction}),'mixed',instruction)
}
assert.equal(reminderStepIntent({title:'Create a reminder',instruction:'Create a reminder to review my travel documents at 5 pm'}),'write')
console.log('Every operation in mixed reminder clauses is classified, including gerunds')

// Fall-back clocks must remain unverified, including half-hour transitions.
assert.equal(ticketInstant('1 Nov 2026','01:30','America/New_York'),null)
assert.equal(ticketInstant('1 Nov 2026','02:30','America/New_York')?.toISOString(),'2026-11-01T07:30:00.000Z')
assert.equal(ticketInstant('5 Apr 2026','01:45','Australia/Lord_Howe'),null)
assert.equal(verifiedBrowserAnswer({complete:true,evidence:['Status: operational']},'Status: operational'),'Status: operational')
assert.equal(verifiedBrowserAnswer({complete:true,evidence:['Status: operational']},'Loading...'),null)
for(const followup of ['When are they landing?','Show their arrival time','What about them?','When do those arrive?']){
  assert.match(recallQuery(followup,[{role:'user',content:'Divya and Ravi fly to New York'},{role:'assistant',content:'Invented Rome booking'}]),/Divya and Ravi/)
}

// Scoped review searches beyond the first 50 and never displays unrelated rows.
const {readScopedReminders}=await import('../lib/agent/reminder-read')
const reminderRows=Array.from({length:101},(_,i)=>({id:String(i),message:i===100?'New York check-in':'Mumbai packing',remind_at:'2030-01-01T00:00:00Z',timezone:'UTC'}))
const pageOffsets:number[]=[]
;(supabaseAdmin as any).from=(table:string)=>{
 assert.equal(table,'reminders')
 const q:any={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(value,17);return q},gte:()=>q,order:()=>q,range:async(start:number,end:number)=>{pageOffsets.push(start);return {data:reminderRows.slice(start,end+1),error:null}}}
 return q
}
try{
 const scoped=await readScopedReminders(17,{title:'Review reminders',instruction:'Review reminders for New York'},'Review New York trip')
 assert.deepEqual(scoped.reminders.map(row=>row.id),['100'])
 assert.deepEqual(pageOffsets,[0,100])
 await assert.rejects(()=>readScopedReminders(17,{title:'Review reminders',instruction:'Review reminders for this trip'},'Review this trip'),/scope_unverified/)
 const all=await readScopedReminders(17,{title:'Review reminders',instruction:'List all my reminders'},'List all reminders')
 assert.equal(all.reminders.length,101)
}finally{(supabaseAdmin as any).from=originalFrom}
