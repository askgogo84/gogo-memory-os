import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detectReadOnlyScheduleRequest, readTomorrowSchedule, nextLocalDateKey } from '../lib/agent/read-only-schedule'
import { supabaseAdmin } from '../lib/supabase-admin'
import {calendarReadWindow,executeReadOnlyCalendarStep} from '../lib/agent/calendar-read'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {NextRequest,NextResponse} from 'next/server'

for(const text of ['What do I have on my calendar tomorrow?','Show my calendar tomorrow','What meetings do I have tomorrow?'])assert.equal(detectReadOnlyScheduleRequest(text)?.scope,'calendar',text)
for(const text of ['Check what I have tomorrow and tell me what needs my attention. Do not change anything.','What do I have tomorrow?','What is my day tomorrow?','Plan my day tomorrow','Show my calendar and reminders tomorrow',"Tell me what's on tomorrow. Don't change my calendar."])assert.equal(detectReadOnlyScheduleRequest(text)?.scope,'agenda',text)
for(const text of ['Remind me to check my calendar tomorrow','Create a calendar event tomorrow','Move my meeting tomorrow','Check the weather tomorrow','Tell me the flight prices tomorrow','Show my reminders tomorrow','Check sunrise tomorrow','Review the news tomorrow'])assert.equal(detectReadOnlyScheduleRequest(text),null,text)
for(const text of ['Review my calendar today and create an event tomorrow','Show my calendar tomorrow; delete the 11am event','Show my calendar tomorrow and edit the 11am event','Review tomorrow. Do not delete anything, but create a meeting.'])assert.equal(detectReadOnlyScheduleRequest(text),null,'positive writes must not be swallowed: '+text)
assert.equal(detectReadOnlyScheduleRequest('List my meetings today')?.horizon,'today')
assert.equal(detectReadOnlyScheduleRequest('Show my calendar today and tomorrow')?.horizon,'today-tomorrow')
assert.equal(detectReadOnlyScheduleRequest('What do I have today?'),null,'preserve Today/day route')
const midnight=calendarReadWindow('today and tomorrow',new Date('2026-10-07T18:45:00Z'),'Asia/Kolkata')
assert.deepEqual(midnight,{startDate:'2026-10-08',endDate:'2026-10-09',label:'today and tomorrow'})
assert.equal(calendarReadWindow('today',new Date('2026-10-07T18:15:00Z'),'Asia/Kolkata').endDate,'2026-10-07')

