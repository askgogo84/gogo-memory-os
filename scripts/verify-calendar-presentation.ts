import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detectReadOnlyScheduleRequest, readTomorrowSchedule, nextLocalDateKey } from '../lib/agent/read-only-schedule'
import { supabaseAdmin } from '../lib/supabase-admin'
import {calendarReadWindow,executeReadOnlyCalendarStep,calendarAffirmativeText} from '../lib/agent/calendar-read'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {NextRequest,NextResponse} from 'next/server'
import {parseLocalDateTime} from '../lib/timezone'
import {rememberTypedObjects,selectedTypedObject} from '../lib/agent/typed-object-context'

for(const text of ['What do I have on my calendar tomorrow?','Show my calendar tomorrow','What meetings do I have tomorrow?'])assert.equal(detectReadOnlyScheduleRequest(text)?.scope,'calendar',text)
for(const text of ['Check what I have tomorrow and tell me what needs my attention. Do not change anything.','What do I have tomorrow?','What is my day tomorrow?','Plan my day tomorrow','Show my calendar and reminders tomorrow',"Tell me what's on tomorrow. Don't change my calendar."])assert.equal(detectReadOnlyScheduleRequest(text)?.scope,'agenda',text)
for(const text of ['Remind me to check my calendar tomorrow','Create a calendar event tomorrow','Move my meeting tomorrow','Check the weather tomorrow','Tell me the flight prices tomorrow','Show my reminders tomorrow','Check sunrise tomorrow','Review the news tomorrow'])assert.equal(detectReadOnlyScheduleRequest(text),null,text)
for(const text of ['Review my calendar today and create an event tomorrow','Show my calendar tomorrow; delete the 11am event','Show my calendar tomorrow and edit the 11am event','Review tomorrow. Do not delete anything, but create a meeting.'])assert.equal(detectReadOnlyScheduleRequest(text),null,'positive writes must not be swallowed: '+text)
for(const idiom of ["don't forget to",'do not forget to',"don’t forget to"])
 assert.equal(detectReadOnlyScheduleRequest(`Show my calendar today and ${idiom} schedule the dentist Friday`),null,'affirmative negative idioms retain the action')
for(const day of ['today','tomorrow','today or tomorrow'])
 assert.equal(detectReadOnlyScheduleRequest(`Don't show my calendar ${day}`),null,'fully negated reads must not route: '+day)
assert.equal(detectReadOnlyScheduleRequest("Don't show my calendar today, but show my calendar tomorrow")?.horizon,'tomorrow')
assert.equal(calendarReadWindow("Don't show my calendar today, but show my calendar tomorrow",new Date('2026-10-08T04:00:00Z'),'Asia/Kolkata').startDate,'2026-10-09')
assert.equal(detectReadOnlyScheduleRequest('Show my calendar tomorrow and reserve a table at Noma for 2'),null,'reservation commands retain their own executor')
assert.equal(detectReadOnlyScheduleRequest('Show my calendar tomorrow and schedule dentist appointment Friday'),null,'named schedule commands retain their creation flow')
assert.equal(detectReadOnlyScheduleRequest('Show my calendar tomorrow. Do not create, edit, and delete events.')?.scope,'calendar','coordinated prohibitions remain read-only')
assert.equal(detectReadOnlyScheduleRequest('Show my calendar tomorrow. Do not create a placeholder, and schedule the client meeting Friday.'),null,'an affirmative command following the negative clause retains its flow')
assert.equal(detectReadOnlyScheduleRequest('Show my calendar today and find a dentist appointment'),null,'independent appointment discovery must not be swallowed')
assert.equal(detectReadOnlyScheduleRequest('Find a dentist appointment and show my calendar today'),null,'the reverse compound order retains discovery too')
for(const command of ["reply to Alice's email saying yes",'respond to the email','email Alice the agenda','draft a reply','call the provider','submit the form','checkout the cart','subscribe to the newsletter','share the report','follow the account'])
 assert.equal(detectReadOnlyScheduleRequest('Show my calendar tomorrow and '+command),null,'independent native commands retain their planner/approval flow: '+command)
assert.equal(detectReadOnlyScheduleRequest('List my meetings today')?.horizon,'today')
assert.equal(detectReadOnlyScheduleRequest('Show my calendar today and tomorrow')?.horizon,'today-tomorrow')
assert.equal(detectReadOnlyScheduleRequest('What do I have today?'),null,'preserve Today/day route')
for(const subject of ['book launch','change management meeting','purchase review'])
  assert.equal(detectReadOnlyScheduleRequest(`Show my calendar tomorrow for the ${subject}`)?.scope,'calendar','event subjects are not mutation commands')
for(const command of ['book a table','change my meeting time','purchase a ticket','please delete the event','remind me at 11am','reschedule my 11am meeting','postpone my meeting','push my meeting to 2pm','shift my meeting to 2pm','update the event','make my meeting 2pm','remove the 11am event','clear my calendar','invite Alice to the 11am meeting','prepare an invite','write a calendar event','put the meeting in my calendar','set up a meeting','forward the agenda email','save the agenda'])
  assert.equal(detectReadOnlyScheduleRequest(`Show my calendar tomorrow and ${command}`),null,'compound positive commands retain their own flow')
