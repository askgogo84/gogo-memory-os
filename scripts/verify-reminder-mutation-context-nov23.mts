import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as timezone from '../lib/timezone'

const command='Move my existing Askgogo<>Fund Raise reminder today to 4:20 pm IST. The meeting starts at 4:30 pm. Update the existing reminder; do not create another.'
let now=Date.parse('2026-11-23T09:05:00Z')
class FixtureDate extends Date {constructor(value?:any){super(value===undefined?now:value)}static now(){return now}}
const fund={id:'fund',telegram_id:-42,message:'Askgogo<>Fund Raise — starts 23 Nov 2026, 5:00 pm\nhttps://meet.google.com/ycz-gire-akz',remind_at:'2026-11-23T11:20:00.000Z',timezone:'Asia/Kolkata',sent:false,is_recurring:false,recurring_pattern:null,delivery_state:'pending',claim_token:null,send_started_at:null,created_at:'2026-11-20T00:00:00Z'}
const water={...fund,id:'water',message:'Drink water'}
let rows:any[]=[],history:any[]=[],reads:string[]=[],writes:any[]=[],applied=0,scenario=''
function reset(){
  now=Date.parse('2026-11-23T09:05:00Z');scenario='';reads=[];writes=[];applied=0
  rows=[{...fund},{...water},{...fund,id:'demo',message:'on WhatsApp check AskGogo demo verification 23 Nov 13',sent:true}, {...fund,id:'foreign',telegram_id:-43}]
  history=[{telegram_id:-42,role:'assistant',content:'✅ Reminder set\n\non WhatsApp check AskGogo demo verification 23 Nov 13\ntoday at 2:24 pm.'}]
}
const database={from(table:string){
  assert.ok(['users','conversations','reminders'].includes(table),'no fallback creation/run/list/provider tables')
  reads.push(table)
  let filters:((r:any)=>boolean)[]=[],payload:any=null,single=false,maximum=Infinity
  const q:any={
    select:()=>q,
    eq(k:string,v:any){filters.push(r=>r[k]===v);return q},
    is(k:string,v:any){filters.push(r=>r[k]===v);return q},
    order:()=>q,limit(n:number){maximum=n;return q},
    update(p:any){assert.equal(table,'reminders');payload=p;return q},
    maybeSingle(){single=true;return q},
    then(resolve:any,reject:any){
      if(payload&&scenario==='race-claim')rows[0].claim_token='worker'
      if(payload&&scenario==='race-edit')rows[0].message='Changed concurrently'
      if(payload&&scenario==='race-timezone')rows[0].timezone='Europe/London'
      if(payload&&scenario==='race-recurring')rows[0].is_recurring=true
      let data=(table==='reminders'?rows:table==='conversations'?history:[{telegram_id:-42,timezone:'Asia/Kolkata'}]).filter(r=>filters.every(f=>f(r))).slice(0,maximum)
      if(payload){
        writes.push(payload)
        assert.ok(data.every(r=>r.telegram_id===-42&&r.id!=='foreign'),'write is exact-owner scoped')
        if(scenario==='write-error')return Promise.resolve({data:null,error:{message:'fixture'}}).then(resolve,reject)
        for(const row of data){Object.assign(row,payload);applied++}
      }else if(table==='reminders'&&single&&applied){
        if(scenario==='readback-error')return Promise.resolve({data:null,error:{message:'fixture'}}).then(resolve,reject)
        if(scenario==='readback-mismatch')data=data.map(r=>({...r,remind_at:'2026-11-23T12:00:00Z'}))
      }
      return Promise.resolve({data:single?data[0]||null:data,error:null}).then(resolve,reject)
    },
  }
  return q
}}
const actual:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/compound-planner.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:actual,Date:FixtureDate,Intl,console,
  require:(name:string)=>{
    if(name==='@/lib/supabase-admin')return {supabaseAdmin:database}
    if(name==='@/lib/timezone')return timezone
    if(name==='./typed-object-context')return {rememberTypedObjects:()=>{throw new Error('no unrelated context mutation')}}
    if(name==='@/lib/bot/reminder-dedup')return {isInternalPlanStepReminder:()=>false}
    if(name==='@/lib/data/lists'||name==='./same-brain')return new Proxy({}, {get(){throw new Error('no fallback dispatch/list writes')}})
    throw new Error('Unexpected dependency '+name)
  },
})
const run=(text=command,owner:any=-42)=>actual.tryRunExpiryReminderPlan({actor:{legacyTelegramId:owner},surface:'whatsapp',text})
reset()
const result=await run()
assert.equal(result.status,'completed');assert.match(result.text,/Reminder updated/)
assert.equal(applied,1);assert.equal(rows[0].id,'fund');assert.equal(rows[0].remind_at,'2026-11-23T10:50:00.000Z')
assert.match(rows[0].message,/4:30 pm/);assert.doesNotMatch(rows[0].message,/5:00 pm/)
assert.equal(rows[3].remind_at,fund.remind_at);assert.equal(rows[1].remind_at,water.remind_at)
assert.ok(!reads.includes('conversations'),'explicit named reminder must never consult unrelated recent context')
assert.equal(rows.length,4,'updates never insert a replacement')
reset();assert.equal((await run(command.replace('to 4:20 pm','to4:20pm'))).status,'completed');assert.equal(rows[0].remind_at,'2026-11-23T10:50:00.000Z','compact handset time separator retains the same explicit target')

