import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
process.env.NEXT_PUBLIC_SUPABASE_URL='https://calendar-routing.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only'
process.env.OPENAI_API_KEY='fixture-only'
process.env.ANTHROPIC_API_KEY='fixture-only'
const {detectIntent}=await import('../lib/bot/detect-intent')
const schedule=await import('../lib/agent/read-only-schedule')
const {gateDetectedIntent}=await import('../lib/agent/semantic-gate')
const {calendarReadWindow,executeReadOnlyCalendarStep,calendarReadHoldReply,requestedCalendarTimezone}=await import('../lib/agent/calendar-read')
const reads=['Check my google calendar','Please review my Google Calendar','Show my Google calender','Read my calendar','Can you check my Google Calendar?','Check my Google Calendar. Do not change anything.']
const connections=['Connect my Google Calendar','Reconnect my calendar','Google Calendar','Is my Google Calendar connected?','Check my Google Calendar connection']
const mixed=['Check my Google Calendar and create an event tomorrow','Show my Google Calendar and send Alice the agenda','Check my Google Calendar and connect another account','Do not check my Google Calendar','Remind me to check my Google Calendar tomorrow']
const extraReads=['Read my Google Calendar and display my shopping list','Show my calendar and summarise my saved documents','Check my Google Calendar and get the weather forecast','Check my Google Calendar and summarize today news','Check my Google Calendar. Find flights to Delhi','Check my Google Calendar and what is the weather tomorrow?','Check my Google Calendar today and tell me the weather for my appointment','Check my Calendar today and get the weather for my meeting','Show my Calendar tomorrow and check if I am free and get the weather']
const heldReads=['Check my Google Calendar? Actually, do not check it.','Check my Google Calendar only after I approve','Show my Calendar today. Do not read it yet.','Show my Calendar tomorrow and check if I am free only after I approve']
const neverReads=['Never read my Google Calendar','Please never check my Calendar.']
const zonedReads=['Check my Google Calendar in UTC','Read my calendar in Asia/Kolkata','Show my calendar using Europe/London','Review my Calendar timezone is America/New_York','Read my Calendar tomorrow at 8 pm CET']
const availabilityReads=['Show my calendar tomorrow and check if I am free',"Show my Calendar tomorrow and check whether I'm available",'Show my Calendar tomorrow and tell me when am I free','Show my Calendar tomorrow and check if I am free for 30 minutes','Show my Calendar tomorrow and check if I am free for one hour and a half','Show my Calendar tomorrow and check if I am free for 45 minutes in UTC']
for(const duration of ['a quarter hour','a half hour','one-hour','an hour','two-hour','half an hour','quarter-hour','one and a half hours','an hour and a half','two and a half hours','one hour and a quarter'])availabilityReads.push(`Show my Calendar tomorrow and check if I am free for ${duration}`)
const availabilityQuestions=['check if I have any free time','tell me what is my availability','check are there any free slots','check if we have any open gaps'].map(question=>`Show my Calendar tomorrow and ${question}`)
availabilityReads.push(...availabilityQuestions)
extraReads.push('Show my Calendar tomorrow and check if I am free for 30 minutes and get the weather')
heldReads.push('Show my Calendar tomorrow and check if I am free for 30 minutes only after I approve')
const failures:string[]=[]
async function check(label:string,fn:()=>unknown){try{await fn();console.log('PASS '+label)}catch(error:any){failures.push(label+': '+error.message)}}
const rejectIO=()=>{throw Error('Unexpected model/provider/action I/O')}
const beforeFetch=globalThis.fetch
let transportCalls=0
globalThis.fetch=async()=>{transportCalls++;return rejectIO()}
const noop=new Proxy({}, {get:(_target,key)=>/^(?:record|observe|capture)/.test(String(key))?async()=>null:()=>null})
function load(file:string,deps:Record<string,unknown>){
 const source=readFileSync(file,'utf8'),exports:any={}
 runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:(id:string)=>deps[id]||noop,process:{env:{}},console:{log(){},error(){}},URL,URLSearchParams,Request,Response,Buffer,AbortSignal,setTimeout,clearTimeout})
 return exports
}
const actor={userId:'fixture',legacyTelegramId:123,whatsappId:'fixture-owner',name:'Example'}
let calendarReads=0,connectionCalls=0,semanticCalls=0,failRead=false,pm:any,dash:any
const readCalendar=async(params:any)=>{
 assert.equal(params.actor.legacyTelegramId,123)
 assert.equal(params.actor.userId,'fixture')
 assert.equal(params.instruction,params.missionText)
 assert.equal(params.rememberSelection,undefined,'a read cannot arm later object mutations')
 calendarReads++;if(failRead)throw Error('fixture_provider_down')
 return {text:'Calendar read for next 7 days: Example event',complete:true,events:[]}
}
try{
 await check('explicit reads are never calendar connection intents',()=>{
  for(const text of reads)assert.equal(detectIntent(text).type,'read_calendar',text)
 })
 await check('date-free calendar reads reach the bounded read-only schedule path',()=>{
  for(const text of reads)assert.equal(schedule.detectReadOnlyScheduleRequest(text)?.scope,'calendar',text)
  const window=calendarReadWindow(reads[0],new Date('2026-10-18T12:00:00Z'),'Asia/Kolkata')
  assert.equal(window.startDate,'2026-10-18');assert.equal(window.endDate,'2026-10-24')
 })
 await check('connection requests keep their existing intent and never become schedule reads',()=>{
  for(const text of connections){assert.equal(detectIntent(text).type,'connect_calendar',text);assert.equal(schedule.detectReadOnlyScheduleRequest(text),null,text)}
 })
 await check('read verbs and calendar spellings preserve their explicit day and scope',()=>{
  for(const text of ['Read my Google Calendar today','Display my Google calender tomorrow'])assert.equal(schedule.detectReadOnlyScheduleRequest(text)?.scope,'calendar',text)
  assert.notEqual(detectIntent('Show my Google Calendar and reminders').type,'read_calendar','a calendar-only handler cannot discard the requested reminders')
  assert.throws(()=>calendarReadWindow('Read my Google Calendar on 25 October',new Date('2026-10-18T12:00:00Z'),'Asia/Kolkata'),/calendar_date_unsupported/)
 })
 await check('mixed actions and negated reads cannot become standalone calendar reads',()=>{
  for(const text of mixed){assert.notEqual(detectIntent(text).type,'read_calendar',text);assert.equal(schedule.detectReadOnlyScheduleRequest(text),null,text)}
 })
 await check('additional read sentences and question clauses are not silently reduced to Calendar',()=>{
  for(const text of extraReads){assert.equal(detectIntent(text).type,'calendar_read_clarify',text);assert.equal(schedule.detectReadOnlyScheduleRequest(text)?.horizon,'clarify',text)}
 })
 await check('explicitly deferred and revoked reads have a hold result instead of a read',()=>{
  for(const text of heldReads){assert.equal(detectIntent(text).type,'calendar_read_held',text);assert.equal(schedule.detectReadOnlyScheduleRequest(text)?.horizon,'held',text)}
 })
 await check('never-read prohibitions hold while corrections and never-forget requests remain readable',()=>{
  for(const text of neverReads){assert.ok(calendarReadHoldReply(text),text);assert.equal(detectIntent(text).type,'calendar_read_held',text)}
  const correction='Never read today, but show my Calendar tomorrow'
  assert.equal(calendarReadHoldReply(correction),null)
  assert.equal(detectIntent(correction).type,'read_calendar')
  assert.equal(calendarReadWindow(correction,new Date('2026-10-18T12:00:00Z'),'Asia/Kolkata').startDate,'2026-10-19')
  assert.equal(detectIntent('Never forget to read my Calendar').type,'read_calendar')
 })
 await check('valid explicit timezone qualifiers reach the Calendar reader',()=>{
  for(const text of zonedReads){assert.equal(detectIntent(text).type,'read_calendar',text);assert.equal(schedule.detectReadOnlyScheduleRequest(text)?.scope,'calendar',text);assert.ok(requestedCalendarTimezone(text),text)}
 })
 await check('independent appointment discovery retains its existing planner flow',()=>{
  const text='Show my calendar today and find a dentist appointment'
  assert.equal(schedule.detectReadOnlyScheduleRequest(text),null)
  assert.notEqual(detectIntent(text).type,'calendar_read_clarify')
  assert.notEqual(detectIntent(text).type,'read_calendar')
 })
 await check('native availability questions remain a single bounded Calendar read',()=>{
  for(const text of availabilityReads){assert.equal(detectIntent(text).type,'read_calendar',text);assert.equal(schedule.detectReadOnlyScheduleRequest(text)?.scope,'calendar',text);assert.equal(schedule.detectReadOnlyScheduleRequest(text)?.horizon,'tomorrow',text)}
 })
 await check('all supported native availability question shapes remain Calendar reads',()=>{
  for(const text of availabilityQuestions){assert.equal(detectIntent(text).type,'read_calendar',text);assert.equal(schedule.detectReadOnlyScheduleRequest(text)?.scope,'calendar',text)}
 })
 await check('actual shared message entry reads without minting a connection link',async()=>{
  const q:any={insert:()=>({error:null}),select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null,error:null})}
  pm=load('lib/bot/process-message.ts',{
   './resolve-user':{resolveUser:async()=>({id:'fixture',telegramId:123,whatsappId:'fixture-owner',name:'Example'})},
   './detect-intent':{detectIntent},'@/lib/agent/semantic-gate':{gateDetectedIntent:(intent:any,text:string,semantic:any)=>{semanticCalls++;return gateDetectedIntent(intent,text,semantic)}},
   './format-response':{formatOutgoingText:(_channel:string,text:string)=>text},
   '@/lib/supabase-admin':{supabaseAdmin:{from:(table:string)=>{assert.equal(table,'conversations');return q}}},
   '@/lib/limits':{checkAndIncrementLimit:async()=>({allowed:true})},
   '@/lib/agent/calendar-read':{executeReadOnlyCalendarStep:readCalendar},
   './handlers/calendar-actions':{isCalendarAction:()=>false,getCalendarTokens:async()=>{connectionCalls++;return{connected:false}},buildCalendarActionReply:rejectIO},
   '@/lib/google-calendar':{getAuthUrl:()=>{connectionCalls++;return 'https://fixture.invalid/auth'},buildCalendarConnectUrl:()=>{connectionCalls++;return 'https://fixture.invalid/auth'}},
   './handlers/deterministic':{buildDeterministicWeatherReply:async()=> 'Synthetic weather only'},
   './handlers/response-style':{styleReplyByIntent:(_intent:string,text:string)=>text},
  })
  const result=await pm.processIncomingMessage({channel:'whatsapp',externalUserId:'fixture-owner',text:reads[0],messageType:'text'})
  assert.match(result.text,/Calendar read for next 7 days/)
  assert.equal(calendarReads,1);assert.equal(connectionCalls,0)
 })
 await check('shared entry preserves provider failure as uncertainty without a connection flow',async()=>{
  const previousConnections=connectionCalls;failRead=true
  try{
   const result=await pm.processIncomingMessage({channel:'whatsapp',externalUserId:'fixture-owner',text:reads[0],messageType:'text'})
   assert.match(result.text,/couldn.t verify|unavailable|could not read/i)
   assert.doesNotMatch(result.text,/calendar is clear|no events|https:\/\/fixture.invalid\/auth/i)
   assert.equal(connectionCalls,previousConnections)
  }finally{failRead=false}
 })
 await check('actual shared entry delegates native availability questions to the Calendar reader',async()=>{
  for(const text of availabilityReads){const before=calendarReads,connectionsBefore=connectionCalls;const result=await pm.processIncomingMessage({channel:'whatsapp',externalUserId:'fixture-owner',text,messageType:'text'});assert.match(result.text,/Calendar read/);assert.equal(calendarReads,before+1);assert.equal(connectionCalls,connectionsBefore)}
 })
 await check('actual shared entry honors read holds without Calendar or connection calls',async()=>{
  for(const text of heldReads){const before=calendarReads,connectionsBefore=connectionCalls;const result=await pm.processIncomingMessage({channel:'whatsapp',externalUserId:'fixture-owner',text,messageType:'text'});assert.match(result.text,/haven.t read|not read|on hold/i);assert.equal(calendarReads,before);assert.equal(connectionCalls,connectionsBefore)}
 })
 await check('actual shared entry honors never-read prohibitions without Calendar or connection calls',async()=>{
  for(const text of neverReads){const before=calendarReads,connectionsBefore=connectionCalls;const result=await pm.processIncomingMessage({channel:'whatsapp',externalUserId:'fixture-owner',text,messageType:'text'});assert.match(result.text,/haven.t read|not read|on hold/i);assert.equal(calendarReads,before);assert.equal(connectionCalls,connectionsBefore)}
 })
 await check('mixed Calendar and weather reads explicitly clarify both topics before any provider call',async()=>{
  for(const text of extraReads.filter(text=>/weather/.test(text))){const before=calendarReads,connectionsBefore=connectionCalls;const result=await pm.processIncomingMessage({channel:'whatsapp',externalUserId:'fixture-owner',text,messageType:'text'});assert.match(result.text,/Calendar/i);assert.match(result.text,/separat|both|another task/i);assert.notEqual(result.text,'Synthetic weather only');assert.equal(calendarReads,before);assert.equal(connectionCalls,connectionsBefore)}
 })
 await check('a conflicting semantic classifier cannot override a read hold or compound clarification',async()=>{
  const semantic={ok:true,intent:{choice:'live_info',confidence:.99}} as any
  for(const text of [...heldReads,...neverReads,...extraReads]){const before=calendarReads,connectionsBefore=connectionCalls,semanticBefore=semanticCalls;const result=await pm.processIncomingMessage({channel:'whatsapp',externalUserId:'fixture-owner',text,messageType:'text',semantic});assert.match(result.text,/haven.t read|not read|on hold/i);assert.equal(calendarReads,before);assert.equal(connectionCalls,connectionsBefore);assert.equal(semanticCalls,semanticBefore)}
 })
 await check('actual Calendar reader refuses a held instruction before owner/provider transport',async()=>{
  for(const text of [...heldReads,...neverReads]){const before=transportCalls;const result=await executeReadOnlyCalendarStep({actor,instruction:text,missionText:text});assert.match(result.text,/haven.t read|not read|on hold/i);assert.equal(transportCalls,before)}
 })
 await check('actual dashboard entry delegates a date-free calendar read before generic planning',async()=>{
  const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{telegram_id:123,whatsapp_id:'fixture-owner',name:'Example'},error:null}),insert:()=>({error:null})}
  let calls=0
  dash=load('app/api/dashboard/chat/route.ts',{
   'crypto':{randomUUID:()=> 'fixture-calendar-turn'},'next/server':{NextResponse:{json:(body:any,options:any={})=>new Response(JSON.stringify(body),{status:options.status||200})}},
   '@/lib/dashboard/session':{getSession:async()=>({telegramId:'123'})},'@/lib/supabase-admin':{supabaseAdmin:{from:(table:string)=>{assert(['users','conversations'].includes(table));return q}}},
   '@/lib/agent/actor':{resolveAgentActor:async()=>actor},
   '@/lib/agent/read-only-schedule':{detectReadOnlyScheduleRequest:schedule.detectReadOnlyScheduleRequest,readTomorrowSchedule:async(params:any)=>{assert.equal(params.actor.legacyTelegramId,123);assert.equal(params.scope,'calendar');if(heldReads.includes(params.text)||extraReads.includes(params.text))return schedule.readTomorrowSchedule(params);assert.equal(params.text,reads[0]);calls++;return{text:'Calendar read for next 7 days: Example event',calendarReadVerified:true}}},
   '@/lib/bot/handlers/friend-reminders':{detectFriendReminder:()=>null,isFriendReminderFollowupCandidate:()=>false},
   '@/lib/agent/recall-query':{isDecisionRecallQuery:()=>false},'@/lib/services/link-vault':{isLinkVaultSaveRequest:()=>false,isLinkVaultQuery:()=>false},
   '@/lib/dashboard/day-chat':{detectDashboardDayIntent:rejectIO},'@/lib/bot/process-message':{processIncomingMessage:rejectIO},
  })
  const request=new Request('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid','content-type':'application/json'},body:JSON.stringify({text:reads[0]})})
  const response=await dash.POST(Object.assign(request,{nextUrl:new URL(request.url)})),body=await response.json()
  assert.equal(response.status,200);assert.equal(body.handledBy,'read-only-schedule');assert.equal(calls,1)
 })
 await check('actual dashboard entry honors held reads without Calendar provider transport',async()=>{
  for(const text of heldReads){const before=transportCalls;const request=new Request('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid','content-type':'application/json'},body:JSON.stringify({text})});const response=await dash.POST(Object.assign(request,{nextUrl:new URL(request.url)})),body=await response.json();assert.equal(response.status,200);assert.match(body.text,/haven.t read|not read|on hold/i);assert.equal(transportCalls,before)}
 })
 await check('actual dashboard entry clarifies compound reads before any provider transport',async()=>{
  for(const text of extraReads){const before=transportCalls;const request=new Request('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid','content-type':'application/json'},body:JSON.stringify({text})});const response=await dash.POST(Object.assign(request,{nextUrl:new URL(request.url)})),body=await response.json();assert.equal(response.status,200);assert.match(body.text,/Calendar read and another task/);assert.equal(transportCalls,before)}
 })
}finally{globalThis.fetch=beforeFetch}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}else console.log('Calendar read/connection routing and actual read-only entries passed; inert operations only.')
