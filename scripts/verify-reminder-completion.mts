import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {reminderStateLabel} from '../lib/dashboard/reminder-state'

const source=readFileSync('lib/bot/handlers/reminder-completion.ts','utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function fixture(failWrite=false){
  const recent=new Date().toISOString()
  const rows:any[]=[
    {id:'water',telegram_id:100,twilio_sid:'SM-water',message:'Drink water',sent:true,sent_at:recent,status:'pending',is_recurring:true},
    {id:'aqua',telegram_id:100,twilio_sid:'SM-aqua',message:'Aqua appointment',sent:true,sent_at:recent,status:'pending',is_recurring:false},
    {id:'future-water',telegram_id:100,message:'Drink water',sent:false,status:'pending',is_recurring:true},
    {id:'other',telegram_id:200,twilio_sid:'SM-other',message:'Other user',sent:true,sent_at:recent,status:'pending'},
  ]
  let writes=0
  const db={from(table:string){
    assert.equal(table,'reminders')
    let filters:Array<(r:any)=>boolean>=[],patch:any=null,limit=Infinity
    const resolve=()=>{
      const found=rows.filter(r=>filters.every(f=>f(r))).slice(0,limit)
      if(patch){
        if(failWrite)return {data:null,error:{message:'injected write failure'}}
        for(const r of found)Object.assign(r,patch)
        writes+=found.length
      }
      return {data:found,error:null}
    }
    const q:any={
      select(){return q},eq(k:string,v:any){filters.push(r=>r[k]===v);return q},
      gte(k:string,v:any){filters.push(r=>r[k]>=v);return q},order(){return q},limit(n:number){limit=n;return q},
      update(p:any){patch=p;return q},
      async maybeSingle(){const r=resolve();return {...r,data:r.data?.[0]||null}},
      then(ok:any,bad:any){return Promise.resolve(resolve()).then(ok,bad)},
    }
    return q
  }}
  const exports:any={}
  runInNewContext(compiled,{exports,module:{exports},require:(name:string)=>{
    assert.equal(name,'@/lib/supabase-admin');return {supabaseAdmin:db}
  },Date})
  return {rows,complete:exports.completeReminderOccurrence,writes:()=>writes}
}

{
  const f=fixture()
  assert.match(await f.complete(100,'SM-water'),/This occurrence is closed.*recurring schedule stays active/)
  assert.equal(f.rows[0].status,'completed')
  assert.equal(f.rows[1].status,'pending','newer/different occurrence is unchanged')
  assert.equal(f.rows[2].sent,false,'next recurring occurrence must still fire')
  assert.equal(f.rows[2].status,'pending')
  assert.match(await f.complete(100,'SM-water'),/Already done/)
  assert.equal(f.writes(),1,'repeated Done is idempotent')
  assert.equal(reminderStateLabel(f.rows[0]),'Done','dashboard reads the same saved completion')
}
{
  const f=fixture()
  assert.match(await f.complete(100),/specific reminder/,'two recent reminders require identity')
  assert.match(await f.complete(100,'SM-other'),/specific reminder/,'foreign owner cannot be mutated')
  assert.match(await f.complete(100,'SM-missing'),/specific reminder/,'unknown quoted message never falls back')
  assert.equal(f.writes(),0)
  f.rows[1].sent=false
  assert.match(await f.complete(100),/This occurrence is closed/,'one recent occurrence is unambiguous')
}
{
  const f=fixture(true)
  await assert.rejects(()=>f.complete(100,'SM-aqua'),/completion_write_failed/)
  assert.equal(f.rows[1].status,'pending')
}
assert.equal(reminderStateLabel({sent:true,delivery_state:'provider_accepted'}),'Sent — delivery unconfirmed')
assert.equal(reminderStateLabel({sent:true,delivery_state:'read'}),'Read')
assert.equal(reminderStateLabel({sent:true,delivery_state:'outcome_unknown'}),'Delivery unverified')
console.log('PASS: occurrence-bound Done, durable completion, unchanged recurrence, tenant isolation, ambiguity, write failure and dashboard truth')