async function main(){
 const original=supabaseAdmin.from,originalFetch=globalThis.fetch
 const tables:string[]=[],http:string[]=[];let failCalendar=false,empty=false,rangeFixture=false
 let providerItems:any[]|undefined,partial=false
 const tomorrow=nextLocalDateKey(new Date(),'Asia/Kolkata')
 const today=calendarReadWindow('',new Date(),'Asia/Kolkata').startDate
 const exactRequest='Review my connected calendar for today and tomorrow in Asia/Kolkata. List meetings with their start and end times and flag overlapping events. Read only; do not create, edit or delete events, send emails or create reminders.'
 ;(supabaseAdmin as any).from=(table:string)=>{
  tables.push(table)
  if(table==='conversations')return {insert:async(rows:any[])=>{assert.ok(rows.every(row=>row.telegram_id===123),'history remains owned');return {error:null}}} as any
  assert.ok(['users','reminders'].includes(table),'no Attention or watcher reads')
  const result={error:null,data:table==='users'?{telegram_id:123,whatsapp_id:'+15555550123',timezone:'Asia/Kolkata',google_calendar_connected:true,google_refresh_token:'fixture-refresh'}:[{message:'Travel reminder fixture',remind_at:tomorrow+'T09:00:00+05:30',sent:false}]}
  let wrongOwner=false
  const owned=()=>wrongOwner?{error:null,data:null}:result
  const q:any={then:(r:any)=>Promise.resolve(owned()).then(r),maybeSingle:async()=>owned()}
  for(const method of ['select','eq','gte','lt','order'])q[method]=()=>q
  q.eq=(key:string,value:any)=>{if(key==='telegram_id'&&value!==123)wrongOwner=true;return q}
  return q // No insert/update/delete method: any mutation fails the test.
 }
 globalThis.fetch=(async(url:any,opts:any)=>{
  const u=String(url);http.push(u)
  if(u==='https://oauth2.googleapis.com/token')return new Response(JSON.stringify({access_token:'fixture-access'}))
  assert.match(u,/googleapis.com\/calendar\/v3\/calendars\/primary\/events\?/)
  assert.ok(!opts.method||opts.method==='GET','calendar read never creates an event')
  const fixtureEvents=[{id:'today-a',summary:'Today meeting A',start:{dateTime:today+'T09:00:00+05:30'},end:{dateTime:today+'T10:00:00+05:30'}},
    {id:'today-b',summary:'Today meeting B',start:{dateTime:today+'T09:30:00+05:30'},end:{dateTime:today+'T10:30:00+05:30'}},
    {id:'today-adjacent',summary:'Adjacent meeting',start:{dateTime:today+'T10:30:00+05:30'},end:{dateTime:today+'T11:00:00+05:30'}},
    {id:'fixture-event',summary:'Calendar event fixture',start:{dateTime:tomorrow+'T11:00:00+05:30'},end:{dateTime:tomorrow+'T12:00:00+05:30'}}]
  const requested=new URL(u)
  const min=new Date(requested.searchParams.get('timeMin')!).getTime(),max=new Date(requested.searchParams.get('timeMax')!).getTime()
  const events=rangeFixture?fixtureEvents.filter(event=>new Date(event.start.dateTime).getTime()<max&&new Date(event.end.dateTime).getTime()>min):fixtureEvents.slice(-1)
  return new Response(JSON.stringify({items:empty?[]:providerItems||events,...(partial?{nextPageToken:'opaque-fixture-page'}:{})}),{status:failCalendar?503:200})
 }) as typeof fetch
 try{
  const actor={legacyTelegramId:123} as any
  const calendar=await readTomorrowSchedule({actor,scope:'calendar'})
  assert.match(calendar.text,/Calendar event fixture/)
  assert.doesNotMatch(calendar.text,/reminder|attention|watcher/i)
  assert.equal(calendar.calendarReadVerified,true);assert.ok(!tables.includes('reminders'))
  // Execute the real exported POST, parser, schedule wrapper, canonical reader
  // and HTTP calendar service in their production order. A tomorrow-only claim
  // or generic planner fallthrough must fail, rather than pass a matcher test.
  const source=readFileSync('app/api/dashboard/chat/route.ts','utf8')
  const nullModule=new Proxy({}, {get:()=>async()=>null})
  const mocks:any=Object.fromEntries([...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(m=>[m[1],nullModule]))
  Object.assign(mocks,{'next/server':{NextRequest,NextResponse},'crypto':{randomUUID:()=> 'fixture-calendar-turn'},
    '@/lib/dashboard/session':{getSession:async()=>({telegramId:'123'})},'@/lib/supabase-admin':{supabaseAdmin},
    '@/lib/agent/actor':{resolveAgentActor:async()=>actor},
    '@/lib/agent/read-only-schedule':{detectReadOnlyScheduleRequest,readTomorrowSchedule},
    '@/lib/bot/memory-redaction':{redactSecretShapedText:(s:string)=>s},
    '@/lib/bot/handlers/friend-reminders':{detectFriendReminder:()=>null,isFriendReminderFollowupCandidate:()=>false},
    '@/lib/commerce/comparison-model':{namesRetailerPriceRead:()=>false},
    '@/lib/dashboard/day-chat':{detectDashboardDayIntent:()=>{throw Error('Calendar range fell through upstream routing')}},
    '@/lib/bot/process-message':{processIncomingMessage:()=>{throw Error('Calendar range reached generic PIM')}}})
  const exported:any={}
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports:exported,console,URL,process:{env:{}},require:(name:string)=>mocks[name]})
  rangeFixture=true;tables.length=0;http.length=0
  const response=await exported.POST(new NextRequest('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid'},body:JSON.stringify({text:exactRequest})}))
  assert.equal(response.status,200)
  const range=await response.json()
  assert.equal(range.handledBy,'read-only-schedule')
  const readUrl=new URL(http.find(url=>url.includes('/calendar/v3/'))!)
  assert.equal(readUrl.searchParams.get('timeMin'),new Date(today+'T00:00:00+05:30').toISOString(),'actual route preserves today, not only tomorrow')
  const afterTomorrow=new Date(tomorrow+'T00:00:00Z');afterTomorrow.setUTCDate(afterTomorrow.getUTCDate()+1)
  assert.equal(readUrl.searchParams.get('timeMax'),new Date(afterTomorrow.toISOString().slice(0,10)+'T00:00:00+05:30').toISOString(),'range ends at the exclusive next local midnight')
  assert.match(range.text,/Today meeting A/);assert.match(range.text,/Calendar event fixture/)
  assert.match(range.text,/9:00\s*AM.*10:00\s*AM/i,'show both local start and end')
  assert.match(range.text,/overlap.*Today meeting A.*Today meeting B/i)
  const combined=await readTomorrowSchedule({actor,scope:'agenda',text:'Show my calendar and reminders today and tomorrow and flag overlapping events.'})
  assert.match(combined.text,/Overlap: Today meeting A.*Today meeting B/)
  assert.match(combined.text,/Travel reminder fixture/)
  tables.length=0
  assert.doesNotMatch(range.text,/overlap[^\n]*Adjacent meeting/i,'touching intervals do not overlap')
  assert.equal(range.mutated,false);assert.ok(!tables.includes('reminders'))
  const direct=(instruction=exactRequest)=>executeReadOnlyCalendarStep({actor,instruction,missionText:instruction})
  providerItems=[{id:'all-day',summary:'All-day event',start:{date:today},end:{date:tomorrow}},
    {id:'tomorrow-timed',summary:'Tomorrow after exclusive end',start:{dateTime:tomorrow+'T09:00:00+05:30'},end:{dateTime:tomorrow+'T10:00:00+05:30'}}]
  const allDay=await direct()
  assert.match(allDay.text,/All day.*exclusive/);assert.ok('conflicts' in allDay.output);assert.deepEqual(allDay.output.conflicts,[],'all-day exclusive end does not overlap tomorrow')
  providerItems=[{id:'missing-end',summary:'Missing end',start:{dateTime:today+'T11:00:00+05:30'}},
    {id:'reversed',summary:'Reversed interval',start:{dateTime:today+'T12:00:00+05:30'},end:{dateTime:today+'T11:00:00+05:30'}}]
  const invalid=await direct()
  assert.ok('unknownIntervals' in invalid.output);assert.equal(invalid.output.unknownIntervals,2);assert.match(invalid.text,/end time not verified/)
  assert.match(invalid.text,/Overlap review is incomplete/);assert.doesNotMatch(invalid.text,/No overlapping/)
  assert.equal((await readTomorrowSchedule({actor,scope:'calendar',text:exactRequest})).calendarReadVerified,false,'learning cannot mark an incomplete overlap review verified')
  assert.deepEqual((await direct('Find free slots tomorrow')).output.availableSlots,[],'unknown intervals cannot establish availability')
  providerItems=[];partial=true
  const partialCalendar=await readTomorrowSchedule({actor,scope:'calendar',text:exactRequest})
  assert.equal(partialCalendar.calendarReadVerified,false);assert.match(partialCalendar.text,/Partial calendar page/)
  assert.doesNotMatch(partialCalendar.text,/No calendar events|No overlapping/,'an empty page with a next token is not an empty calendar')
  const partialSlots=await direct('Find free slots tomorrow')
  assert.deepEqual(partialSlots.output.availableSlots,[]);assert.equal(partialSlots.output.availabilityVerified,false)
  partial=false
  providerItems=Array.from({length:15},(_,i)=>({id:`bounded-${i}`,summary:`Meeting ${i}`,start:{dateTime:today+`T${String(8+i).padStart(2,'0')}:00:00+05:30`},end:{dateTime:today+`T${String(8+i).padStart(2,'0')}:30:00+05:30`}}))
  const bounded=await direct();assert.match(bounded.text,/Showing 12 of 15/);assert.ok('events' in bounded.output);assert.equal(bounded.output.events.length,12)
  providerItems=Array.from({length:41},(_,i)=>({...providerItems![0],id:`overflow-${i}`}))
  assert.equal((await direct()).output.complete,false,'over-limit provider responses retain incompleteness')
  providerItems=undefined;http.length=0
  await assert.rejects(()=>executeReadOnlyCalendarStep({actor:{...actor,legacyTelegramId:999},instruction:exactRequest,missionText:exactRequest}),/calendar_not_connected/)
  assert.equal(http.length,0,'wrong owner never reaches the calendar provider')
  const explicitZone=await direct('Show my calendar today in America/New_York')
  assert.equal(explicitZone.output.timezone,'America/New_York')
  assert.equal(explicitZone.output.window.startDate,new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))
  await assert.rejects(()=>direct('Show my calendar today in Asia/FakeZone'),/calendar_timezone_invalid/)
  rangeFixture=false
  const agenda=await readTomorrowSchedule({actor,scope:'agenda'})
  assert.match(agenda.text,/Calendar event fixture/);assert.match(agenda.text,/Travel reminder fixture/)
  tables.length=0;empty=true
  assert.match((await readTomorrowSchedule({actor,scope:'calendar'})).text,/No calendar events found/)
  failCalendar=true
  const failed=await readTomorrowSchedule({actor,scope:'calendar'})
  assert.match(failed.text,/could not read/);assert.equal(failed.calendarReadVerified,false)
  assert.doesNotMatch(failed.text,/clear|No calendar events|Travel reminder/)
  assert.ok(!tables.includes('reminders'))
 }finally{supabaseAdmin.from=original;globalThis.fetch=originalFetch}
 for(const path of ['app/api/dashboard/chat/route.ts','app/api/agent/run/route.ts','app/api/webhooks/whatsapp/route.ts']){
  const source=readFileSync(path,'utf8')
  assert.match(source,/readTomorrowSchedule\(\{ actor, scope:/,path)
  assert.match(source,/readTomorrowSchedule\(\{ actor, scope: [^}]+, text \}/,path+' retains original request')
  assert.match(source,/await recordDecisionLearning\(\{ actor, text,/,'production reads keep learning automatically: '+path)
  assert.match(source,/verified:\s*summary.calendarReadVerified/,'provider verification controls evidence: '+path)
 }
 console.log('Calendar presentation: real provider reader, calendar-only/combined scopes, no reminder writes, empty and failed reads passed')
}
main().catch(e=>{console.error(e);process.exitCode=1})
