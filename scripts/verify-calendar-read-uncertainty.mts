import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as timezone from '../lib/timezone'
import * as intervals from '../lib/calendar-intervals'
import {redactSecretShapedText} from '../lib/bot/memory-redaction'

// Actual read/helper/briefing exports with inert transports. No live tokens,
// provider mutations, notifications or reminder writes are allowed here.
let userError=false,extrasError=false,primaryLinked=true,primaryMissing=false,extras=true,providerStatus=200
let failedReads=new Set<string>(),failedRefresh=new Set<string>(),eventRows:any[]=[]
let refreshRequests:string[]=[]
const db={from(table:string){
 assert.ok(['users','google_calendar_accounts','reminders','travel_tickets'].includes(table),table)
 const result=()=>({data:table==='users'?{google_calendar_connected:primaryLinked,google_refresh_token:primaryLinked&&!primaryMissing?'fixture-primary':null,timezone:'Asia/Kolkata',briefing_content:'calendar'}:
  table==='google_calendar_accounts'?(extras?[{email:'extra@example.test',refresh_token:'fixture-extra'}]:[]):[],
 error:(table==='users'&&userError)||(table==='google_calendar_accounts'&&extrasError)?{message:'fixture lookup failed'}:null})
 const q:any={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(String(value),'123');return q},gte:()=>q,lt:()=>q,order:()=>q,limit:()=>q,
  single:async()=>result(),maybeSingle:async()=>result(),then:(resolve:any,reject:any)=>Promise.resolve(result()).then(resolve,reject)}
 return q
}}
async function getToday(token:string){if(failedReads.has(token))throw Error('fixture calendar outage');return eventRows}
const calendar={refreshAccessToken:async(token:string)=>{refreshRequests.push(token);return failedRefresh.has(token)?null:token},
 fetchPrimaryCalendarAccount:async()=> 'primary@example.test',getTodayEvents:getToday,
 fetchPrimaryCalendarEventsPage:async(token:string)=>({events:await getToday(token),hasMore:false})}
const weather={fetchWeatherForecast:async()=>null,formatCurrentWeather:()=>''}
const followups={saveFollowupState:async(_owner:unknown,_kind:unknown,_data:unknown)=>{}}
function load(file:string,deps:Record<string,unknown>,fetcher?:unknown,expose?:string){
 const exports:any={}
 runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText+(expose?`\nexports.__entry=${expose};`:''),
  {exports,process,Date,URL,URLSearchParams,console,fetch:fetcher,require:(name:string)=>{assert.ok(name in deps,'Unexpected dependency '+name);return deps[name]}})
 return exports
}
const accounts=load('lib/services/google-calendar-accounts.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/services/google-calendar':calendar})
const deps={'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/services/weather':weather,'@/lib/google-calendar':calendar,'@/lib/services/google-calendar-accounts':accounts,
 '@/lib/limits':{},'./followup-state':followups}
const morning=load('lib/bot/handlers/morning-briefing.ts',deps)
const plan=load('lib/bot/handlers/plan-my-day.ts',deps)
const read=load('lib/agent/calendar-read.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/google-calendar':calendar,
 '@/lib/services/google-calendar-accounts':accounts,'@/lib/timezone':timezone,'@/lib/agent/typed-object-context':{},'@/lib/bot/memory-redaction':{redactSecretShapedText}})