for(const text of ['Move my existing Askgogo<>Fund Raise reminder today to 4:20 pm', 'Move the “Askgogo<>Fund Raise” reminder to 4:20 pm today', 'Please reschedule Askgogo<>Fund Raise reminder to 4:20 pm']){
  reset();assert.equal((await run(text)).status,'completed',text);assert.equal(applied,1)
}
reset();assert.equal((await run('Move Askgogo<>Fund Raise reminder to 4:20 pm IST tomorrow')).status,'completed');assert.equal(rows[0].remind_at,'2026-11-24T10:50:00.000Z')
for(const title of ['Call at 5 pm','Say reminder to 5 pm']){
  reset();rows[0].message=title;assert.equal((await run(`Move my “${title}” reminder today to 4:20 pm IST`)).status,'completed');assert.equal(rows[0].remind_at,'2026-11-23T10:50:00.000Z','title clock must not replace requested new clock')
}
reset();assert.equal((await run(command.replace('starts at 4:30 pm','starts at 4:30 pm UTC'))).status,'failed');assert.equal(writes.length,0)
for(const tail of [' tomorrow',' IST tomorrow',' on 24 November',' on 2026-11-24']){
  reset();assert.equal((await run(command.replace('starts at 4:30 pm.','starts at 4:30 pm'+tail+'.'))).status,'failed');assert.equal(writes.length,0,'explicit meeting date must never be replaced by the alert date')
}
for(const text of ['Create a reminder to update my passport tomorrow','Make a reminder to update my passport tomorrow','Remind me tomorrow to change my passport']){
  reset();assert.equal(await run(text),null,'creation/task-body verbs must reach their own handlers');assert.equal(reads.length,0)
}
for(const text of ['Move Askgogo<>Fund Raise reminder today to 4:20 pm IST tomorrow','Move reminder today to 4:20 pm IST for Fund Raise','Move Askgogo<>Fund Raise reminder to 4:20 pm IST on Tuesday','Move Askgogo<>Fund Raise reminder to 4:20 pm IST or 5 pm']){
  reset();assert.equal((await run(text)).status,'failed',text);assert.equal(writes.length,0)
}
reset();history=[{telegram_id:-42,role:'assistant',content:'✅ Reminder set\n\nDrink water\ntoday at 4:50 pm.'}]
assert.equal((await run('Move that reminder today to 4:20 pm')).status,'completed');assert.equal(rows[1].remind_at,'2026-11-23T10:50:00.000Z');assert.equal(rows[0].remind_at,fund.remind_at)
reset();rows.push({...fund,id:'duplicate'});assert.match((await run()).text,/which time/);assert.equal(applied,0)
reset();rows=rows.filter(r=>r.id!=='fund');assert.match((await run()).text,/Askgogo<>Fund Raise/);assert.equal(applied,0);assert.ok(!reads.includes('conversations'))
for(const changes of [{claim_token:'worker'},{send_started_at:'2026-11-23T09:00:00Z'},{delivery_state:'unknown_unconfirmed'},{is_recurring:true},{recurring_pattern:'daily'}]){
  reset();Object.assign(rows[0],changes);assert.equal((await run()).status,'failed');assert.equal(writes.length,0)
}
for(const failure of ['race-claim','race-edit','race-timezone','race-recurring','write-error','readback-error','readback-mismatch']){
  reset();scenario=failure;assert.equal((await run()).status,'failed',failure);assert.equal(writes.length,1,'no retry after uncertain write')
  if(failure.startsWith('race')||failure==='write-error')assert.equal(applied,0)
}
for(const owner of [0,NaN,Infinity,1.5,9007199254740992,null,undefined,'-42']){
  reset();assert.equal((await run(command,owner===undefined?{}:owner)).status,'failed');assert.equal(reads.length,0)
}
for(const text of ['Move <> reminder to 4:20 pm','Move my reminder about Fund Raise to 4:20 pm','Move Askgogo<>Fund Raise reminder today to 4:20 pm tomorrow','Move Askgogo<>Fund Raise reminder to 13:20 pm','Move Askgogo<>Fund Raise reminder to 4:99 pm','Move Askgogo<>Fund Raise reminder today to 1:00 pm','Move Askgogo<>Fund Raise reminder today to 4:20 pm UTC']){
  reset();assert.equal((await run(text)).status,'failed',text);assert.equal(writes.length,0)
}
reset();now=Date.parse('2026-11-23T20:00:00Z')
assert.equal((await run('Move Askgogo<>Fund Raise reminder tomorrow to 4:20 pm')).status,'completed')
assert.equal(rows[0].remind_at,'2026-11-25T10:50:00.000Z','tomorrow is next local day, not 36 hours later')
reset();rows[0].timezone='America/New_York'
assert.equal((await run('Move Askgogo<>Fund Raise reminder today to 4:20 pm')).status,'completed')
assert.equal(rows[0].remind_at,'2026-11-23T21:20:00.000Z','stored non-India timezone must not be treated as UTC')
for(const zone of ['America/Indiana/Indianapolis','America/Argentina/Buenos_Aires']){
  reset();rows[0].timezone=zone
  assert.equal((await run(`Move Askgogo<>Fund Raise reminder today to 4:20 pm ${zone}`)).status,'completed','complete three-component IANA timezone is retained')
}
for(const zone of ['America/New_York/Invalid','UTC+05:30']){
  reset();rows[0].timezone='UTC';assert.equal((await run(`Move Askgogo<>Fund Raise reminder today to 4:20 pm ${zone}`)).status,'failed');assert.equal(writes.length,0,'never validate just a truncated timezone prefix')
}
for(const [date,clock] of [['2026-11-01T06:00:00Z','1:30 am'],['2026-03-08T06:00:00Z','2:30 am']]){
  reset();now=Date.parse(date)-86400000;rows[0].timezone='America/New_York';rows[0].remind_at=date
  assert.equal((await run(`Move Askgogo<>Fund Raise reminder to ${clock}`)).status,'failed');assert.equal(writes.length,0,'ambiguous/nonexistent local clocks never write')
}
reset();rows=Array.from({length:101},(_,i)=>({...fund,id:String(i)}));assert.equal((await run()).status,'failed');assert.equal(writes.length,0)
console.log('PASS: actual compound entry point preserves explicit named reminder over recent context; owner, one-off state, timezones/day, CAS, exact read-back and no-insert/no-retry controls')
