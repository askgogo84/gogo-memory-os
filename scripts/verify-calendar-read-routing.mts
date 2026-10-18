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
const {calendarReadWindow}=await import('../lib/agent/calendar-read')
const reads=['Check my google calendar','Please review my Google Calendar','Show my Google calender','Read my calendar','Can you check my Google Calendar?','Check my Google Calendar. Do not change anything.']
const connections=['Connect my Google Calendar','Reconnect my calendar','Google Calendar','Is my Google Calendar connected?','Check my Google Calendar connection']
const mixed=['Check my Google Calendar and create an event tomorrow','Show my Google Calendar and send Alice the agenda','Check my Google Calendar and connect another account','Do not check my Google Calendar','Remind me to check my Google Calendar tomorrow']
const failures:string[]=[]
async function check(label:string,fn:()=>unknown){try{await fn();console.log('PASS '+label)}catch(error:any){failures.push(label+': '+error.message)}}
const rejectIO=()=>{throw Error('Unexpected model/provider/action I/O')}
const beforeFetch=globalThis.fetch
globalThis.fetch=async()=>rejectIO()
const noop=new Proxy({}, {get:()=>()=>null})
function load(file:string,deps:Record<string,unknown>){
 const source=readFileSync(file,'utf8'),exports:any={}
 runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:(id:string)=>deps[id]||noop,process:{env:{}},console:{log(){},error(){}},URL,URLSearchParams,Request,Response,Buffer,AbortSignal,setTimeout,clearTimeout})
 return exports
}
const actor={userId:'fixture',legacyTelegramId:123,whatsappId:'fixture-owner',name:'Example'}
let calendarReads=0,connectionCalls=0
const readCalendar=async(params:any)=>{
 assert.equal(params.actor.legacyTelegramId,123)
 assert.equal(params.actor.userId,'fixture')
 assert.equal(params.instruction,params.missionText)
 assert.equal(params.rememberSelection,undefined,'a read cannot arm later object mutations')
 calendarReads++;return {text:'Calendar read for next 7 days: Example event',complete:true,events:[]}
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
 await check('mixed actions and negated reads cannot become standalone calendar reads',()=>{
  for(const text of mixed){assert.notEqual(detectIntent(text).type,'read_calendar',text);assert.equal(schedule.detectReadOnlyScheduleRequest(text),null,text)}
 })
 await check('actual shared message entry reads without minting a connection link',async()=>{
  const q:any={insert:()=>({error:null}),select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null,error:null})}
  const pm=load('lib/bot/process-message.ts',{
   './resolve-user':{resolveUser:async()=>({id:'fixture',telegramId:123,whatsappId:'fixture-owner',name:'Example'})},
   './detect-intent':{detectIntent},'@/lib/agent/semantic-gate':{gateDetectedIntent:(intent:any)=>intent},
   './format-response':{formatOutgoingText:(_channel:string,text:string)=>text},
   '@/lib/supabase-admin':{supabaseAdmin:{from:(table:string)=>{assert.equal(table,'conversations');return q}}},
   '@/lib/limits':{checkAndIncrementLimit:async()=>({allowed:true})},
   '@/lib/agent/calendar-read':{executeReadOnlyCalendarStep:readCalendar},
   './handlers/calendar-actions':{isCalendarAction:()=>false,getCalendarTokens:async()=>{connectionCalls++;return{connected:false}},buildCalendarActionReply:rejectIO},
   '@/lib/google-calendar':{getAuthUrl:()=>{connectionCalls++;return 'https://fixture.invalid/auth'},buildCalendarConnectUrl:()=>{connectionCalls++;return 'https://fixture.invalid/auth'}},
  })
  const result=await pm.processIncomingMessage({channel:'whatsapp',externalUserId:'fixture-owner',text:reads[0],messageType:'text'})
  assert.match(result.text,/Calendar read for next 7 days/)
  assert.equal(calendarReads,1);assert.equal(connectionCalls,0)
 })
 await check('actual dashboard entry delegates a date-free calendar read before generic planning',async()=>{
  const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{telegram_id:123,whatsapp_id:'fixture-owner',name:'Example'},error:null}),insert:()=>({error:null})}
  let calls=0
  const dash=load('app/api/dashboard/chat/route.ts',{
   'crypto':{randomUUID:()=> 'fixture-calendar-turn'},'next/server':{NextResponse:{json:(body:any,options:any={})=>new Response(JSON.stringify(body),{status:options.status||200})}},
   '@/lib/dashboard/session':{getSession:async()=>({telegramId:'123'})},'@/lib/supabase-admin':{supabaseAdmin:{from:(table:string)=>{assert(['users','conversations'].includes(table));return q}}},
   '@/lib/agent/actor':{resolveAgentActor:async()=>actor},
   '@/lib/agent/read-only-schedule':{detectReadOnlyScheduleRequest:schedule.detectReadOnlyScheduleRequest,readTomorrowSchedule:async(params:any)=>{assert.equal(params.actor.legacyTelegramId,123);assert.equal(params.scope,'calendar');assert.equal(params.text,reads[0]);calls++;return{text:'Calendar read for next 7 days: Example event',calendarReadVerified:true}}},
   '@/lib/bot/handlers/friend-reminders':{detectFriendReminder:()=>null,isFriendReminderFollowupCandidate:()=>false},
   '@/lib/agent/recall-query':{isDecisionRecallQuery:()=>false},'@/lib/services/link-vault':{isLinkVaultSaveRequest:()=>false,isLinkVaultQuery:()=>false},
   '@/lib/dashboard/day-chat':{detectDashboardDayIntent:rejectIO},'@/lib/bot/process-message':{processIncomingMessage:rejectIO},
  })
  const request=new Request('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid','content-type':'application/json'},body:JSON.stringify({text:reads[0]})})
  const response=await dash.POST(Object.assign(request,{nextUrl:new URL(request.url)})),body=await response.json()
  assert.equal(response.status,200);assert.equal(body.handledBy,'read-only-schedule');assert.equal(calls,1)
 })
}finally{globalThis.fetch=beforeFetch}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}else console.log('Calendar read/connection routing and actual read-only entries passed; inert operations only.')