assert.equal(detectReadOnlyScheduleRequest('Show my calendar tomorrow, create an event at 11am'),null,'comma-separated commands also retain their own flow')
for(const [request,day] of [['Show my calendar tomorrow, not today','tomorrow'],['Show my calendar today, not tomorrow','today'],['Show my calendar tomorrow instead of today','tomorrow']]){
 assert.equal(calendarReadWindow(request,new Date('2026-10-07T18:45:00Z'),'Asia/Kolkata').label,day,'exclude negated relative days')
 assert.equal(detectReadOnlyScheduleRequest(request)?.horizon,day,'routing uses the same requested days')
}
assert.equal(calendarReadWindow('Show my calendar tomorrow for the Today Show meeting',new Date('2026-10-07T18:45:00Z'),'Asia/Kolkata').label,'tomorrow','event subject does not expand requested days')
assert.equal(detectReadOnlyScheduleRequest('Show my calendar tomorrow for the Today Show meeting')?.horizon,'tomorrow')
assert.equal(calendarReadWindow('Show my calendar for today and tomorrow',new Date('2026-10-07T18:45:00Z'),'Asia/Kolkata').label,'today and tomorrow','a for-day range is not an event-title filter')
assert.equal(calendarReadWindow('Show my calendar tomorrow for Project 2026-10-10',new Date('2026-10-07T18:45:00Z'),'Asia/Kolkata').label,'tomorrow','ISO-looking event title must not replace the requested range')
assert.equal(calendarReadWindow('Show my calendar for 2026-10-10',new Date('2026-10-07T18:45:00Z'),'Asia/Kolkata').startDate,'2026-10-10','explicit range date stays authoritative')
assert.equal(calendarReadWindow('Show my calendar on 2026-10-11 for Project 2026-10-10',new Date('2026-10-07T18:45:00Z'),'Asia/Kolkata').startDate,'2026-10-11','explicit requested range excludes title date')
const weekdayClock=new Date('2026-10-08T04:00:00Z')
for(const [text,expected] of [['next Wednesday','2026-10-14'],['Friday','2026-10-09'],['next Thursday','2026-10-15'],['this Friday','2026-10-09'],['Wednesday next week','2026-10-14'],['next week Wednesday','2026-10-14'],['next Wednesday for Project 2026-10-10','2026-10-14']]){
 const window=calendarReadWindow(`Find free slots ${text}`,weekdayClock,'Asia/Kolkata')
 assert.equal(window.startDate,expected,text);assert.equal(window.endDate,expected,text+' is a single requested day')
}
for(const text of ['next month','next month on Wednesday','last Friday','last week','in 2 weeks','in two days','in a week','two days from now','day after tomorrow','20 October','October 20','Monday or Wednesday'])
 assert.throws(()=>calendarReadWindow(`Find free slots ${text}`,weekdayClock,'Asia/Kolkata'),/calendar_date_(?:unsupported|ambiguous)/,'unsupported/ambiguous dates cannot silently use the default week')
assert.equal(calendarReadWindow('Show my calendar on 2028-02-29',weekdayClock,'Asia/Kolkata').startDate,'2028-02-29','valid leap day retained')
for(const dates of ['2027-03-20 to 2027-03-10','2027-03-01 and 2027-03-03 and 2027-03-05'])assert.throws(()=>calendarReadWindow('Show my calendar on '+dates,weekdayClock,'Asia/Kolkata'),/calendar_date_ambiguous/)
const midnight=calendarReadWindow('today and tomorrow',new Date('2026-10-07T18:45:00Z'),'Asia/Kolkata')
assert.deepEqual(midnight,{startDate:'2026-10-08',endDate:'2026-10-09',label:'today and tomorrow'})
assert.equal(calendarReadWindow('today',new Date('2026-10-07T18:15:00Z'),'Asia/Kolkata').endDate,'2026-10-07')

for(const request of ["Don't change anything and show my calendar tomorrow", "Don't modify events and list my meetings tomorrow", "Don't change anything! Show my calendar tomorrow", "Don't change anything, just show my calendar tomorrow", "Don't change anything, show my calendar tomorrow", "Don't change, please show my calendar tomorrow", "Don't modify anything? Show my calendar tomorrow"])
 assert.equal(detectReadOnlyScheduleRequest(request)?.scope,'calendar','affirmative command after punctuation: '+request)
assert.equal(detectReadOnlyScheduleRequest("Don't create, instead schedule a meeting tomorrow"),null,'explicit affirmative action remains outside the read shortcut')

for(const verb of ['open','browse','navigate','go to','visit','inspect','monitor','watch','track'])
 assert.equal(detectReadOnlyScheduleRequest(`Show my calendar today and ${verb} https://example.com for changes`),null,'independent watcher command retains its own handler')

