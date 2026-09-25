import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detectReadOnlyScheduleRequest, readTomorrowSchedule, nextLocalDateKey } from '../lib/agent/read-only-schedule'
import { supabaseAdmin } from '../lib/supabase-admin'

for(const text of ['What do I have on my calendar tomorrow?','Show my calendar tomorrow','What meetings do I have tomorrow?'])assert.equal(detectReadOnlyScheduleRequest(text)?.scope,'calendar',text)
for(const text of ['What do I have tomorrow?','What is my day tomorrow?','Plan my day tomorrow','Show my calendar and reminders tomorrow',"Tell me what's on tomorrow. Don't change my calendar."])assert.equal(detectReadOnlyScheduleRequest(text)?.scope,'agenda',text)
for(const text of ['Remind me to check my calendar tomorrow','Create a calendar event tomorrow','Move my meeting tomorrow','Check the weather tomorrow','Tell me the flight prices tomorrow','Show my reminders tomorrow','Check sunrise tomorrow','Review the news tomorrow'])assert.equal(detectReadOnlyScheduleRequest(text),null,text)

async function main(){
 const original=supabaseAdmin.from,originalFetch=globalThis.fetch
 const tables:string[]=[],http:string[]=[];let failCalendar=false,empty=false
 const tomorrow=nextLocalDateKey(new Date(),'Asia/Kolkata')
 ;(supabaseAdmin as any).from=(table:string)=>{
  tables.push(table)
  assert.ok(['users','reminders'].includes(table),'no Attention or watcher reads')
  const result={error:null,data:table==='users'?{timezone:'Asia/Kolkata',google_calendar_connected:true,google_refresh_token:'fixture-refresh'}:[{message:'Travel reminder fixture',remind_at:tomorrow+'T09:00:00+05:30',sent:false}]}
  const q:any={then:(r:any)=>Promise.resolve(result).then(r),maybeSingle:async()=>result}
  for(const method of ['select','eq','gte','lt','order'])q[method]=()=>q
  return q // No insert/update/delete method: any mutation fails the test.
 }
 globalThis.fetch=(async(url:any,opts:any)=>{
  const u=String(url);http.push(u)
  if(u==='https://oauth2.googleapis.com/token')return new Response(JSON.stringify({access_token:'fixture-access'}))
  assert.match(u,/googleapis.com\/calendar\/v3\/calendars\/primary\/events\?/)
  assert.ok(!opts.method||opts.method==='GET','calendar read never creates an event')
  return new Response(JSON.stringify({items:empty?[]:[{id:'fixture-event',summary:'Calendar event fixture',start:{dateTime:tomorrow+'T11:00:00+05:30'},end:{dateTime:tomorrow+'T12:00:00+05:30'}}]}),{status:failCalendar?503:200})
 }) as typeof fetch
 try{
  const actor={legacyTelegramId:123} as any
  const calendar=await readTomorrowSchedule({actor,scope:'calendar'})
  assert.match(calendar.text,/Calendar event fixture/)
  assert.doesNotMatch(calendar.text,/reminder|attention|watcher/i)
  assert.equal(calendar.calendarReadVerified,true);assert.ok(!tables.includes('reminders'))
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
 for(const path of ['app/api/dashboard/chat/route.ts','app/api/agent/run/route.ts','app/api/webhooks/whatsapp/route.ts'])assert.match(readFileSync(path,'utf8'),/readTomorrowSchedule\(\{ actor, scope:/,path)
 console.log('Calendar presentation: real provider reader, calendar-only/combined scopes, no reminder writes, empty and failed reads passed')
}
main().catch(e=>{console.error(e);process.exitCode=1})
