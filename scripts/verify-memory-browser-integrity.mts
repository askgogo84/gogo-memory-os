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

const rows=[{id:'leg',type:'flight',from_city:'Abu Dhabi',to_city:'New York',depart_at:second.departAt!.toISOString(),arrive_at:second.arriveAt!.toISOString(),passengers:['Divyashree Example'],flight_no:'EY1',booking_group:'trip',raw:{timeNormalizationVersion:2}}]
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
const lexicalFilters:string[]=[]
const database={rpc:async()=>({data:[],error:null}),from:(table:string)=>{
  const filters:Array<[string,unknown]>=[]
  queries.push({table,filters})
  const result=()=>({data:table==='user_consent_settings'?{memory_enabled:consentEnabled}:table==='user_memory_profile'?null:(stores[table]||[]).filter(row=>filters.every(([key,value])=>String(row[key])===String(value))),error:(table==='user_memory_profile'&&profileLookupFails||table==='user_insights'&&insightLookupFails)?{message:'fixture lookup outage'}:null})
  const q:any={select:()=>q,eq:(key:string,value:unknown)=>{filters.push([key,value]);return q},is:()=>q,or:(filter:string)=>{if(['memories','memory_embeddings'].includes(table))lexicalFilters.push(filter);return q},in:()=>q,gte:()=>q,lte:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>result(),then:(resolve:any)=>Promise.resolve(result()).then(resolve)}
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
lexicalFilters.length=0
await exports.buildContextPack({actor,text:recallQuery('When are they landing?',[{role:'user',content:'Divya and Ravi fly to New York'}])})
assert.ok(lexicalFilters.length>=2)
for(const filter of lexicalFilters){
 for(const name of ['divya','ravi','new','york'])assert.ok(filter.includes(`%${name}%`))
 assert.doesNotMatch(filter,/%(?:previous|user|request|are|they|and|fly)%/)
}
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
const {executeVerifiedMissionReminder,reminderStepIntent,explicitDates}=await import('../lib/agent/mission-tools')
assert.deepEqual(explicitDates('January 5',2026,'2026-09-29'),['2027-01-05'])
assert.deepEqual(explicitDates('5 January 2026',2026,'2026-09-29'),['2026-01-05'])
assert.deepEqual(explicitDates('February 29',2026,'2026-09-29'),['2028-02-29'])
assert.deepEqual(explicitDates('September 29',2026,'2026-09-29'),['2026-09-29'])
assert.deepEqual(explicitDates('January 5',2027,'2027-01-01'),['2027-01-05'])
const {supabaseAdmin}=await import('../lib/supabase-admin')
const originalFrom=supabaseAdmin.from
let reminderQueries=0,reminderReadFails=false
;(supabaseAdmin as any).from=(table:string)=>{
 if(table==='users')return {select:()=>({eq:()=>({maybeSingle:async()=>({data:{timezone:'Asia/Kolkata'},error:null})})})}
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

const chicago=buildTravelPresenceFacts([{...rows[0],to_city:'Chicago',raw:{arrivalTimezone:'America/Chicago',timeNormalizationVersion:2}}],Date.parse('2026-09-28T06:00Z')).find(f=>f.source==='travel_ticket')!
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
 const multiple=await readScopedReminders(17,{title:'Review reminders',instruction:'Review reminders for New York and Mumbai'},'Review both trips')
 assert.equal(multiple.reminders.length,101)
 const all=await readScopedReminders(17,{title:'Review reminders',instruction:'List all my reminders'},'List all reminders')
 assert.equal(all.reminders.length,101)
 for(const prompt of ['Do I have any reminders?','Are there any reminders?','Can you please show me my reminders?','Look for reminders that I have coming up','How many reminders do I have?','Can you tell me how many reminders I have?','When are my reminders?','Where are my reminders?','Get my reminders','Search for my reminders','Please fetch my reminders','Find out if I have any reminders','Find out whether I have any reminders','Give me my reminders','Provide my reminders','Bring up my reminders']){
  const result=await readScopedReminders(17,{title:'Review reminders',instruction:prompt},prompt)
  assert.equal(result.reminders.length,101,prompt)
 }
}finally{(supabaseAdmin as any).from=originalFrom}

assert.equal(reminderStepIntent({title:'Review reminders',instruction:'Review active reminders without creating, editing, or deleting anything'}),'read')

assert.equal(reminderStepIntent({title:'Review reminders',instruction:'Review reminders without deleting anything, then create one for 5 pm'}),'mixed')
assert.equal(reminderStepIntent({title:'Show reminders',instruction:'Show reminders set for 5 pm'}),'read')
assert.equal(reminderStepIntent({title:'List reminders',instruction:'List scheduled reminders'}),'read')
;(supabaseAdmin as any).from=(table:string)=>{
 if(table==='users')return {select:()=>({eq:()=>({maybeSingle:async()=>({data:{timezone:'Asia/Kolkata'},error:null})})})}
 const q:any={select:()=>q,eq:()=>q,gte:()=>q,order:()=>q,range:async()=>({data:[{id:'five',message:'Packing',remind_at:'2030-09-28T11:30:00Z',timezone:'Asia/Kolkata'},{id:'six',message:'Packing',remind_at:'2030-09-28T12:30:00Z',timezone:'Asia/Kolkata'}],error:null})}
 return q
}
try{
 const timed=await executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Review reminders',instruction:'Review reminders for 28 Sep 2030 at 5 pm'},missionText:'Review reminders'})
 assert.ok('reminders' in timed.output)
 assert.deepEqual((timed.output as any).reminders.map((row:any)=>row.id),['five'])
 assert.match(timed.text,/17:00.*Asia\/Kolkata/)
 const explicitZone=await executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Review reminders',instruction:'Show reminders for 28 Sept 2030 at 17:00 ist'},missionText:'Review reminders'})
 assert.deepEqual((explicitZone.output as any).reminders.map((row:any)=>row.id),['five'])
 const multipleClocks=await executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Review reminders',instruction:'Show reminders at 5 pm and 6 pm'},missionText:'Review reminders'})
 assert.deepEqual((multipleClocks.output as any).reminders.map((row:any)=>row.id),['five','six'])
 const nextWeek=await executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Review reminders',instruction:"Show next week's reminders"},missionText:'Review reminders'})
 assert.equal((nextWeek.output as any).reminders.length,0,'next week must not include unrelated 2030 reminders')
 const tomorrow=await executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Review reminders',instruction:"Show tomorrow's reminders"},missionText:'Review reminders'})
 assert.equal((tomorrow.output as any).reminders.length,0,'tomorrow must not include unrelated 2030 reminders')
 const clockOnly=await readScopedReminders(17,{title:'Show reminders',instruction:'Show reminders set for 5 pm'},'Review reminders',{timezone:'Asia/Kolkata',dates:[],clock:'17:00'})
 assert.deepEqual(clockOnly.reminders.map(row=>row.id),['five'])
}finally{(supabaseAdmin as any).from=originalFrom}

assert.equal(reminderStepIntent({title:'Set reminders',instruction:'Set reminders for 28 Sep 2030 at 5 pm'}),'write')
assert.equal(reminderStepIntent({title:'Reminders',instruction:'Review reminders without deleting anything, and create one for 5 pm'}),'mixed')
assert.equal(reminderStepIntent({title:'Review reminders',instruction:'Review reminders without creating, editing, and deleting anything'}),'read')
const {reminderScope}=await import('../lib/agent/reminder-read')
assert.deepEqual(reminderScope({title:'Review reminders',instruction:'Show reminders for 28 Sep 2030 at 5 pm IST'},'Review reminders').scopeTerms,[])

const {reminderTimezoneMetadata}=await import('../lib/agent/reminder-read')
assert.ok(['Asia/Kolkata','Asia/Calcutta'].includes(reminderTimezoneMetadata('5 pm ist').timezone!))
assert.equal(reminderTimezoneMetadata('5 pm America/Port-au-Prince').timezone,'America/Port-au-Prince')
assert.deepEqual(reminderScope({title:'Review reminders',instruction:'Show reminders for 28 Sep 2030 at 5 pm America/Port-au-Prince'},'Review reminders').scopeTerms,[])
assert.deepEqual(reminderScope({title:'Review reminders',instruction:'Show reminders for 28 Sep 2030 at 5 pm ist'},'Review reminders').scopeTerms,[])

assert.equal(reminderStepIntent({title:'Show reminders',instruction:'Show reminders I created for the conference'}),'read')
assert.equal(reminderStepIntent({title:'List reminders',instruction:'List reminders I added yesterday'}),'read')
const ticketWrites:Array<{table:string;row:any}>=[]
let legacyReminders:any[]=[],legacyTickets:any[]=[]
const updatedTickets:any[]=[]
const updatedLegacy:any[]=[],deletedLegacy:string[]=[]
const ticketDb={from:(table:string)=>{
 const filters:any={};let deleting=false;const q:any={select:()=>q,order:()=>q,range:async(start:number,end:number)=>({data:(table==='reminders'?legacyReminders:legacyTickets).filter(row=>Object.entries(filters).every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value)).slice(start,end+1),error:null}),or:(clause:string)=>{filters[clause.split('.')[0]]=[null,''];return q},is:(key:string,value:any)=>{filters[key]=value;return q},eq:(key:string,value:any)=>{filters[key]=value;return q},in:(key:string,value:any)=>{filters[key]=value;return q},limit:async()=>({data:(table==='reminders'?legacyReminders:legacyTickets).filter(row=>Object.entries(filters).every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value)),error:null}),update:(row:any)=>{(table==='reminders'?updatedLegacy:updatedTickets).push(row);return q},delete:()=>{deleting=true;return q},then:(resolve:any)=>{if(deleting){legacyReminders=legacyReminders.filter(row=>{const match=Object.entries(filters).every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value);if(match)deletedLegacy.push(row.id);return !match})}return Promise.resolve({error:null}).then(resolve)},insert:async(row:any)=>{ticketWrites.push({table,row});if(table==='travel_tickets')legacyTickets.push({...row,flight_no:row.flight_no??null,pnr:row.pnr??null,id:`stored-${ticketWrites.length}`});return {error:null}}};return q
}}
const ticketModule:any={}
const airlineCheckin=await import('../lib/services/airline-checkin')
const ticketMocks:any={'./travel-time':travelTime,'@/lib/supabase-admin':{supabaseAdmin:ticketDb},'@/lib/lists':{addToList:async()=>{}},'./pdf-reader':{buildTicketReply:(_info:unknown,tail:string)=> `Ticket saved${tail}`},'./airline-checkin':airlineCheckin}
runInNewContext(ts.transpileModule(readFileSync('lib/services/travel-tickets.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:ticketModule,require:(name:string)=>ticketMocks[name],console,Date,Intl})
const ticketReply=await ticketModule.persistAndRemindTicket({type:'flight',passengers:['Example'],flights:[{from:'SFO',to:'JFK',date:'28 Sep 2040',departure:'10:00',arrival:'18:00',arrivalDate:'28 Sep 2040',airline:'United',flightNo:'UA123',pnr:'TEST99'}]},{telegramId:17,whatsappTo:null,timezone:'Asia/Kolkata',source:'pdf'})
const reminderWrites=ticketWrites.filter(write=>write.table==='reminders')
assert.ok(reminderWrites.length>0)
assert.ok(reminderWrites.every(write=>write.row.timezone==='America/Los_Angeles'))
assert.match(ticketReply.reply,/America\/Los_Angeles/)

legacyReminders=reminderWrites.map((write,i)=>({...write.row,id:`legacy-${i}`,timezone:'Asia/Kolkata',message:write.row.message.replace(/ \(America\/Los_Angeles\)(?=[!.])/g,'').replace('departs 28 Sep 2040','departs Fri 28 Sep')}))
const beforeReforward=ticketWrites.filter(write=>write.table==='reminders').length
await ticketModule.persistAndRemindTicket({type:'flight',passengers:['Example'],flights:[{from:'SFO',to:'JFK',date:'28 Sep 2040',departure:'10:00',arrival:'18:00',arrivalDate:'28 Sep 2040',airline:'United',flightNo:'UA123',pnr:'TEST99'}]},{telegramId:17,whatsappTo:null,timezone:'Asia/Kolkata',source:'pdf'})
assert.equal(ticketWrites.filter(write=>write.table==='reminders').length,beforeReforward,'legacy re-forward must not duplicate alerts')
assert.equal(updatedLegacy.length,reminderWrites.length)
assert.ok(updatedLegacy.every(row=>row.timezone==='America/Los_Angeles'))

assert.equal(reminderStepIntent({title:'Create reminder',instruction:'Create and schedule a reminder for 5 pm'}),'write')
assert.equal(reminderStepIntent({title:'Create reminder',instruction:'Make sure a reminder is set for 5 pm'}),'write')
assert.equal(reminderStepIntent({title:'Create reminders',instruction:'Create a reminder for 5 pm and add another for 6 pm'}),'mixed')

const currentTicket=ticketWrites.find(write=>write.table==='travel_tickets')!.row
legacyTickets=[{...currentTicket,id:'old-flight',depart_at:'2040-09-28T04:30:00Z',depart_tz:'Asia/Kolkata'}]
const shift=Date.parse(legacyTickets[0].depart_at)-Date.parse(currentTicket.depart_at)
legacyReminders=reminderWrites.map((write,i)=>({...write.row,id:`wrong-zone-${i}`,remind_at:new Date(Date.parse(write.row.remind_at)+shift).toISOString(),timezone:'Asia/Kolkata'}))
const writesBefore=ticketWrites.length
await ticketModule.persistAndRemindTicket({type:'flight',passengers:['Example'],flights:[{from:'SFO',to:'JFK',date:'28 Sep 2040',departure:'10:00',arrival:'18:00',arrivalDate:'28 Sep 2040',airline:'United',flightNo:'UA123',pnr:'TEST99'}]},{telegramId:17,whatsappTo:null,timezone:'Asia/Kolkata',source:'pdf'})
assert.equal(ticketWrites.length,writesBefore,'correcting a legacy departure updates ticket and alerts in place')
assert.equal(updatedTickets.at(-1).depart_at,currentTicket.depart_at)
assert.deepEqual(updatedLegacy.slice(-reminderWrites.length).map(row=>row.remind_at),reminderWrites.map(write=>write.row.remind_at))

;(supabaseAdmin as any).from=(table:string)=>{
 if(table==='users')return {select:()=>({eq:()=>({maybeSingle:async()=>({data:{timezone:'Asia/Kolkata'},error:null})})})}
 const rows=['28','29'].flatMap(day=>['11:30','12:30'].map(time=>({id:`${day}-${time}`,message:'Packing',remind_at:`2030-09-${day}T${time}:00Z`,timezone:'Asia/Kolkata'})))
 const q:any={select:()=>q,eq:()=>q,gte:()=>q,order:()=>q,range:async()=>({data:rows,error:null})};return q
}
try{
 const upcoming=await executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Review reminders',instruction:'Show reminders that are upcoming'},missionText:'Show reminders that are upcoming'})
 assert.equal((upcoming.output as any).reminders.length,4,'grammatical auxiliaries must not filter account-wide reminders')
 const commaDates=await executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Review reminders',instruction:'Show reminders for Sep 28, 2030 at 5 pm, and Sep 29, 2030 at 6 pm'},missionText:'Review reminders'})
 assert.deepEqual((commaDates.output as any).reminders.map((row:any)=>row.id),['28-11:30','29-12:30'])
 const paired=await executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Review reminders',instruction:'Show reminders for 28 Sep 2030 at 5 pm and 29 Sep 2030 at 6 pm'},missionText:'Review reminders'})
 assert.deepEqual((paired.output as any).reminders.map((row:any)=>row.id),['28-11:30','29-12:30'])
}finally{(supabaseAdmin as any).from=originalFrom}

const priorInstantReminders=legacyReminders
legacyReminders=reminderWrites.map((write,i)=>({...write.row,id:`exact-sent-${i}`,sent:true}))
const sentUpdatesBefore=updatedLegacy.length
const sentReply=await ticketModule.persistAndRemindTicket({type:'flight',passengers:['Example'],flights:[{from:'SFO',to:'JFK',date:'28 Sep 2040',departure:'10:00',arrival:'18:00',arrivalDate:'28 Sep 2040',airline:'United',flightNo:'UA123',pnr:'TEST99'}]},{telegramId:17,whatsappTo:null,timezone:'Asia/Kolkata',source:'pdf'})
assert.equal(sentReply.remindersSet,0)
assert.equal(updatedLegacy.length,sentUpdatesBefore)
assert.match(sentReply.reply,/already sent and were not rearmed/)
assert.doesNotMatch(sentReply.reply,/Departure alert|Check-in alert/)
legacyReminders=priorInstantReminders.map(row=>({...row,sent:true}))

assert.equal(reminderStepIntent({title:'Check reminder',instruction:'Check whether the reminder was created'}),'read')
assert.equal(reminderStepIntent({title:'Show reminder',instruction:'Show whether the reminder is scheduled'}),'read')
legacyReminders.push(...reminderWrites.map((write,i)=>({...write.row,id:`pending-${i}`,sent:false})))
const pendingReply=await ticketModule.persistAndRemindTicket({type:'flight',passengers:['Example'],flights:[{from:'SFO',to:'JFK',date:'28 Sep 2040',departure:'10:00',arrival:'18:00',arrivalDate:'28 Sep 2040',airline:'United',flightNo:'UA123',pnr:'TEST99'}]},{telegramId:17,whatsappTo:null,timezone:'Asia/Kolkata',source:'pdf'})
assert.match(pendingReply.reply,/Departure alert/)
assert.doesNotMatch(pendingReply.reply,/No new alerts scheduled/)

legacyReminders=legacyReminders.map(row=>({...row,sent:false}))
legacyReminders.push({...legacyReminders[0],id:'sent-history',sent:true})
const canonicalUpdatesBefore=updatedLegacy.length
await ticketModule.persistAndRemindTicket({type:'flight',passengers:['Example'],flights:[{from:'SFO',to:'JFK',date:'28 Sep 2040',departure:'10:00',arrival:'18:00',arrivalDate:'28 Sep 2040',airline:'United',flightNo:'UA123',pnr:'TEST99'}]},{telegramId:17,whatsappTo:null,timezone:'Asia/Kolkata',source:'pdf'})
assert.equal(updatedLegacy.length,canonicalUpdatesBefore,'canonical pending rows must be preferred over earlier legacy pending rows')

assert.equal(legacyReminders.filter(row=>!row.sent).length,reminderWrites.length,'retire extra pending legacy matches')
assert.equal(deletedLegacy.length,reminderWrites.length)
assert.ok(legacyReminders.some(row=>row.id==='sent-history'&&row.sent),'preserve sent history')
assert.ok(legacyReminders.filter(row=>!row.sent).every(row=>row.id.startsWith('pending-')))

legacyTickets=[{...currentTicket,id:'already-corrected-flight'}]
legacyReminders=[...reminderWrites.map((write,i)=>({...write.row,id:`leftover-${i}`,remind_at:new Date(Date.parse(write.row.remind_at)+shift).toISOString(),timezone:'Asia/Kolkata',sent:false})),...reminderWrites.map((write,i)=>({...write.row,id:`correct-${i}`,sent:false}))]
await ticketModule.persistAndRemindTicket({type:'flight',passengers:['Example'],flights:[{from:'SFO',to:'JFK',date:'28 Sep 2040',departure:'10:00',arrival:'18:00',arrivalDate:'28 Sep 2040',airline:'United',flightNo:'UA123',pnr:'TEST99'}]},{telegramId:17,whatsappTo:null,timezone:'Asia/Kolkata',source:'pdf'})
assert.equal(legacyReminders.length,reminderWrites.length)
assert.ok(legacyReminders.every(row=>row.id.startsWith('correct-')),'find legacy IST alerts even when the ticket was already corrected')

const legacyArrival={id:'legacy-arrival',type:'flight',from_city:'SFO',to_city:'JFK',depart_at:'2040-09-28T04:30:00Z',arrive_at:'2040-09-28T12:30:00Z',depart_tz:'Asia/Kolkata',raw:{date:'28 Sep 2040',departure:'10:00',arrival:'18:00',arrivalDate:'28 Sep 2040'}}
const recomputed=buildTravelPresenceFacts([legacyArrival],Date.parse('2040-09-28T00:00Z')).find(f=>f.source==='travel_ticket')!
assert.equal(recomputed.startAt,'2040-09-28T17:00:00.000Z')
assert.equal(recomputed.endAt,'2040-09-28T22:00:00.000Z')
assert.match(recomputed.summary,/18:00.*America\/New_York/)
const incompleteLegacy=buildTravelPresenceFacts([{...legacyArrival,raw:{...legacyArrival.raw,arrivalDate:undefined}}],Date.parse('2040-09-28T00:00Z'))
assert.equal(incompleteLegacy.find(f=>f.source==='travel_ticket')!.endAt,null)
assert.ok(!incompleteLegacy.some(f=>f.source==='travel_presence'))

const unknownOrigin=buildTravelPresenceFacts([{...legacyArrival,from_city:'Unknown airport'}],Date.parse('2040-09-28T00:00Z')).find(f=>f.source==='travel_ticket')!
assert.equal(unknownOrigin.startAt,null)
assert.equal(unknownOrigin.endAt,null)
assert.match(unknownOrigin.summary,/Departure instant unverified/)
const repeatedClock=buildTravelPresenceFacts([{...legacyArrival,from_city:'JFK',to_city:'LHR',raw:{date:'1 Nov 2026',departure:'01:30',arrival:'14:00',arrivalDate:'1 Nov 2026'}}],Date.parse('2026-11-01T00:00Z')).find(f=>f.source==='travel_ticket')!
assert.equal(repeatedClock.startAt,null)
assert.equal(repeatedClock.endAt,null)

assert.equal(travelTime.ticketTimezone('Goa'),'Asia/Kolkata')
assert.equal(travelTime.ticketTimezone('goa'),'Asia/Kolkata')
assert.equal(travelTime.ticketTimezone('GOA'),'Europe/Rome')
const unknownTicketBefore=ticketWrites.length
const unknownReply=await ticketModule.persistAndRemindTicket({type:'flight',passengers:['Named Passenger'],flights:[{from:'Unknown airport',to:'JFK',date:'28 Sep 2040',departure:'10:00',arrival:'18:00',arrivalDate:'28 Sep 2040',airline:'Example',flightNo:'XX123',pnr:'UNKNOWN99'}]},{telegramId:17,whatsappTo:null,timezone:'Asia/Kolkata',source:'pdf'})
const unknownWrites=ticketWrites.slice(unknownTicketBefore)
assert.equal(unknownWrites.length,1)
assert.equal(unknownWrites[0].table,'travel_tickets')
assert.equal(unknownWrites[0].row.depart_at,null)
assert.deepEqual(unknownWrites[0].row.passengers,['Named Passenger'])
assert.equal(unknownWrites[0].row.pnr,'UNKNOWN99')
assert.equal(unknownReply.remindersSet,0)
assert.match(unknownReply.reply,/could not verify the departure/)

const throughBefore=ticketWrites.length
await ticketModule.persistAndRemindTicket({type:'flight',passengers:['Example'],flights:[{from:'BLR',to:'AUH',date:'28 Sep 2040',departure:'10:00',arrival:'12:00',arrivalDate:'28 Sep 2040',airline:'Example',flightNo:'XX222',pnr:'THROUGH99'},{from:'AUH',to:'JFK',date:'28 Sep 2040',departure:'14:00',arrival:'19:00',arrivalDate:'28 Sep 2040',airline:'Example',flightNo:'XX222',pnr:'THROUGH99'}]},{telegramId:17,whatsappTo:null,timezone:'Asia/Kolkata',source:'pdf'})
const throughRows=ticketWrites.slice(throughBefore).filter(write=>write.table==='travel_tickets').map(write=>write.row)
assert.equal(throughRows.length,2)
assert.deepEqual(throughRows.map(row=>[row.leg_index,row.from_city,row.to_city]),[[0,'BLR','AUH'],[1,'AUH','JFK']])
assert.equal(buildTravelPresenceFacts([{...legacyArrival,from_city:'Unknown airport',depart_at:null,raw:{date:'28 Sep 2020',departure:'10:00'}}],Date.parse('2040-09-28T00:00Z')).length,0,'old null-time identities cannot enter current context')

await assert.rejects(()=>executeVerifiedMissionReminder({actor:actor as any,step:{tool:'reminders',title:'Set reminders',instruction:'Set reminders on 28 Sep 2030 at 5 pm and 29 Sep 2030 at 6 pm'},missionText:'Set reminders'}),/multiple_instants_require_separate_steps/)

const unverifiedInfo={type:'flight',passengers:['Named Passenger'],flights:[{from:'Unknown airport',to:'JFK',date:'28 Sep 2040',departure:'10:00',arrival:'18:00',arrivalDate:'28 Sep 2040',airline:'Example',flightNo:'XX123',pnr:'UNKNOWN99'}]}
const priorInstant=new Date('2040-09-28T04:30:00Z')
legacyTickets=[{...unknownWrites[0].row,id:'legacy-unknown',depart_at:priorInstant.toISOString()}]
const unknownLeg=ticketModule.buildLegs(unverifiedInfo)[0]
const priorDecisions=ticketModule.planLegReminders({...unknownLeg,departAt:priorInstant},Number.NEGATIVE_INFINITY).filter((d:any)=>d.remindAt)
legacyReminders=priorDecisions.map((d:any,i:number)=>({id:`unverified-${i}`,telegram_id:17,message:d.message,remind_at:d.remindAt.toISOString(),sent:false}))
legacyReminders.push({...legacyReminders[0],id:'unverified-sent-history',sent:true})
await ticketModule.persistAndRemindTicket(unverifiedInfo,{telegramId:17,whatsappTo:null,timezone:'Asia/Kolkata',source:'pdf'})
assert.equal(updatedTickets.at(-1).depart_at,null,'withdraw the untrusted stored departure')
assert.equal(legacyReminders.map(row=>row.id).join(','),'unverified-sent-history','retire pending unverified alerts while preserving sent history')
console.log('Unverified corrections withdraw old timestamps and pending alerts')

legacyTickets=[];legacyReminders=[]
const partialTicket={type:'flight',flights:[{from:'Unknown airport',to:'JFK',date:'28 Sep 2040',departure:'10:00',pnr:'PARTIAL-A'}]}
const ticketCtx={telegramId:17,whatsappTo:null,timezone:'Asia/Kolkata',source:'pdf'}
await ticketModule.persistAndRemindTicket(partialTicket,ticketCtx)
assert.equal(legacyTickets.length,1)
assert.equal(legacyTickets[0].depart_at,null)
await ticketModule.persistAndRemindTicket({...partialTicket,flights:[{...partialTicket.flights[0],departureTimezone:'Asia/Kolkata'}]},ticketCtx)
assert.equal(legacyTickets.length,1,'resolved fallback identity updates the unknown-time row')
assert.equal(updatedTickets.at(-1).depart_at,'2040-09-28T04:30:00.000Z')
await ticketModule.persistAndRemindTicket({...partialTicket,flights:[{...partialTicket.flights[0],pnr:'PARTIAL-B'}]},ticketCtx)
assert.equal(legacyTickets.length,2,'different available PNRs must not overwrite each other')
console.log('Partial flight identity survives timing correction and preserves distinct PNRs')

legacyTickets=[{...currentTicket,id:'canonical-flight'}];legacyReminders=[]
const canonicalBefore=ticketWrites.filter(write=>write.table==='travel_tickets').length
await ticketModule.persistAndRemindTicket({type:'flight',flights:[{from:'San Francisco',to:'JFK',date:'28 September 2040',departure:'10:00',arrival:'18:00',arrivalDate:'28 September 2040',airline:'United',flightNo:'UA123',pnr:'TEST99'}]},ticketCtx)
assert.equal(ticketWrites.filter(write=>write.table==='travel_tickets').length,canonicalBefore,'parser label changes reuse canonical departure identity')
assert.equal(updatedTickets.at(-1).from_city,'San Francisco')
console.log('Equivalent printed city/date labels reuse the canonical saved flight')

legacyTickets=[];legacyReminders=[]
await ticketModule.persistAndRemindTicket(partialTicket,ticketCtx)
await ticketModule.persistAndRemindTicket({...partialTicket,flights:[{...partialTicket.flights[0],date:'28 September 2040',departureTimezone:'Asia/Kolkata'}]},ticketCtx)
assert.equal(legacyTickets.length,1,'renamed printed date reconciles null-time flight before canonical lookup')
assert.equal(updatedTickets.at(-1).depart_at,'2040-09-28T04:30:00.000Z')
console.log('Normalized printed dates reconcile unknown-time tickets in place')

legacyTickets=[];legacyReminders=[]
const missingIds={type:'flight',flights:[{from:'Unknown airport',to:'JFK',date:'28 Sep 2040',departure:'10:00'}]}
await ticketModule.persistAndRemindTicket(missingIds,ticketCtx)
await ticketModule.persistAndRemindTicket({...missingIds,flights:[{...missingIds.flights[0],date:'28 September 2040',departureTimezone:'Asia/Kolkata',pnr:'NEW-PNR',flightNo:'XX789'}]},ticketCtx)
assert.equal(legacyTickets.length,1,'newly learned identifiers enrich the compatible unknown-time ticket')
assert.equal(updatedTickets.at(-1).pnr,'NEW-PNR')
legacyTickets=[{...currentTicket,id:'unrelated-weak-flight',pnr:null,flight_no:null,from_city:'LAX',to_city:'SEA'}]
const weakUpdates=updatedTickets.length
await ticketModule.persistAndRemindTicket({type:'flight',flights:[{from:'SFO',to:'JFK',date:'28 Sep 2040',departure:'10:00'}]},ticketCtx)
assert.equal(updatedTickets.length,weakUpdates,'weak canonical identity cannot overwrite another route at the same instant')
console.log('Missing ticket identifiers are enriched; unrelated weak identities remain isolated')

legacyTickets=[];legacyReminders=[]
const knownNoIds={type:'flight',flights:[{from:'SFO',to:'JFK',date:'28 Sep 2040',departure:'10:00'}]}
await ticketModule.persistAndRemindTicket(knownNoIds,ticketCtx)
await ticketModule.persistAndRemindTicket({...knownNoIds,flights:[{...knownNoIds.flights[0],pnr:'ENRICHED',flightNo:'XX999'}]},ticketCtx)
assert.equal(legacyTickets.length,1,'known-time canonical row is enriched instead of duplicated')
assert.equal(updatedTickets.at(-1).pnr,'ENRICHED')
console.log('Known-time ticket enrichment preserves the original record')

legacyTickets=[];legacyReminders=[]
await ticketModule.persistAndRemindTicket(missingIds,ticketCtx)
await ticketModule.persistAndRemindTicket({...missingIds,flights:[{...missingIds.flights[0],pnr:'STILL-UNKNOWN',flightNo:'XX888'}]},ticketCtx)
assert.equal(legacyTickets.length,1,'identifier enrichment does not require a resolved departure')
assert.equal(updatedTickets.at(-1).pnr,'STILL-UNKNOWN')
legacyTickets=[{...currentTicket,id:'strong-canonical',pnr:'KEEP-PNR',flight_no:'KEEP123'}];legacyReminders=[]
const retainedCount=ticketWrites.filter(write=>write.table==='travel_tickets').length
await ticketModule.persistAndRemindTicket(knownNoIds,ticketCtx)
assert.equal(ticketWrites.filter(write=>write.table==='travel_tickets').length,retainedCount,'lower-quality re-forward reuses the saved canonical record')
assert.equal(updatedTickets.at(-1).pnr,'KEEP-PNR')
assert.equal(updatedTickets.at(-1).flight_no,'KEEP123')
console.log('Unknown-time enrichment and lower-quality canonical re-forwards preserve ticket identity')

legacyTickets=[{...currentTicket,id:'rich-ticket',passengers:['Saved Passenger'],seat:'14A',booking_group:'TEST99'}]
legacyReminders=reminderWrites.map((write,i)=>({...write.row,id:`rich-alert-${i}`,sent:false}))
const richAlertCount=ticketWrites.filter(write=>write.table==='reminders').length
await ticketModule.persistAndRemindTicket(knownNoIds,ticketCtx)
const richUpdate=updatedTickets.at(-1)
assert.deepEqual(JSON.parse(JSON.stringify(richUpdate.passengers)),['Saved Passenger'])
assert.equal(richUpdate.arrive_at,currentTicket.arrive_at)
assert.equal(richUpdate.seat,'14A')
assert.equal(richUpdate.airline,currentTicket.airline)
assert.equal(richUpdate.booking_group,'TEST99')
assert.equal(richUpdate.raw.arrival,currentTicket.raw.arrival)
assert.equal(ticketWrites.filter(write=>write.table==='reminders').length,richAlertCount,'restored identifiers rebuild matching reminder text instead of duplicating alerts')
assert.ok(!ticketWrites.filter(write=>write.table==='reminders').slice(richAlertCount).some(write=>/undefined|null/.test(write.row.message)))
console.log('Sparse re-forwards retain passenger/arrival metadata and reuse identifier-bearing reminders')
await ticketModule.persistAndRemindTicket({type:'flight',flights:[{...knownNoIds.flights[0],arrival:currentTicket.raw.arrival}]},ticketCtx)
assert.equal(updatedTickets.at(-1).arrive_at,currentTicket.arrive_at,'arrival clock with omitted date uses the saved arrival date')
await ticketModule.persistAndRemindTicket({type:'flight',flights:[{...knownNoIds.flights[0],arrivalDate:'31 Feb 2040'}]},ticketCtx)
assert.equal(updatedTickets.at(-1).arrive_at,null,'explicit invalid arrival date must not restore an older verified instant')


const correctedClock={type:'flight',flights:[{from:'SFO',to:'JFK',date:'28 Sep 2040',departure:'11:00',airline:'United',flightNo:'UA123',pnr:'TEST99'}]}
legacyTickets=[{...currentTicket,id:'clock-correction'}]
legacyReminders=reminderWrites.map((write,i)=>({...write.row,id:`clock-old-${i}`,sent:false}))
const clockInsertCount=ticketWrites.filter(write=>write.table==='reminders').length
const clockUpdateCount=updatedLegacy.length
await ticketModule.persistAndRemindTicket(correctedClock,ticketCtx)
assert.equal(ticketWrites.filter(write=>write.table==='reminders').length,clockInsertCount,'corrected clock updates pending alerts instead of duplicating')
assert.equal(updatedLegacy.length-clockUpdateCount,reminderWrites.length)
assert.ok(updatedLegacy.slice(clockUpdateCount).every(row=>row.message.includes('11:00')))
legacyTickets=[{...currentTicket,id:'clock-sent-correction'}]
legacyReminders=reminderWrites.map((write,i)=>({...write.row,id:`clock-sent-${i}`,sent:true}))
const revised=await ticketModule.persistAndRemindTicket(correctedClock,ticketCtx)
assert.equal(revised.remindersSet,reminderWrites.length,'sent alerts at the old instant do not suppress revised future alerts')
assert.ok(legacyReminders.every(row=>row.sent),'sent history remains untouched')
legacyTickets=[{...currentTicket,id:'clock-invalid-correction'}]
legacyReminders=reminderWrites.map((write,i)=>({...write.row,id:`clock-invalid-${i}`,sent:false}))
await ticketModule.persistAndRemindTicket({...correctedClock,flights:[{...correctedClock.flights[0],departure:'invalid'}]},ticketCtx)
assert.equal(legacyReminders.length,0,'invalid replacement clock retires pending prior-instant alerts')
console.log('Clock corrections reconcile pending alerts and schedule revised times without rearming sent history')

legacyTickets=[];legacyReminders=[]
const weakBefore=ticketWrites.length
await ticketModule.persistAndRemindTicket(knownNoIds,ticketCtx)
legacyReminders=ticketWrites.slice(weakBefore).filter(write=>write.table==='reminders').map((write,i)=>({...write.row,id:`weak-invalid-${i}`,sent:false}))
await ticketModule.persistAndRemindTicket({...knownNoIds,flights:[{...knownNoIds.flights[0],departure:'invalid'}]},ticketCtx)
assert.equal(legacyTickets.length,1,'invalid weak clock correction reuses the saved ticket')
assert.equal(legacyReminders.length,0,'invalid weak clock correction retires the saved pending alerts')
const yesterday=new Date(Date.now()-86400000)
const printedYesterday=`${yesterday.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][yesterday.getUTCMonth()]} ${yesterday.getUTCFullYear()}`
legacyTickets=[{...currentTicket,id:'moved-into-past',date_label:printedYesterday}]
legacyReminders=reminderWrites.map((write,i)=>({...write.row,id:`obsolete-future-${i}`,sent:false}))
await ticketModule.persistAndRemindTicket({...correctedClock,flights:[{...correctedClock.flights[0],date:printedYesterday}]},ticketCtx)
assert.equal(legacyReminders.length,0,'valid correction into the past retires both obsolete future alerts')
console.log('Weak invalid-clock corrections and elapsed scheduling windows retire obsolete alerts')

legacyTickets=[];legacyReminders=[]
const weakValidStart=ticketWrites.length
const weakWithPnr={...knownNoIds,flights:[{...knownNoIds.flights[0],pnr:'WEAK-CORRECTION'}]}
await ticketModule.persistAndRemindTicket(weakWithPnr,ticketCtx)
legacyReminders=ticketWrites.slice(weakValidStart).filter(write=>write.table==='reminders').map((write,i)=>({...write.row,id:`weak-valid-${i}`,sent:false}))
const weakValidAlerts=ticketWrites.filter(write=>write.table==='reminders').length
await ticketModule.persistAndRemindTicket({...weakWithPnr,flights:[{...weakWithPnr.flights[0],departure:'11:00'}]},ticketCtx)
assert.equal(legacyTickets.length,1,'valid weak clock correction reuses the saved row')
assert.equal(ticketWrites.filter(write=>write.table==='reminders').length,weakValidAlerts)
legacyTickets=[];legacyReminders=[]
const enrichingStart=ticketWrites.length
await ticketModule.persistAndRemindTicket(knownNoIds,ticketCtx)
legacyReminders=ticketWrites.slice(enrichingStart).filter(write=>write.table==='reminders').map((write,i)=>({...write.row,id:`enrich-alert-${i}`,sent:false}))
const enrichingAlerts=ticketWrites.filter(write=>write.table==='reminders').length
await ticketModule.persistAndRemindTicket({...knownNoIds,flights:[{...knownNoIds.flights[0],pnr:'ENRICHED',flightNo:'XX999',airline:'Example'}]},ticketCtx)
assert.equal(ticketWrites.filter(write=>write.table==='reminders').length,enrichingAlerts,'matched ticket supplies prior reminder identities during enrichment')
console.log('Valid weak corrections and identifier enrichment reconcile existing alerts')

legacyTickets=[];legacyReminders=[]
const carrierStart=ticketWrites.length
await ticketModule.persistAndRemindTicket(knownNoIds,ticketCtx)
legacyReminders=ticketWrites.slice(carrierStart).filter(write=>write.table==='reminders').map((write,i)=>({...write.row,id:`carrier-old-${i}`,sent:false}))
const carrierAlertCount=ticketWrites.filter(write=>write.table==='reminders').length
const carrierUpdates=updatedLegacy.length
await ticketModule.persistAndRemindTicket({...knownNoIds,flights:[{...knownNoIds.flights[0],pnr:'CARRIER-NEW',flightNo:'AI123',airline:'Air India'}]},ticketCtx)
assert.equal(ticketWrites.filter(write=>write.table==='reminders').length,carrierAlertCount,'new carrier window updates old reminder rather than inserting another')
assert.ok(updatedLegacy.slice(carrierUpdates).some(row=>row.message.includes('check-in')&&row.remind_at==='2040-09-26T17:00:00.000Z'))
console.log('Carrier enrichment searches the previous check-in window and moves its existing alert')

legacyTickets=[];legacyReminders=[]
await ticketModule.persistAndRemindTicket(knownNoIds,ticketCtx)
await ticketModule.persistAndRemindTicket({...knownNoIds,flights:[{...knownNoIds.flights[0],departure:'11:00'}]},ticketCtx)
assert.equal(legacyTickets.length,2,'distinct same-day clocks without a shared identifier remain separate flights')
console.log('A clock change requires shared correction identity; anonymous same-day flights remain distinct')

legacyTickets=[{...currentTicket,id:'postponed-ticket'}]
legacyReminders=reminderWrites.map((write,i)=>({...write.row,id:`postponed-old-${i}`,sent:false}))
const postponedInsertCount=ticketWrites.length
const postponedUpdates=updatedLegacy.length
await ticketModule.persistAndRemindTicket({...correctedClock,flights:[{...correctedClock.flights[0],date:'29 Sep 2040',departure:'10:00'}]},ticketCtx)
assert.equal(ticketWrites.length,postponedInsertCount,'strong identity reschedule updates ticket and alerts instead of duplicating')
assert.equal(updatedTickets.at(-1).depart_at,'2040-09-29T17:00:00.000Z')
assert.equal(updatedLegacy.length-postponedUpdates,reminderWrites.length)
console.log('Strong flight reschedules reconcile across printed departure dates')

legacyTickets=[...Array.from({length:250},(_,i)=>({...currentTicket,id:`unrelated-${i}`,pnr:`UNRELATED-${i}`})),{...currentTicket,id:'matching-after-page'}];legacyReminders=[]
const largeHistoryCount=ticketWrites.filter(write=>write.table==='travel_tickets').length
await ticketModule.persistAndRemindTicket({...correctedClock,flights:[{...correctedClock.flights[0],date:'29 Sep 2040',departure:'10:00'}]},ticketCtx)
assert.equal(ticketWrites.filter(write=>write.table==='travel_tickets').length,largeHistoryCount,'unrelated history pages do not prevent strong reschedule matching')
assert.equal(updatedTickets.at(-1).depart_at,'2040-09-29T17:00:00.000Z')
console.log('Ticket compatibility paginates unrelated history before evaluating ambiguity')

legacyTickets=[];legacyReminders=[]
const explicitZone={type:'flight',flights:[{from:'Ambiguous airport',to:'JFK',date:'28 Sep 2040',departure:'10:00',departureTimezone:'Asia/Kolkata',flightNo:'XX777',pnr:'ZONE-KEEP'}]}
await ticketModule.persistAndRemindTicket(explicitZone,ticketCtx)
await ticketModule.persistAndRemindTicket({...explicitZone,flights:[{...explicitZone.flights[0],departureTimezone:undefined}]},ticketCtx)
assert.equal(updatedTickets.at(-1).depart_at,'2040-09-28T04:30:00.000Z','omitted normalization metadata retains verified departure')
assert.equal(updatedTickets.at(-1).depart_tz,'Asia/Kolkata')
await ticketModule.persistAndRemindTicket({...explicitZone,flights:[{...explicitZone.flights[0],departureTimezone:undefined,departure:'invalid'}]},ticketCtx)
assert.equal(updatedTickets.at(-1).depart_at,null,'invalid printed clock still clears the departure')
console.log('Sparse timezone metadata preserves verified timing without hiding invalid clocks')

legacyTickets=[{...currentTicket,id:'reissued-ticket'}];legacyReminders=[]
const beforeReissue=ticketWrites.filter(write=>write.table==='travel_tickets').length
await ticketModule.persistAndRemindTicket({...correctedClock,flights:[{...correctedClock.flights[0],date:'30 Sep 2040',departure:'12:00',flightNo:'UA999'}]},ticketCtx)
assert.equal(ticketWrites.filter(write=>write.table==='travel_tickets').length,beforeReissue,'same PNR route and leg reconcile a replacement flight number')
assert.equal(updatedTickets.at(-1).flight_no,'UA999')
assert.equal(updatedTickets.at(-1).depart_at,'2040-09-30T19:00:00.000Z')
legacyTickets=[{...currentTicket,id:'ambiguous-first'},{...currentTicket,id:'ambiguous-second',flight_no:'UA998'}]
const beforeAmbiguous=updatedTickets.length
await assert.rejects(()=>ticketModule.persistAndRemindTicket({...correctedClock,flights:[{...correctedClock.flights[0],date:'30 Sep 2040',flightNo:'UA999'}]},ticketCtx),/travel_ticket_persist_failed/)

assert.equal(updatedTickets.length,beforeAmbiguous,'ambiguous reissue must not update either saved flight')

legacyTickets=[{...currentTicket,id:'separate-booking-a',pnr:'BOOKING-A',passengers:['Passenger A']}];legacyReminders=[]
const separateBookingUpdates=updatedTickets.length
await ticketModule.persistAndRemindTicket({type:'flight',passengers:['Passenger B'],flights:[{...correctedClock.flights[0],departure:currentTicket.depart_local,pnr:'BOOKING-B'}]},ticketCtx)
assert.equal(legacyTickets.length,2,'same flight route and departure with different PNRs can be independent bookings')
assert.equal(updatedTickets.length,separateBookingUpdates,'a different PNR must not silently overwrite a valid booking')
assert.equal(legacyTickets[0].pnr,'BOOKING-A')

assert.deepEqual(reminderScope({title:'Review reminders',instruction:'Show reminders that I have coming up'},'Show reminders').scopeTerms,[])
assert.deepEqual(reminderScope({title:'Review reminders',instruction:'Show dentist reminders that are upcoming'},'Show reminders').scopeTerms,['dentist'])
assert.deepEqual(reminderScope({title:'Review reminders',instruction:'Show reminders about dentist'},'Show reminders').scopeTerms,['dentist'])

assert.deepEqual(reminderScope({title:'Review reminders',instruction:'Look for reminders that I have coming up'},'Look for reminders').scopeTerms,[])
assert.deepEqual(reminderScope({title:'Review reminders',instruction:'Look for dentist reminders'},'Look for reminders').scopeTerms,['dentist'])
legacyTickets=[{...currentTicket,id:'weak-passenger-flight',pnr:null,passengers:['Earlier Passenger'],seat:'12A',raw:{...currentTicket.raw,pnr:null,seat:'12A'}}];legacyReminders=[]
await ticketModule.persistAndRemindTicket({type:'flight',passengers:['Later Passenger'],flights:[{...knownNoIds.flights[0],flightNo:currentTicket.flight_no,seat:'14B'}]},ticketCtx)
const mergedPassengers=updatedTickets.at(-1)
assert.deepEqual(JSON.parse(JSON.stringify(mergedPassengers.passengers)),['Earlier Passenger','Later Passenger'])
assert.equal(mergedPassengers.seat,null,'a seat from one passenger cannot describe the merged group')
assert.deepEqual(JSON.parse(JSON.stringify(mergedPassengers.raw.passengerDetails)),[{passengers:['Earlier Passenger'],seat:'12A'},{passengers:['Later Passenger'],seat:'14B'}])
legacyTickets=[{...mergedPassengers,id:'weak-passenger-flight'}]
await ticketModule.persistAndRemindTicket({type:'flight',passengers:['Later Passenger'],flights:[{...knownNoIds.flights[0],flightNo:currentTicket.flight_no,seat:'16C'}]},ticketCtx)
assert.deepEqual(JSON.parse(JSON.stringify(updatedTickets.at(-1).passengers)),['Earlier Passenger','Later Passenger'])
assert.deepEqual(JSON.parse(JSON.stringify(updatedTickets.at(-1).raw.passengerDetails)),[{passengers:['Earlier Passenger'],seat:'12A'},{passengers:['Later Passenger'],seat:'16C'}])

for(const prompt of ['Do I have any reminders?','Are there any reminders?','Can you please show me my reminders?','Look for reminders that I have coming up','How many reminders do I have?','Can you tell me how many reminders I have?','When are my reminders?','Where are my reminders?','Get my reminders','Search for my reminders','Please fetch my reminders','Find out if I have any reminders','Find out whether I have any reminders','Give me my reminders','Provide my reminders','Bring up my reminders']){
  const scope=reminderScope({title:'Review reminders',instruction:prompt},prompt)
  assert.deepEqual(scope.scopeTerms,[],prompt)
  assert.equal(scope.unresolved,false,prompt)
}
assert.deepEqual(reminderScope({title:'Review reminders',instruction:'Do I have any dentist reminders?'},'Do I have any dentist reminders?').scopeTerms,['dentist'])
legacyTickets=[{...updatedTickets.at(-1),id:'weak-passenger-flight'}]
await ticketModule.persistAndRemindTicket({type:'flight',passengers:['Later Passenger'],flights:[{...knownNoIds.flights[0],flightNo:currentTicket.flight_no,pnr:'ENRICHED-GROUP'}]},ticketCtx)
const enrichedGroup=updatedTickets.at(-1)
assert.deepEqual(JSON.parse(JSON.stringify(enrichedGroup.passengers)),['Earlier Passenger','Later Passenger'])
assert.deepEqual(JSON.parse(JSON.stringify(enrichedGroup.raw.passengerDetails)),[{passengers:['Earlier Passenger'],seat:'12A'},{passengers:['Later Passenger'],seat:'16C'}])
const seatFacts=buildTravelPresenceFacts([{...enrichedGroup,id:'seat-recall'}],Date.parse('2040-09-28T00:00:00Z'))
assert.ok(seatFacts.some(fact=>fact.summary.includes('Seat for Later Passenger: 16C')&&fact.summary.includes('Seat for Earlier Passenger: 12A')))
console.log('Passenger and seat recall survive booking enrichment; account-wide reminder questions remain unfiltered')

const seatBlock=renderContextBlock({query:'What seat is Later Passenger in?',generatedAt:new Date().toISOString(),memoryEnabled:true,facts:seatFacts,provenance:{lifeEvents:0,travelTickets:1,openLoops:0,semanticMemories:0,insights:0,typedContext:0}})
assert.match(seatBlock,/Seat for Later Passenger: 16C/)
const groupSeatFacts=buildTravelPresenceFacts([{...enrichedGroup,id:'group-seat',raw:{...enrichedGroup.raw,passengerDetails:[{passengers:['Earlier Passenger','Later Passenger'],seat:'12A'}]}}],Date.parse('2040-09-28T00:00:00Z'))
assert.ok(groupSeatFacts.some(fact=>fact.summary.includes('individual assignment unverified')))
legacyTickets=[{...enrichedGroup,id:'weak-passenger-flight'}]
await ticketModule.persistAndRemindTicket({type:'flight',passengers:['Later Passenger'],flights:[{...knownNoIds.flights[0],flightNo:currentTicket.flight_no,pnr:'ENRICHED-GROUP',seat:'18D'}]},ticketCtx)
assert.deepEqual(JSON.parse(JSON.stringify(updatedTickets.at(-1).passengers)),['Earlier Passenger','Later Passenger'])
assert.deepEqual(JSON.parse(JSON.stringify(updatedTickets.at(-1).raw.passengerDetails)),[{passengers:['Earlier Passenger'],seat:'12A'},{passengers:['Later Passenger'],seat:'18D'}])

assert.deepEqual(reminderScope({title:'Review reminders',instruction:'How many dentist reminders do I have?'},'How many dentist reminders do I have?').scopeTerms,['dentist'])
const largeGroup=Array.from({length:30},(_,i)=>({passengers:[`Passenger${i} Family${i}`],seat:`${i+1}A`}))
const largeSeatFacts=buildTravelPresenceFacts([{...enrichedGroup,id:'large-group',passengers:largeGroup.flatMap(x=>x.passengers),raw:{...enrichedGroup.raw,passengerDetails:largeGroup}}],Date.parse('2040-09-28T00:00:00Z'),60,'What seat is Passenger29 Family29 in?')
const relevantSeatFacts=largeSeatFacts.sort((a,b)=>lexicalScore('What seat is Passenger29 Family29 in?',b.summary)-lexicalScore('What seat is Passenger29 Family29 in?',a.summary)).slice(0,12)
const largeSeatBlock=renderContextBlock({query:'What seat is Passenger29 Family29 in?',generatedAt:new Date().toISOString(),memoryEnabled:true,facts:relevantSeatFacts,provenance:{lifeEvents:0,travelTickets:1,openLoops:0,semanticMemories:0,insights:0,typedContext:0}})
assert.match(largeSeatBlock,/Seat for Passenger29 Family29: 30A/)

const broadTravelFacts=buildTravelPresenceFacts([{...enrichedGroup,id:'large-group',passengers:largeGroup.flatMap(x=>x.passengers),raw:{...enrichedGroup.raw,passengerDetails:largeGroup}},{...enrichedGroup,id:'next-flight'}],Date.parse('2040-09-28T00:00:00Z'),60,'Show my upcoming travel')
assert.equal(broadTravelFacts.filter(f=>f.id.includes(':seat:')).length,0,'unrequested passenger facts cannot crowd out upcoming flights')
assert.ok(broadTravelFacts.some(f=>f.id==='travel-ticket:next-flight'))
assert.deepEqual(reminderScope({title:'Review reminders',instruction:'When are my dentist reminders?'},'When are my dentist reminders?').scopeTerms,['dentist'])

const familyGroup=Array.from({length:30},(_,i)=>({passengers:[`Person${i} Smith`],seat:`${i+1}A`}))
familyGroup.push({passengers:['Bo Li'],seat:'31A'})
const familyTicket={...enrichedGroup,id:'family-group',passengers:familyGroup.flatMap(x=>x.passengers),raw:{...enrichedGroup.raw,passengerDetails:familyGroup}}
const familyFacts=buildTravelPresenceFacts([familyTicket],Date.parse('2040-09-28T00:00:00Z'),60,"Show the Smith family's upcoming travel")
assert.equal(familyFacts.filter(f=>f.id.includes(':seat:')).length,0)
const shortNameFacts=buildTravelPresenceFacts([familyTicket],Date.parse('2040-09-28T00:00:00Z'),60,'What seat is Bo Li in?')
assert.ok(shortNameFacts.some(f=>f.id.includes(':seat:')&&f.summary.includes('Seat for Bo Li: 31A')))

for(const query of ['Where is Bo Li seated?','Where is Bo Li sitting?']){
 const facts=buildTravelPresenceFacts([familyTicket],Date.parse('2040-09-28T00:00:00Z'),60,query)
 assert.ok(facts.some(f=>f.id.includes(':seat:')&&f.summary.includes('Seat for Bo Li: 31A')),query)
}

assert.deepEqual(reminderScope({title:'Review reminders',instruction:'Search for my dentist reminders'},'Search for my dentist reminders').scopeTerms,['dentist'])

assert.deepEqual(reminderScope({title:'Review reminders',instruction:'Find out if I have any dentist reminders'},'Find out if I have any dentist reminders').scopeTerms,['dentist'])

assert.deepEqual(reminderScope({title:'Review reminders',instruction:'Give me my dentist reminders'},'Give me my dentist reminders').scopeTerms,['dentist'])