const dashboard=load('lib/dashboard/queries.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/ist':{istDayWindow:()=>({startUtc:new Date('2026-10-18T00:00:00Z'),endUtc:new Date('2026-10-19T00:00:00Z')})},
 '@/lib/services/meter':{},'@/lib/data/limits':{},'@/lib/calendar-intervals':intervals,'@/lib/services/google-calendar-accounts':accounts},async(_url:unknown,init:any)=>{
 const status=failedReads.has(String(init.headers.Authorization).replace(/^Bearer /,''))?503:providerStatus
 return {ok:status===200,status,json:async()=>({items:eventRows})}
})
const failures:string[]=[]
async function check(name:string,fn:()=>Promise<void>){
 userError=false;extrasError=false;primaryLinked=true;primaryMissing=false;extras=true;providerStatus=200;failedReads=new Set();failedRefresh=new Set();eventRows=[];refreshRequests=[]
 try{await fn();console.log('PASS '+name)}catch(error){failures.push(name+': '+(error instanceof Error?error.message:String(error)).slice(0,350))}
}
await check('partial linked Calendar read is explicitly incomplete',async()=>{
 failedReads.add('fixture-extra')
 const state=await accounts.getTodayEventsAllAccounts(123,'fixture-primary',getToday)
 assert.equal(state.incomplete,true)
 assert.equal(state.connected,true)
})
for(const [name,build]of [['briefing',morning.buildMorningBriefing],['day plan',plan.buildPlanMyDayReply]] as const){
 await check(name+' does not call partial empty data an empty day',async()=>{
  failedReads.add('fixture-extra');const reply=await build(123,'Fixture')
  assert.match(reply,/incomplete|couldn.t.*(?:account|calendar)|unavailable/i)
  assert.doesNotMatch(reply,/No calendar events lined up today/)
 })
 await check(name+' keeps successful events with an incomplete warning',async()=>{
  failedReads.add('fixture-extra');eventRows=[{id:'fixture-event',summary:'Fixture healthy event',start:{dateTime:'2026-10-18T14:00:00+05:30'}}]
  const reply=await build(123,'Fixture');assert.match(reply,/Fixture healthy event/);assert.match(reply,/incomplete|couldn.t.*(?:account|calendar)|unavailable/i)
 })
 await check(name+' reports total provider failure',async()=>{
  failedReads=new Set(['fixture-primary','fixture-extra']);const reply=await build(123,'Fixture')
  assert.match(reply,/couldn.t.*(?:calendar|account)|unavailable/i);assert.doesNotMatch(reply,/No calendar events lined up today/)
 })
 await check(name+' reports failed connection-state lookup',async()=>{
  userError=true;const reply=await build(123,'Fixture');assert.match(reply,/couldn.t.*calendar|unavailable/i);assert.doesNotMatch(reply,/No calendar events lined up today|Calendar is not connected/)
 })
 await check(name+' retains successful known-empty copy',async()=>assert.match(await build(123,'Fixture'),/No calendar events lined up today/))
}
await check('failed extra-account inventory cannot prove completeness',async()=>{
 extrasError=true;const state=await accounts.getTodayEventsAllAccounts(123,'fixture-primary',getToday);assert.equal(state.incomplete,true)
})
await check('failed linked-account refresh cannot prove completeness',async()=>{
 failedRefresh.add('fixture-extra');const state=await accounts.getTodayEventsAllAccounts(123,'fixture-primary',getToday);assert.equal(state.incomplete,true)
})
await check('dashboard provider error is unavailable, never a successful empty day',async()=>{
 providerStatus=401;const state=await dashboard.getTodayCalendar('123');assert.equal(state.ok,false)
})
await check('dashboard refresh failure is unavailable, not disconnected',async()=>{
 failedRefresh=new Set(['fixture-primary','fixture-extra']);const state=await dashboard.getTodayCalendar('123');assert.equal(state.ok,false)
})
await check('dashboard successful empty read remains known empty',async()=>{
 const state=await dashboard.getTodayCalendar('123');assert.equal(state.ok,true);assert.equal(state.connected,true);assert.equal(state.events.length,0)
})
const readParams={actor:{legacyTelegramId:123},instruction:'Show my calendar today',missionText:'Show my calendar today'}
await check('read-only step labels missing linked-account access incomplete',async()=>{
 failedRefresh.add('fixture-extra');const result=await read.executeReadOnlyCalendarStep(readParams)
 assert.equal(result.output.complete,false);assert.match(result.text,/incomplete/i);assert.doesNotMatch(result.text,/No calendar events found/)
})
await check('availability cannot use partial linked-account access',async()=>{
 failedRefresh.add('fixture-extra');await assert.rejects(()=>read.executeReadOnlyCalendarStep({...readParams,instruction:'Find available slots today',missionText:'Find available slots today'}),/calendar_availability_unverified/)
})
await check('extra-account lookup failure cannot imply complete read',async()=>{
 extrasError=true;const result=await read.executeReadOnlyCalendarStep(readParams);assert.equal(result.output.complete,false)
})
for(const [name,build]of [['briefing',morning.buildMorningBriefing],['day plan',plan.buildPlanMyDayReply]] as const){
 await check(name+' distinguishes successful absent linkage',async()=>{primaryLinked=false;extras=false;assert.match(await build(123,'Fixture'),/Calendar is not connected/);})
 await check(name+' can read an extra account when primary is absent',async()=>{primaryLinked=false;eventRows=[{summary:'Fixture extra account event',start:{dateTime:'2026-10-18T14:00:00+05:30'}}];assert.match(await build(123,'Fixture'),/Fixture extra account event/);})
 await check(name+' preserves healthy extra events if primary token is missing',async()=>{primaryMissing=true;eventRows=[{summary:'Fixture extra account event',start:{dateTime:'2026-10-18T14:00:00+05:30'}}];const reply=await build(123,'Fixture');assert.match(reply,/Fixture extra account event/);assert.match(reply,/incomplete/i);})
}
await check('dashboard retains healthy events with partial access',async()=>{
 failedRefresh.add('fixture-extra');eventRows=[{summary:'Fixture healthy event',start:{dateTime:'2026-10-18T14:00:00+05:30'}}]
 const result=await dashboard.getTodayCalendar('123');assert.equal(result.ok,true);assert.equal(result.incomplete,true);assert.equal(result.events[0].title,'Fixture healthy event')
})
const dayChat=load('lib/dashboard/day-chat.ts',{'@/lib/dashboard/queries':dashboard,'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/calendar-intervals':intervals,'@/lib/timezone':timezone})
for(const intent of ['summary','next','plan'])await check('dashboard '+intent+' cannot imply a free day from incomplete calendars',async()=>{
 const text=dayChat.formatDashboardDayReply({intent,tz:'Asia/Kolkata',remindersOk:true,reminders:[],calendarOk:true,calendarConnected:true,calendarIncomplete:true,calendarEvents:[],now:new Date('2026-10-18T08:00:00Z')})
 assert.match(text,/incomplete|couldn.t|missing/i);assert.doesNotMatch(text,/clear|quiet day|Longest free stretch|Nothing scheduled from now on/i)
})
await check('dashboard preserves a healthy account after another provider read fails',async()=>{
 failedReads.add('fixture-extra');eventRows=[{summary:'Fixture healthy event',start:{dateTime:'2026-10-18T14:00:00+05:30'}}]
 const result=await dashboard.getTodayCalendar('123');assert.equal(result.ok,true);assert.equal(result.incomplete,true);assert.equal(result.events[0].title,'Fixture healthy event')
})
await check('dashboard and read-only path preserve healthy extras when primary token is absent',async()=>{
 primaryMissing=true;eventRows=[{summary:'Fixture extra event',start:{dateTime:'2026-10-18T14:00:00+05:30'}}]
 const view=await dashboard.getTodayCalendar('123');assert.equal(view.ok,true);assert.equal(view.incomplete,true);assert.equal(view.events[0].title,'Fixture extra event')
 const actual=await read.executeReadOnlyCalendarStep(readParams);assert.equal(actual.output.complete,false);assert.match(actual.text,/Fixture extra event/)
 assert.ok(refreshRequests.every(token=>/^fixture-(?:primary|extra)$/.test(token)),'missing token must not become a null/undefined refresh request')
})
let viewState:any={ok:true,connected:true,events:[],incomplete:true}
const jsx=(type:unknown,props:unknown)=>({type:typeof type==='function'?'component':type,props})
function ui(file:string,expose?:string){
 const names=[...readFileSync(file,'utf8').matchAll(/from ['"]([^'"]+)['"]/g)].map(m=>m[1])
 const deps:Record<string,unknown>=Object.fromEntries(names.map(name=>[name,{}]))
 deps['react/jsx-runtime']={jsx,jsxs:jsx};deps['@/lib/dashboard/session']={getSession:async()=>({telegramId:'123'})};deps['@/lib/dashboard/queries']={getTodayCalendar:async()=>viewState}
 return load(file,deps,undefined,expose)
}
const calendarPage=ui('app/dashboard/(app)/calendar/page.tsx')
const desktop=ui('components/dashboard/today-desktop.tsx','CalendarCard')
const mobile=ui('app/dashboard/(app)/today/page.tsx','CalendarRestRow')
for(const [name,build]of [['Calendar page',calendarPage.default],['Today desktop',desktop.__entry],['Today mobile',mobile.__entry]] as const){
 await check(name+' renders partial empty state without clear-day claims',async()=>{
  viewState={ok:true,connected:true,events:[],incomplete:true};const tree=JSON.stringify(await build({telegramId:'123'}))
  assert.match(tree,/incomplete|partly unavailable/i);assert.doesNotMatch(tree,/clear today|quiet|nothing scheduled/i)
 })
 await check(name+' retains known events with the incomplete warning',async()=>{
  viewState={ok:true,connected:true,events:[{id:'fixture',title:'Fixture healthy event',time:'2 PM'}],incomplete:true};const tree=JSON.stringify(await build({telegramId:'123'}))
  assert.match(tree,/Fixture healthy event/);assert.match(tree,/incomplete/i)
 })
}
assert.deepEqual(failures,[],'Calendar failures must remain distinct from successful empty/disconnected state')
console.log('Calendar actual helper, morning briefing, day-plan and dashboard uncertainty regressions passed; no provider mutations.')
