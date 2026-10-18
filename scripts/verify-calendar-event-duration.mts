import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as intervals from '../lib/calendar-intervals'
import * as timezone from '../lib/timezone'

// A real linked-provider input exposed this shape; titles/IDs here are synthetic.
// Exercise the actual dashboard projection and formatter, with no provider writes.
const event=(start='2026-10-18T14:00:00+05:30',end='2026-10-18T18:00:00+05:30')=>({id:'synthetic-event',summary:'Synthetic afternoon appointment',start:{dateTime:start},end:{dateTime:end}})
let providerEvents:any[]=[event()]
function load(file:string,deps:Record<string,unknown>,fetcher?:unknown){
 const exports:any={}
 runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:(name:string)=>{assert.ok(name in deps,'Unexpected dependency '+name);return deps[name]},Date,Intl,URL,URLSearchParams,console,fetch:fetcher})
 return exports
}
const db={from(table:string){assert.equal(table,'users');const q={select:()=>q,eq:(key:string,value:unknown)=>{assert.equal(key,'telegram_id');assert.equal(value,123);return q},maybeSingle:async()=>({data:{google_calendar_connected:true,google_refresh_token:'fixture-only',timezone:'Asia/Kolkata'},error:null})};return q}}
const accounts=load('lib/services/google-calendar-accounts.ts',{'@/lib/supabase-admin':{},'@/lib/services/google-calendar':{}})
const query=load('lib/dashboard/queries.ts',{'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/ist':{istDayWindow:()=>({startUtc:new Date('2026-10-17T18:30:00Z'),endUtc:new Date('2026-10-18T18:30:00Z')})},
 '@/lib/services/meter':{},'@/lib/data/limits':{},'@/lib/calendar-intervals':intervals,'@/lib/services/google-calendar-accounts':{getCalendarAccountAccess:async()=>[{accessToken:'fixture-only',email:'synthetic@example.test'}],mergeAccountEvents:accounts.mergeAccountEvents}},
 async(_url:unknown,init:any)=>{assert.ok(!init.method||init.method==='GET');return {ok:true,json:async()=>({items:providerEvents})}})
const day=load('lib/dashboard/day-chat.ts',{'@/lib/dashboard/queries':query,'@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/calendar-intervals':intervals,'@/lib/timezone':timezone})
async function plan(now:string){
 const projected=await query.getTodayCalendar('123');assert.equal(projected.ok,true);assert.equal(projected.connected,true);assert.equal(projected.incomplete,false)
 const reply=day.formatDashboardDayReply({intent:'plan',tz:'Asia/Kolkata',remindersOk:true,reminders:[],calendarOk:true,calendarConnected:true,calendarIncomplete:false,calendarEvents:projected.events,now:new Date(now)})
 return {reply,projected}
}
const failures:string[]=[]
async function check(name:string,fn:()=>Promise<void>){providerEvents=[event()];try{await fn();console.log('PASS '+name)}catch(error){failures.push(name+': '+(error instanceof Error?error.message:String(error)).slice(0,400))}}
await check('actual projection retains provider end',async()=>{const {projected}=await plan('2026-10-18T13:00:00+05:30');assert.equal(projected.events[0].endAt,'2026-10-18T18:00:00+05:30')})
for(const [label,now]of [['before','13:00'],['during','15:00']] as const)await check(label+' multi-hour event never reports occupied hours free',async()=>{
 const {reply}=await plan(`2026-10-18T${now}:00+05:30`);assert.match(reply,/Synthetic afternoon appointment/);assert.match(reply,/Longest free stretch: 6:00 PM/);assert.doesNotMatch(reply,/Nothing scheduled from now on|Longest free stretch: (?:2:30|3:00) PM/)
})
await check('after verified end event leaves remaining timeline',async()=>{const {reply}=await plan('2026-10-18T19:00:00+05:30');assert.doesNotMatch(reply,/Synthetic afternoon appointment/);assert.match(reply,/Longest free stretch: 7:00 PM/)})
await check('genuine thirty-minute event retains its actual short duration',async()=>{providerEvents=[event(undefined,'2026-10-18T14:30:00+05:30')];assert.match((await plan('2026-10-18T13:00:00+05:30')).reply,/Longest free stretch: 2:30 PM/)})
await check('overlapping busy intervals merge through their actual latest end',async()=>{providerEvents=[event(),{...event('2026-10-18T17:00:00+05:30','2026-10-18T19:00:00+05:30'),id:'overlap'}];assert.match((await plan('2026-10-18T15:00:00+05:30')).reply,/Longest free stretch: 7:00 PM/)})
await check('ongoing cross-midnight event blocks until its verified morning end',async()=>{providerEvents=[event('2026-10-17T23:00:00+05:30','2026-10-18T07:00:00+05:30')];const {reply}=await plan('2026-10-18T06:30:00+05:30');assert.match(reply,/Synthetic afternoon appointment/);assert.match(reply,/Longest free stretch: 7:00 AM/)})
await check('all-day opaque event blocks the whole remaining day',async()=>{providerEvents=[{id:'all-day',summary:'Synthetic all-day appointment',start:{date:'2026-10-18'},end:{date:'2026-10-19'}}];const {reply}=await plan('2026-10-18T15:00:00+05:30');assert.match(reply,/Synthetic all-day appointment/);assert.doesNotMatch(reply,/Longest free stretch/)})
for(const kind of ['missing','reversed','unspecified'])await check(kind+' end cannot support a free-stretch claim',async()=>{
 const row:any=event();if(kind==='missing')delete row.end;else if(kind==='reversed')row.end={dateTime:'2026-10-18T13:00:00+05:30'};else row.endTimeUnspecified=true;providerEvents=[row]
 const {reply}=await plan('2026-10-18T15:00:00+05:30');assert.match(reply,/Synthetic afternoon appointment/);assert.match(reply,/unverified|unknown|incomplete|couldn.t/i);assert.doesNotMatch(reply,/Longest free stretch|Nothing scheduled from now on/)
})
for(const kind of ['transparent','declined'])await check(kind+' event does not invent busy time',async()=>{
 providerEvents=[{...event(),...(kind==='transparent'?{transparency:'transparent'}:{attendees:[{self:true,responseStatus:'declined'}]})}]
 assert.match((await plan('2026-10-18T15:00:00+05:30')).reply,/Longest free stretch: 3:00 PM/)
})
await check('complete genuinely empty day still permits a verified free stretch',async()=>{providerEvents=[];assert.match((await plan('2026-10-18T15:00:00+05:30')).reply,/Longest free stretch: 3:00 PM/)})
assert.deepEqual(failures,[],'Calendar intervals must come from provider evidence, never an invented thirty-minute duration')
console.log('Actual dashboard Calendar projection and day-plan duration/unknown/all-day/overlap controls passed; synthetic read-only fixtures.')
