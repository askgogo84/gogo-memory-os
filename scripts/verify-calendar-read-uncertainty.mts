import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

// Actual read/helper/briefing exports with inert transports. No live tokens,
// provider mutations, notifications or reminder writes are allowed here.
let userError=false,extrasError=false,primaryLinked=true,extras=true,providerStatus=200
let failedReads=new Set<string>(),failedRefresh=new Set<string>(),eventRows:any[]=[]
const db={from(table:string){
 assert.ok(['users','google_calendar_accounts','reminders','travel_tickets'].includes(table),table)
 const result=()=>({data:table==='users'?{google_calendar_connected:primaryLinked,google_refresh_token:primaryLinked?'fixture-primary':null,timezone:'Asia/Kolkata',briefing_content:'calendar'}:
  table==='google_calendar_accounts'?(extras?[{email:'extra@example.test',refresh_token:'fixture-extra'}]:[]):[],
 error:(table==='users'&&userError)||(table==='google_calendar_accounts'&&extrasError)?{message:'fixture lookup failed'}:null})
 const q:any={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(String(value),'123');return q},gte:()=>q,lt:()=>q,order:()=>q,limit:()=>q,
  single:async()=>result(),maybeSingle:async()=>result(),then:(resolve:any,reject:any)=>Promise.resolve(result()).then(resolve,reject)}
 return q
}}
async function getToday(token:string){if(failedReads.has(token))throw Error('fixture calendar outage');return eventRows}
const calendar={refreshAccessToken:async(token:string)=>failedRefresh.has(token)?null:token,
 fetchPrimaryCalendarAccount:async()=> 'primary@example.test',getTodayEvents:getToday}
const weather={fetchWeatherForecast:async()=>null,formatCurrentWeather:()=>''}
const followups={saveFollowupState:async(_owner:unknown,_kind:unknown,_data:unknown)=>{}}
function load(file:string,deps:Record<string,unknown>,fetcher?:unknown){
 const exports:any={}
 runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,process,Date,URL,URLSearchParams,console,fetch:fetcher,require:(name:string)=>{assert.ok(name in deps,'Unexpected dependency '+name);return deps[name]}})
 return exports
}
const accounts=load('lib/services/google-calendar-accounts.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/services/google-calendar':calendar})
const deps={'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/services/weather':weather,'@/lib/google-calendar':calendar,'@/lib/services/google-calendar-accounts':accounts,
 '@/lib/limits':{},'./followup-state':followups}
const morning=load('lib/bot/handlers/morning-briefing.ts',deps)
const plan=load('lib/bot/handlers/plan-my-day.ts',deps)
const dashboard=load('lib/dashboard/queries.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/ist':{istDayWindow:()=>({startUtc:new Date('2026-10-18T00:00:00Z'),endUtc:new Date('2026-10-19T00:00:00Z')})},
 '@/lib/services/meter':{},'@/lib/data/limits':{},'@/lib/services/google-calendar-accounts':accounts},async()=>({ok:providerStatus===200,status:providerStatus,json:async()=>({items:eventRows})}))
const failures:string[]=[]
async function check(name:string,fn:()=>Promise<void>){
 userError=false;extrasError=false;primaryLinked=true;extras=true;providerStatus=200;failedReads=new Set();failedRefresh=new Set();eventRows=[]
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
assert.deepEqual(failures,[],'Calendar failures must remain distinct from successful empty/disconnected state')
console.log('Calendar actual helper, morning briefing, day-plan and dashboard uncertainty regressions passed; no provider mutations.')