async function main(){
 const original=supabaseAdmin.from,originalFetch=globalThis.fetch
 const typedContexts:any[]=[]
 const tables:string[]=[],http:string[]=[];let failCalendar=false,empty=false,rangeFixture=false
 let providerItems:any[]|undefined,partial=false
 const reminderFilters:Array<{method:string;key:string;value:string}>=[]
 const tomorrow=nextLocalDateKey(new Date(),'Asia/Kolkata')
 const today=calendarReadWindow('',new Date(),'Asia/Kolkata').startDate
 const exactRequest='Review my connected calendar for today and tomorrow in Asia/Kolkata. List meetings with their start and end times and flag overlapping events. Read only; do not create, edit or delete events, send emails or create reminders.'
 ;(supabaseAdmin as any).from=(table:string)=>{
  tables.push(table)
  if(table==='agent_activity')return {insert:async(row:any)=>{typedContexts.push(row.metadata_json);return {error:null}}} as any
  if(table==='conversations')return {insert:async(rows:any[])=>{assert.ok(rows.every(row=>row.telegram_id===123),'history remains owned');return {error:null}}} as any
  assert.ok(['users','reminders'].includes(table),'no Attention or watcher reads')
  const result={error:null,data:table==='users'?{telegram_id:123,whatsapp_id:'+15555550123',timezone:'Asia/Kolkata',google_calendar_connected:true,google_refresh_token:'fixture-refresh'}:[{message:'Travel reminder fixture',remind_at:tomorrow+'T09:00:00+05:30',sent:false}]}
  let wrongOwner=false
  const owned=()=>wrongOwner?{error:null,data:null}:result
  const q:any={then:(r:any)=>Promise.resolve(owned()).then(r),maybeSingle:async()=>owned()}
  for(const method of ['select','eq','gte','lt','order'])q[method]=()=>q
  q.eq=(key:string,value:any)=>{if(key==='telegram_id'&&value!==123)wrongOwner=true;return q}
  for(const method of ['gte','lt'])q[method]=(key:string,value:string)=>{if(table==='reminders')reminderFilters.push({method,key,value});return q}
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
  const unclearDateResponse=await exported.POST(new NextRequest('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid'},body:JSON.stringify({text:'Show my calendar today and next month.'})}))
  assert.equal(unclearDateResponse.status,200,'unsupported ranges return a clarification through the actual route')
  assert.match((await unclearDateResponse.json()).text,/exact calendar date/)
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
  const titleDateResponse=await exported.POST(new NextRequest('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid'},body:JSON.stringify({text:'Show my calendar tomorrow for Project 2026-10-10'})}))
  assert.equal((await titleDateResponse.json()).handledBy,'read-only-schedule')
  assert.equal(new URL(http.at(-1)!).searchParams.get('timeMin'),new Date(tomorrow+'T00:00:00+05:30').toISOString(),'actual routed provider query excludes ISO-looking title dates')
  const combined=await readTomorrowSchedule({actor,scope:'agenda',text:'Show my calendar and reminders today and tomorrow and flag overlapping events.'})
  assert.match(combined.text,/Overlap: Today meeting A.*Today meeting B/)
  assert.match(combined.text,/Travel reminder fixture/)
  await rememberTypedObjects(123,'calendar',[{id:'old-event',title:'Earlier meeting'}],'old-event')
  await readTomorrowSchedule({actor,scope:'calendar',text:'Show my calendar tomorrow and find free slots.'})
  assert.deepEqual(typedContexts.at(-1).items,[],'availability clears earlier event selection before returning slots')
  assert.equal(selectedTypedObject(typedContexts.at(-1),'move the first one'),null,'slot followups cannot bind an earlier event')
  const availability=await readTomorrowSchedule({actor,scope:'agenda',text:'Show my schedule tomorrow and find a free slot.'})
  assert.match(availability.text,/free slots|weekday slot/)
  assert.doesNotMatch(availability.text,/Calendar: clear|Nothing currently needs your attention/,'availability mode must not describe an unlisted busy calendar as empty')
  for(const question of ['Show my schedule tomorrow and tell me if I have any free time.','Show my schedule tomorrow. Is there a free slot?'])
    assert.match((await readTomorrowSchedule({actor,scope:'agenda',text:question})).text,/free slots|weekday slot/,'declarative availability questions retain the requested answer')
  const availabilityResponse=await exported.POST(new NextRequest('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid'},body:JSON.stringify({text:'Show my schedule tomorrow and find a free slot.'})}))
  const checkForResponse=await exported.POST(new NextRequest('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid'},body:JSON.stringify({text:'Show my schedule tomorrow and check for free time.'})}))
  assert.match((await checkForResponse.json()).text,/free slots|weekday slot/,'actual route calculates check-for availability')
  const availabilityReply=await availabilityResponse.json()
  assert.equal(availabilityReply.handledBy,'read-only-schedule');assert.match(availabilityReply.text,/free slots|weekday slot/)
  tables.length=0
  assert.doesNotMatch(range.text,/overlap[^\n]*Adjacent meeting/i,'touching intervals do not overlap')
  assert.equal(range.mutated,false);assert.ok(!tables.includes('reminders'))
  const subjectResponse=await exported.POST(new NextRequest('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid'},body:JSON.stringify({text:'Show my calendar tomorrow for the book launch'})}))
  assert.equal((await subjectResponse.json()).handledBy,'read-only-schedule','noun subjects retain the actual production calendar path')
  const direct=(instruction=exactRequest)=>executeReadOnlyCalendarStep({actor,instruction,missionText:instruction})
  const filteredTimezone=await direct('Show my calendar tomorrow for Alice in America/Los_Angeles')
  assert.equal(filteredTimezone.output.timezone,'America/Los_Angeles','explicit timezone suffix survives an event or attendee filter')
  assert.ok('events' in (await direct('Show my calendar tomorrow for the Free Lunch event.')).output,'Free in an event subject must not switch the shared reader to availability mode')
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
  await assert.rejects(()=>direct('Find free slots tomorrow'),/calendar_availability_unverified/,'unknown intervals must not complete a negative availability step')
  providerItems=[{id:'unspecified-end',summary:'End unknown',start:{dateTime:tomorrow+'T09:00:00+05:30'},end:{dateTime:tomorrow+'T10:00:00+05:30'},endTimeUnspecified:true}]
  const unspecified=await direct('Show my calendar tomorrow and flag overlapping events')
  assert.ok('conflictsVerified' in unspecified.output)
  assert.equal(unspecified.output.conflictsVerified,false,'provider compatibility end is not a verified end')
  assert.ok('events' in unspecified.output);assert.equal(unspecified.output.events[0].end,'','synthetic end is not exposed as an actual end')
  assert.match(unspecified.text,/end time not verified/)
  const pluralOverlap=await direct('Show my calendar tomorrow and flag overlaps')
  assert.ok('conflictsVerified' in pluralOverlap.output)
  assert.equal(pluralOverlap.output.conflictsVerified,false,'plural overlaps also requests a verified conflict review')
  await assert.rejects(()=>direct('Find free slots tomorrow'),/calendar_availability_unverified/,'unspecified event end cannot certify availability')
  providerItems=[
    {id:'accepted',summary:'Accepted meeting',start:{dateTime:tomorrow+'T14:00:00+05:30'},end:{dateTime:tomorrow+'T15:00:00+05:30'}},
    {id:'declined',summary:'Declined invitation',attendees:[{self:true,responseStatus:'declined'}],start:{dateTime:tomorrow+'T14:30:00+05:30'},end:{dateTime:tomorrow+'T16:00:00+05:30'}},
    {id:'declined-unknown',summary:'Declined without end',attendees:[{self:true,responseStatus:'declined'}],start:{dateTime:tomorrow+'T15:00:00+05:30'}},
  ]
  const rsvpRead=await direct('Show my calendar tomorrow and flag overlaps')
  assert.ok('conflicts' in rsvpRead.output);assert.equal(rsvpRead.output.conflicts.length,0,'self-declined invitation does not conflict')
  assert.equal(rsvpRead.output.unknownIntervals,0,'self-declined unknown end does not prevent verification')
  const rsvpSlots=await direct('Find free slots tomorrow at 3 PM')
  assert.ok('availableSlots' in rsvpSlots.output);assert.equal(rsvpSlots.output.availableSlots.length,1,'declined invitation does not block availability')
  providerItems=providerItems.slice(0,2)
  for(const attendee of [{self:false,responseStatus:'declined'},{self:true,responseStatus:'tentative'},{self:true,responseStatus:'needsAction'}]){
    providerItems[1].attendees=[attendee]
    const stillBusy=await direct('Show my calendar tomorrow and flag overlaps')
    assert.ok('conflicts' in stillBusy.output);assert.equal(stillBusy.output.conflicts.length,1,'only the owner declining removes busy time')
    const busySlot=await direct('Find free slots tomorrow at 3 PM')
    assert.ok('availableSlots' in busySlot.output);assert.equal(busySlot.output.availableSlots.length,0)
  }
  providerItems=[];partial=true
  await rememberTypedObjects(123,'calendar',[{id:'old-event',title:'Earlier meeting'}],'old-event')
  const incompleteSlots=await readTomorrowSchedule({actor,scope:'calendar',text:'Show my calendar tomorrow and find free slots.'})
  assert.equal(incompleteSlots.calendarReadVerified,false)
  assert.deepEqual(typedContexts.at(-1).items,[],'incomplete availability also clears stale event selection')
  const partialCalendar=await readTomorrowSchedule({actor,scope:'calendar',text:exactRequest})
  assert.equal(partialCalendar.calendarReadVerified,false);assert.match(partialCalendar.text,/Partial calendar page/)
  assert.doesNotMatch(partialCalendar.text,/No calendar events|No overlapping/,'an empty page with a next token is not an empty calendar')
  const missionSource=readFileSync('lib/agent/mission-tools.ts','utf8')
  const missionMocks:any=Object.fromEntries([...missionSource.matchAll(/from ['"]([^'"]+)['"]/g)].map(m=>[m[1],nullModule]))
  missionMocks['./calendar-read']={executeReadOnlyCalendarStep,calendarReadWindow,calendarAffirmativeText}
  const missionExports:any={}
  runInNewContext(ts.transpileModule(missionSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports:missionExports,console,URL,process:{env:{}},require:(name:string)=>missionMocks[name]})
  await assert.rejects(()=>missionExports.executeVerifiedMissionCalendar({actor,step:{tool:'calendar',title:'Find availability',instruction:'Find free slots tomorrow'},missionText:'Find free slots tomorrow',runId:'fixture-run'}),/calendar_availability_unverified/,'canonical mission wrapper propagates incomplete availability instead of completing')
  await assert.rejects(()=>missionExports.executeVerifiedMissionCalendar({actor,step:{tool:'calendar',title:'Review overlaps',instruction:'Review calendar today and tomorrow and flag overlapping events.'},missionText:'Review calendar today and tomorrow and flag overlapping events.',runId:'fixture-run'}),/calendar_conflicts_unverified/,'actual mission caller must not complete an explicitly incomplete conflict review')
  await assert.rejects(()=>missionExports.executeVerifiedMissionCalendar({actor,step:{tool:'calendar',title:'Review overlaps',instruction:exactRequest},missionText:exactRequest,runId:'fixture-run'}),/calendar_conflicts_unverified/,'explicit do-not-create clauses retain the real read path')
  await assert.rejects(()=>missionExports.executeVerifiedMissionCalendar({actor,step:{tool:'calendar',title:'Calendar request',instruction:'Do not create a placeholder, and schedule the client meeting tomorrow.'},missionText:'Do not create a placeholder, and schedule the client meeting tomorrow.',runId:'fixture-run'}),/mission_calendar_dates_missing/,'affirmative schedule after a negated action still enters the existing write validation; no provider write fixture')
  await assert.rejects(()=>missionExports.executeVerifiedMissionCalendar({actor,step:{tool:'calendar',title:'Calendar request',instruction:'Do not create a placeholder, and write a calendar event tomorrow.'},missionText:'Do not create a placeholder, and write a calendar event tomorrow.',runId:'fixture-run'}),/mission_calendar_dates_missing/,'affirmative write after a negative clause retains write validation')
  await assert.rejects(()=>missionExports.executeVerifiedMissionCalendar({actor,step:{tool:'calendar',title:'Calendar request',instruction:'Do not create a placeholder and instead schedule the client meeting tomorrow.'},missionText:'Do not create a placeholder and instead schedule the client meeting tomorrow.',runId:'fixture-run'}),/mission_calendar_dates_missing/,'explicit instead conjunction retains affirmative scheduling')
  const meetingWrites:any[]=[]
  const meetingDb={from(table:string){
    assert.ok(['agent_runs','agent_activity','agent_artifacts'].includes(table),'meeting preparation may persist only owned drafts/run metadata')
    let payload:any
    const q:any={insert(value:any){payload=value;meetingWrites.push({table,operation:'insert',payload:value});return q},update(value:any){payload=value;meetingWrites.push({table,operation:'update',payload:value});return q},
      select(){return q},eq(){return q},single:async()=>({data:{id:`fixture-${table}-${meetingWrites.length}`},error:null}),then:(resolve:any,reject:any)=>Promise.resolve({data:payload,error:null}).then(resolve,reject)}
    return q
  }}
  const meetingSource=readFileSync('lib/agent/workspace-meeting-plan.ts','utf8')
  const meetingMocks:any=Object.fromEntries([...meetingSource.matchAll(/from ['"]([^'"]+)['"]/g)].map(m=>[m[1],nullModule]))
  Object.assign(meetingMocks,{'@/lib/supabase-admin':{supabaseAdmin:meetingDb},'@/lib/bot/memory-redaction':{redactSecretShapedText:(value:string)=>value},
    './calendar-read':{executeReadOnlyCalendarStep},'./google-workspace-read':{searchWorkspaceEmails:async()=>({messages:[{id:'fixture-email',threadId:'fixture-thread',from:'Fixture sender <sender@example.test>',subject:'Meeting',snippet:'Fixture discussion'}]})}})
  const meetingExports:any={}
  runInNewContext(ts.transpileModule(meetingSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports:meetingExports,console,URL,process:{env:{}},require:(name:string)=>meetingMocks[name]})
  const meetingRequest={actor,surface:'web',text:'Read the latest email and prepare a proposed meeting tomorrow.'}
  const incompleteMeeting=await meetingExports.tryPrepareWorkspaceMeetingPlan(meetingRequest)
  assert.equal(incompleteMeeting.status,'failed');assert.doesNotMatch(incompleteMeeting.text,/no free slot matched/)
  assert.ok(meetingWrites.some(write=>write.payload.error==='calendar_availability_unverified'),'actual meeting caller persists unverified availability as failed')
  assert.ok(!meetingWrites.some(write=>write.table==='agent_artifacts'),'no proposal fabricated from incomplete availability')
  const partialAgenda=await readTomorrowSchedule({actor,scope:'agenda',text:'Show my schedule tomorrow and find a free slot.'})
  assert.match(partialAgenda.text,/could not verify free slots/);assert.doesNotMatch(partialAgenda.text,/Calendar: clear|Nothing currently needs your attention/)
  partial=false
  meetingWrites.length=0;providerItems=undefined
  const preparedMeeting=await meetingExports.tryPrepareWorkspaceMeetingPlan(meetingRequest)
  assert.equal(preparedMeeting.status,'completed','meeting preparation requests availability explicitly even without a free/slot keyword')
  const proposal=meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json
  assert.equal(proposal.sourceEmail.threadId,'fixture-thread');assert.equal(proposal.safety.emailSent,false);assert.equal(proposal.safety.calendarScheduled,false)
  assert.equal(proposal.safety.approvalRequiredForExecution,true);assert.equal(proposal.proposedInvite.status,'proposed_not_scheduled')
  meetingWrites.length=0
  await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:'Read the latest email and prepare a proposed 1 hour meeting tomorrow.'})
  const hourProposal=meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json
  assert.doesNotMatch(hourProposal.draftReply,/attached brief/,'no attachment is claimed when the actual proposal used only email context')
  assert.match(hourProposal.draftReply,/60-minute/,'actual prepared reply agrees with the requested duration')
  assert.equal(new Date(hourProposal.proposedInvite.end).getTime()-new Date(hourProposal.proposedInvite.start).getTime(),60*60_000)
  meetingWrites.length=0
  await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:'Read the latest email and prepare a proposed 1-hour meeting tomorrow.'})
  assert.match(meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json.draftReply,/60-minute/,'hyphenated requested duration is retained')
  meetingWrites.length=0;providerItems=[]
  await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:'Read the latest email and prepare a proposed meeting next Wednesday.'})
  const wednesdayProposal=meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json
  assert.ok(wednesdayProposal,'named weekday request produces the actual private proposal')
  assert.equal(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',weekday:'long'}).format(new Date(wednesdayProposal.proposedInvite.start)),'Wednesday','actual meeting proposal must honor the requested named weekday')
  meetingWrites.length=0;providerItems=[]
  await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:'Read the latest email and prepare a proposed meeting tomorrow at 3pm.'})
  const timedProposal=meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json
  assert.ok(timedProposal)
  assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(timedProposal.proposedInvite.start)),'15:00','actual proposed invite honors the requested 3pm')
  for(const [requestedTime,expectedTime] of [['at 15:15','15:15'],['15:15','15:15'],['at noon','12:00'],['at 3:15 p.m.','15:15']]){
    meetingWrites.length=0
    await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:`Read the latest email and prepare a proposed 1-hour meeting next Sunday ${requestedTime}.`})
    const precise=meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json.proposedInvite
    assert.ok(precise,'an explicit weekend appointment is not replaced by a weekday')
    assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(precise.start)),expectedTime)
    assert.equal(new Date(precise.end).getTime()-new Date(precise.start).getTime(),60*60_000)
    assert.equal(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',weekday:'long'}).format(new Date(precise.start)),'Sunday')
  }
  providerItems=[{id:'occupied',summary:'Already busy',start:{dateTime:tomorrow+'T14:45:00+05:30'},end:{dateTime:tomorrow+'T15:30:00+05:30'}}]
  meetingWrites.length=0
  const busyProposal=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:'Read the latest email and prepare a proposed meeting tomorrow at 3pm.'})
  assert.equal(busyProposal.status,'paused');assert.match(busyProposal.text,/15:00/);assert.doesNotMatch(busyProposal.text,/and brief/)
  assert.ok(!meetingWrites.some(write=>write.table==='agent_artifacts'),'busy requested time never produces an arbitrary alternate invitation')
  providerItems=[]
  for(const constraint of ['about 3 PM','about 15:00','about noon','at 3','at 3pm or 4pm','between 3 and 5pm','after 3pm','in the afternoon','at 25:00','at 11:50pm']){
    meetingWrites.length=0;http.length=0
    const result=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:`Read the latest email and prepare a proposed meeting tomorrow ${constraint}.`})
    assert.equal(result.status,'paused',constraint);assert.match(result.text,/one exact meeting time/)
    assert.ok(!meetingWrites.some(write=>write.table==='agent_artifacts'),constraint+' cannot fabricate a proposal')
    assert.ok(!http.some(url=>url.includes('/calendar/v3/')),constraint+' does not query an arbitrary availability window')
  }
  const approximateSlot=await readTomorrowSchedule({actor,scope:'calendar',text:'Find a free slot tomorrow about 3 PM.'})
  assert.equal(approximateSlot.calendarReadVerified,false);assert.match(approximateSlot.text,/one exact time/)
  const ambiguousSlot=await readTomorrowSchedule({actor,scope:'calendar',text:'Find free slots tomorrow at 3.'})
  assert.equal(ambiguousSlot.calendarReadVerified,false);assert.match(ambiguousSlot.text,/one exact time/)
  for(const timeZone of ['UTC','America/Los_Angeles']){
    meetingWrites.length=0;providerItems=[]
    await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:`Read the latest email and prepare a proposed meeting tomorrow at 3 PM ${timeZone}.`})
    const zoned=meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json.proposedInvite
    assert.equal(zoned?.timezone,timeZone,'clock-attached timezone remains explicit')
    assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(zoned.start)),'15:00')
  }
  for(const text of ['Read the email from Friday and prepare a proposed meeting tomorrow at 3pm.','Read the latest email and prepare a proposed meeting tomorrow at 3pm to discuss the Friday launch.']){
    meetingWrites.length=0;providerItems=[]
    const contextual=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text})
    assert.equal(contextual.status,'completed','source/topic weekday does not replace the explicit meeting day')
    const invite=meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json.proposedInvite
    assert.equal(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(invite.start)),tomorrow)
  }
  for(const sourceWord of ['email','gmail','mail','inbox'])for(const join of [' and ', ' then ', '; ', '. '])for(const sourceTime of ['from 3 PM','at 3 PM UTC']){
    meetingWrites.length=0;providerItems=[]
    const sourceClock=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:`Review the ${sourceWord} ${sourceTime}${join}prepare a proposed meeting next Wednesday.`})
    assert.equal(sourceClock.status,'completed','source email time does not impose a meeting time window')
    const invite=meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json.proposedInvite
    assert.equal(invite.timezone,'Asia/Kolkata','source email timezone is not the requested meeting timezone')
    assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(invite.start)),'09:00','default free slot remains independent of the email timestamp')
  }
  for(const [duration,minutes] of [['one-hour',60],['an hour',60],['two-hour',120],['half an hour',30],['quarter-hour',15],['one and a half hours',90],['an hour and a half',90],['two and a half hours',150],['one hour and a quarter',75]] as const){
    meetingWrites.length=0;providerItems=[]
    const result=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:`Read the latest email and prepare a proposed ${duration} meeting next Wednesday.`})
    assert.equal(result.status,'completed',duration)
    const content=meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json
    assert.equal(new Date(content.proposedInvite.end).getTime()-new Date(content.proposedInvite.start).getTime(),minutes*60_000)
    assert.match(content.draftReply,new RegExp(`${minutes}-minute`))
  }
  meetingWrites.length=0;providerItems=[]
  const topicFirst=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:'Read the latest email and prepare a proposed meeting about the budget next Wednesday at 3 PM.'})
  assert.equal(topicFirst.status,'completed')
  const topicFirstInvite=meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json.proposedInvite
  assert.equal(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',weekday:'long'}).format(new Date(topicFirstInvite.start)),'Wednesday')
  assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(topicFirstInvite.start)),'15:00')
  for(const constraint of ['on 2027-02-30','on 2027-02-29','on 2027-13-01','on 2027-00-10','on 2027-03-14 at 2:30 AM America/New_York']){
    meetingWrites.length=0;providerItems=[]
    const invalid=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:`Read the latest email and prepare a proposed meeting ${constraint}.`})
    assert.equal(invalid.status,'paused',constraint+' cannot normalize to a different appointment')
    assert.ok(!meetingWrites.some(write=>write.table==='agent_artifacts'))
  }
  const invalidRead=await readTomorrowSchedule({actor,scope:'calendar',text:'Show my calendar on 2027-02-30.'})
  assert.equal(invalidRead.calendarReadVerified,false);assert.match(invalidRead.text,/exact calendar date/)
  meetingWrites.length=0;providerItems=[]
  await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:'Read the latest email and prepare a proposed meeting on 2027-03-14 at 3:30 AM America/New_York.'})
  const validDst=meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json.proposedInvite
  assert.ok(validDst)
  assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(validDst.start)),'03:30')
  for(const phrasing of ['if I am free',"if I'm free",'whether we are available',"if we're free"]){
    providerItems=[]
    const indirect=await executeReadOnlyCalendarStep({actor,instruction:`Check my calendar to see ${phrasing} tomorrow at 3 PM.`,missionText:''})
    assert.equal(indirect.output.mode,'availability')
    if('availableSlots' in indirect.output){
      assert.equal(indirect.output.availableSlots.length,1)
      assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(indirect.output.availableSlots[0].start)),'15:00')
    }
  }
  for(const datePhrase of ['in two days','in a week','two days from now','day after tomorrow']){
    meetingWrites.length=0;providerItems=[]
    const relative=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:`Read the latest email and prepare a proposed meeting ${datePhrase}.`})
    assert.equal(relative.status,'paused',datePhrase)
    assert.match(relative.text,/exact meeting date/)
    assert.ok(!meetingWrites.some(write=>write.table==='agent_artifacts'))
  }
  for(const order of ['for one hour in America/New_York','in America/New_York for one hour','lasting one hour timezone America/New_York']){
    meetingWrites.length=0;providerItems=[]
    const result=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:`Read the latest email and prepare a proposed meeting about the budget ${order} next Wednesday at 3 PM.`})
    assert.equal(result.status,'completed',order)
    const proposed=meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json
    assert.equal(proposed.proposedInvite.timezone,'America/New_York');assert.match(proposed.draftReply,/60-minute/)
    assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(proposed.proposedInvite.start)),'15:00')
  }
  for(const day of ['Saturday','Sunday']){
    meetingWrites.length=0;providerItems=[]
    const result=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:`Read the latest email and prepare a proposed meeting next ${day}.`})
    assert.equal(result.status,'completed')
    const invite=meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json.proposedInvite
    assert.equal(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',weekday:'long'}).format(new Date(invite.start)),day)
  }
  const sundayDate=calendarReadWindow('next Sunday',new Date(),'Asia/Kolkata').startDate
  providerItems=[{id:'busy-sunday',summary:'All-day busy',start:{dateTime:sundayDate+'T00:00:00+05:30'},end:{dateTime:sundayDate+'T23:59:00+05:30'}}]
  const busyWeekend=await direct('Find free slots next Sunday')
  assert.ok('availableSlots' in busyWeekend.output);assert.equal(busyWeekend.output.availableSlots.length,0)
  assert.doesNotMatch(busyWeekend.text,/weekday/,'explicit weekend failure is not described as a weekday search')
  for(const constraint of ['2027-11-07 at 1:30 AM America/New_York','2027-04-04 at 1:45 AM Australia/Lord_Howe']){
    meetingWrites.length=0;providerItems=[]
    const result=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:`Read the latest email and prepare a proposed meeting on ${constraint}.`})
    assert.equal(result.status,'paused');assert.match(result.text,/occurs twice/)
    assert.ok(!meetingWrites.some(write=>write.table==='agent_artifacts'))
  }
  const repeated=await readTomorrowSchedule({actor,scope:'calendar',text:'Find free slots on 2027-11-07 at 1:30 AM America/New_York.'})
  assert.equal(repeated.calendarReadVerified,false);assert.match(repeated.text,/occurs twice/)
  const wordSlot=await readTomorrowSchedule({actor,scope:'calendar',text:'Find one-hour free slots next Wednesday.'})
  assert.equal(wordSlot.calendarReadVerified,true,'word duration survives the actual schedule caller')
  for(const [constraint,expectedTime,expectedZone] of [
    ['about the budget next Wednesday at 3 PM.','15:00','Asia/Kolkata'],
    ['about the budget at 3 PM.','15:00','Asia/Kolkata'],
    ['about the budget at 3pm.','15:00','Asia/Kolkata'],
    ['to discuss the 3 PM launch.','09:00','Asia/Kolkata'],
    ['to discuss the 3 PM UTC launch.','09:00','Asia/Kolkata'],
    ['about the 4-hour outage.','09:00','Asia/Kolkata'],
    ['at 3 PM to discuss the 5 PM launch.','15:00','Asia/Kolkata'],
    ['to discuss the 3 PM launch. Start at 4 PM UTC.','16:00','UTC'],
    ['to discuss the 3 p.m. launch. Start at 4 p.m. UTC.','16:00','UTC'],
  ]){
    meetingWrites.length=0;providerItems=[]
    const result=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:`Read the latest email and prepare a proposed meeting next Wednesday ${constraint}`})
    assert.equal(result.status,'completed',constraint)
    const invite=meetingWrites.find(write=>write.table==='agent_artifacts')?.payload.content_json.proposedInvite
    assert.equal(invite.timezone,expectedZone,'topic timezone is not the meeting timezone')
    assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:expectedZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(invite.start)),expectedTime,constraint)
    assert.equal(new Date(invite.end).getTime()-new Date(invite.start).getTime(),30*60_000,'topic duration is not the meeting duration')
  }
  meetingWrites.length=0;http.length=0
  for(const duration of ['4-hour','10-minute','0-minute','1 hour 30 minute','four-hour']){
    meetingWrites.length=0;providerItems=[];http.length=0
    const changedDuration=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:`Read the latest email and prepare a proposed ${duration} meeting tomorrow.`})
    assert.equal(changedDuration.status,'paused',duration+' cannot be silently changed')
    assert.match(changedDuration.text,/15 to 180/)
    assert.ok(!meetingWrites.some(write=>write.table==='agent_artifacts'))
    assert.ok(!http.some(url=>url.includes('/calendar/v3/')))
  }
  const badDuration=await readTomorrowSchedule({actor,scope:'calendar',text:'Find a 4-hour free slot tomorrow.'})
  assert.equal(badDuration.calendarReadVerified,false);assert.match(badDuration.text,/15 to 180/)
  meetingWrites.length=0;providerItems=[];http.length=0
  const badMeetingZone=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:'Read the latest email and prepare a proposed meeting tomorrow at 3 PM timezone Asia/FakeZone.'})
  assert.equal(badMeetingZone.status,'paused','invalid requested timezone is correctable input')
  assert.match(badMeetingZone.text,/valid timezone/)
  assert.ok(!meetingWrites.some(write=>write.table==='agent_artifacts'))
  assert.ok(!http.some(url=>url.includes('/calendar/v3/')))
  const unsupportedMeeting=await meetingExports.tryPrepareWorkspaceMeetingPlan({...meetingRequest,text:'Read the latest email and prepare a proposed meeting next month.'})
  assert.equal(unsupportedMeeting.status,'paused');assert.match(unsupportedMeeting.text,/exact meeting date/)
  assert.ok(!meetingWrites.some(write=>write.table==='agent_artifacts'),'unsupported dates do not create an arbitrary proposed meeting')
  assert.ok(!http.some(url=>url.includes('/calendar/v3/')),'unsupported date does not query an arbitrary calendar range')
  providerItems=Array.from({length:15},(_,i)=>({id:`bounded-${i}`,summary:`Meeting ${i}`,start:{dateTime:today+`T${String(8+i).padStart(2,'0')}:00:00+05:30`},end:{dateTime:today+`T${String(8+i).padStart(2,'0')}:30:00+05:30`}}))
  const bounded=await direct();assert.match(bounded.text,/Showing 12 of 15/);assert.ok('events' in bounded.output);assert.equal(bounded.output.events.length,12)
  const boundedAgenda=await readTomorrowSchedule({actor,scope:'agenda',text:exactRequest})
  assert.match(boundedAgenda.text,/Calendar: 15 returned events \(showing 6\)/,'agenda distinguishes returned count from its display bound')
  assert.doesNotMatch(boundedAgenda.text,/Showing 12 of/,'agenda does not copy the canonical reader display count when it shows only six')
  providerItems=Array.from({length:41},(_,i)=>({...providerItems![0],id:`overflow-${i}`}))
  assert.equal((await direct()).output.complete,false,'over-limit provider responses retain incompleteness')
  providerItems=undefined;http.length=0
  await assert.rejects(()=>executeReadOnlyCalendarStep({actor:{...actor,legacyTelegramId:999},instruction:exactRequest,missionText:exactRequest}),/calendar_not_connected/)
  assert.equal(http.length,0,'wrong owner never reaches the calendar provider')
  const explicitZone=await direct('Show my calendar today in America/New_York')
  assert.equal(explicitZone.output.timezone,'America/New_York')
  assert.equal(explicitZone.output.window.startDate,new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))
  for(const zone of ['America/Port-au-Prince','Etc/GMT+5','UTC','CET','EET','EST5EDT']){
    const requested=await direct(`Show my calendar today in ${zone}.`)
    assert.equal(requested.output.timezone,zone,'retain complete explicit timezone: '+zone)
    assert.equal(requested.output.window.startDate,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))
  }
  for(const instruction of ['Show my calendar today, timezone CET.','Show my calendar today (EST5EDT).','Show my calendar today (UTC).'])
    assert.equal((await direct(instruction)).output.timezone,instruction.includes('CET')?'CET':instruction.includes('EST5EDT')?'EST5EDT':'UTC')
  for(const [label,zone] of [['timezone:America/New_York','America/New_York'],['timezone=UTC','UTC'],['timezone: Asia/Kolkata','Asia/Kolkata']])
    assert.equal((await direct(`Show my calendar today ${label}.`)).output.timezone,zone,'compact timezone label retains the explicit window')
  const cetResponse=await exported.POST(new NextRequest('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid'},body:JSON.stringify({text:'Show my calendar today in CET.'})}))
  assert.match((await cetResponse.json()).text,/CET/,'slashless timezone survives the real route and wrapper')
  for(const instruction of ['Show my calendar today for Design/Review.','Show my calendar today for https://example.com/calendar/review.','Show my calendar tomorrow for the Made in Japan review.'])
    assert.equal((await direct(instruction)).output.timezone,'Asia/Kolkata','event subjects and URLs are not timezone directives')
  assert.equal((await direct('Show my calendar tomorrow for the Made in Japan review; timezone CET.')).output.timezone,'CET','explicit timezone labels remain authoritative after an event filter')
  http.length=0
  await assert.rejects(()=>direct('Show my calendar today in Asia/FakeZone'),/calendar_timezone_invalid/)
  assert.equal(http.length,0,'invalid timezone is rejected before provider access')
  const invalidResponse=await exported.POST(new NextRequest('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid'},body:JSON.stringify({text:'Show my calendar today in Asia/FakeZone.'})}))
  assert.equal(invalidResponse.status,200)
  const invalidReply=await invalidResponse.json()
  assert.match(invalidReply.text,/timezone is invalid/i)
  assert.doesNotMatch(invalidReply.text,/could not read|connected calendar just now/i,'production wrapper preserves invalid-input reason')
  assert.equal(http.length,0)
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
  reminderFilters.length=0
  const failedZone=await readTomorrowSchedule({actor,scope:'agenda',text:'Show my schedule tomorrow in America/Los_Angeles.'})
  assert.equal(failedZone.timeZone,'America/Los_Angeles','provider failure must not replace the explicit timezone used by independent reminders')
  assert.equal(failedZone.window.startDate,calendarReadWindow('tomorrow',new Date(),'America/Los_Angeles').startDate)
  assert.equal(reminderFilters.find(filter=>filter.method==='gte')?.value,parseLocalDateTime({date:failedZone.window.startDate,time:'00:00',timezone:'America/Los_Angeles'}).dueAtUtc.toISOString(),'actual reminder query preserves requested local midnight on provider failure')
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
