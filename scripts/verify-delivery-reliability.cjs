const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const crypto = require('node:crypto')
const ts = require('typescript')
const { PGlite } = require('@electric-sql/pglite')
const { NextResponse } = require('next/server')

function load(file, mocks, env = {}) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module, exports: module.exports, require(id) {
    if (id === 'next/server') return { NextResponse }
    if (id === 'node:crypto') return crypto
    if (Object.hasOwn(mocks, id)) return mocks[id]
    throw Error('Unmocked import: ' + id)
  }, process: { env }, console, URL, Date, Intl, Request, Response, Buffer, AbortSignal })
  return module.exports
}

async function main() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table reminders(id uuid primary key default gen_random_uuid(),telegram_id bigint,chat_id bigint,
    whatsapp_to text,message text,remind_at timestamptz,sent boolean default false,created_at timestamptz default now(),
    is_recurring boolean,recurring_pattern text,timezone text,nudge_count integer,followup_started_at timestamptz,
    fail_attempts integer default 0,last_failed_at timestamptz,sent_at timestamptz,twilio_sid text,delivery_status text);`)
  await db.exec(fs.readFileSync('supabase/reminder-insert-idempotency-20260915.sql','utf8'))
  await db.exec(fs.readFileSync('supabase/migrations/20260925110046_reminder_delivery_leases.sql','utf8'))
  const query = async (sql, params = []) => (await db.query(sql, params)).rows
  const rpc = async (name,args) => {
    const rows = await query(`select * from ${name}(${Object.keys(args).map((k,i)=>k+' => $'+(i+1)).join(',')})`,Object.values(args))
    return name === 'claim_reminder_delivery' ? rows : rows[0]?.[name]
  }
  const add = async (recurring = false) => (await query(`insert into reminders(telegram_id,whatsapp_to,message,remind_at,is_recurring,recurring_pattern)
    values(1,'+15555550100',$1,now()-interval '2 days',$2,$3) returning *`,[crypto.randomUUID(),recurring,recurring?'every_2_hours':null]))[0]
  const row = async id => (await query('select * from reminders where id=$1',[id]))[0]
  const claim = (r,t) => rpc('claim_reminder_delivery',{p_id:r.id,p_token:t})
  const begin = (r,t,next=null) => rpc('begin_reminder_delivery',{p_id:r.id,p_token:t,p_due:r.remind_at,p_next:next,p_timezone:'Asia/Kolkata',p_target:r.whatsapp_to})
  let r=await add(), t=crypto.randomUUID()
  const race=await Promise.all([claim(r,t),claim(r,crypto.randomUUID())])
  assert.equal(race.flat().length,1,'overlapping claims have a single winner')
  await query("update reminders set lease_until=now()-interval '1 second' where id=$1",[r.id])
  const replacement=crypto.randomUUID();assert.equal((await claim(r,replacement)).length,1)
  assert.equal(await begin(r,t),false,'expired worker fenced')
  assert.equal(await begin(r,replacement),true)
  await query("update reminders set lease_until=now()-interval '1 second' where id=$1",[r.id])
  assert.equal((await claim(r,crypto.randomUUID())).length,0,'crash after intent cannot retry')
  assert.equal((await row(r.id)).delivery_state,'outcome_unknown')
  r=await add();t=crypto.randomUUID();await claim(r,t)
  await query('update reminders set sent=true where id=$1',[r.id])
  assert.equal(await begin(r,t),false,'cancel before send blocks provider boundary')
  assert.equal((await row(r.id)).delivery_state,'cancelled')
  r=await add();t=crypto.randomUUID();await claim(r,t)
  await query("update reminders set message='changed' where id=$1",[r.id])
  assert.equal(await begin(r,t),false,'content changes fence stale worker')
  r=await add(true);t=crypto.randomUUID();await claim(r,t)
  await db.exec(`create function fixture_fail_insert() returns trigger language plpgsql as $$begin
    if new.recurrence_parent_id is not null then raise exception 'fixture insert outage'; end if;return new;end$$;
    create trigger fixture_fail before insert on reminders for each row execute function fixture_fail_insert();`)
  const next=new Date(Date.now()+3600000).toISOString()
  await assert.rejects(begin(r,t,next),/fixture insert outage/)
  assert.equal((await row(r.id)).send_started_at,null,'failed recurrence rolls back intent')
  await db.exec('drop trigger fixture_fail on reminders')
  assert.equal(await begin(r,t,next),true)
  assert.equal(await begin(r,t,next),false)
  assert.equal((await query('select * from reminders where recurrence_parent_id=$1',[r.id])).length,1)
  assert.equal(await rpc('retry_reminder_delivery',{p_id:r.id,p_token:t}),false,'unknown is not retryable')
  assert.equal(await rpc('retry_reminder_delivery',{p_id:r.id,p_token:t,p_definite_rejection:true}),true)
  assert.equal((await claim(r,crypto.randomUUID())).length,0,'known rejection has backoff')
  const series=load('lib/services/reminder-series.ts',{'@/lib/supabase-admin':{supabaseAdmin:{}}})
  const delivery=load('lib/services/reminder-delivery.ts',{'@/lib/supabase-admin':{supabaseAdmin:{}},'./reminder-series':series})
  const future=delivery.nextFutureOccurrence('every_2_hours',new Date('2020-01-01T00:00:00Z'),new Date('2026-09-25T11:01:00Z'))
  assert.equal(future.toISOString(),'2026-09-25T12:00:00.000Z')
  assert.throws(()=>delivery.nextFutureOccurrence('every_0_hours',new Date(),new Date()),/invalid/)
  const states=load('lib/services/delivery-state.ts',{})
  for(const state of ['accepted','provider_accepted','sent','queued','outcome_unknown','failed'])assert.equal(states.isVerifiedDelivery(state),false)
  for(const state of ['delivered','read'])assert.equal(states.isVerifiedDelivery(state),true)
  assert.equal(states.isDefiniteProviderRejection({status:400,partialSend:true}),false)

  // Execute the real handler against real SQL RPCs, with provider calls blocked.
  let sends=0, outcome='ok', consent=false, cancelDuringConsent=false, failFinish=false
  const adapter={from(table){
    const q={select:()=>q,eq:()=>q,in:()=>q,lte:()=>q,or:()=>q,order:()=>q,limit:()=>q,maybeSingle:()=>q,
      then(resolve,reject){return (table==='users'?Promise.resolve({data:{whatsapp_id:'+15555550100',timezone:'Asia/Kolkata'}}):
        query("select * from reminders where not sent and delivery_state in ('pending','claimed') and remind_at<=now()").then(data=>({data}))).then(resolve,reject)}}
    return q
  }}
  const send=async()=>{sends++;if(outcome==='unknown')throw Error('socket closed after accepted');return {sid:'SMfixture',status:'queued'}}
  const handler=load('app/api/cron/reminders/route.ts',{
    '@/lib/supabase-admin':{supabaseAdmin:adapter},
    '@/lib/services/reminder-delivery':{...delivery,deliveryRpc:async(name,args)=>{if(failFinish&&name==='finish_reminder_delivery')throw Error('fixture write outage');return rpc(name,args)}},
    '@/lib/services/delivery-state':states,
    '@/lib/services/reminder-series':series,
    '@/lib/whatsapp':{sendWhatsApp:send,sendWhatsAppReminderTemplate:send,sendWhatsAppReminderButtons:send},
    '@/lib/bot/handlers/reminder-optout':{isSuppressed:async()=>{if(cancelDuringConsent)await query('update reminders set sent=true where not sent');return consent}}
  },{CRON_SECRET:'fixture',TWILIO_REMINDER_CONTENT_SID:'fixture'})
  const req=()=>new Request('https://fixture.invalid/api/cron/reminders',{headers:{authorization:'Bearer fixture'}})
  await query('delete from reminders');r=await add()
  const replies=await Promise.all([handler.GET(req()),handler.GET(req())]);assert.equal(sends,1)
  assert.equal((await row(r.id)).delivery_state,'provider_accepted')
  assert.equal(states.isVerifiedDelivery((await row(r.id)).delivery_state),false)
  for(const reply of replies)assert.equal(reply.status,200)
  await query('delete from reminders');r=await add();sends=0;outcome='unknown'
  assert.equal((await handler.GET(req())).status,503);await handler.GET(req());assert.equal(sends,1)
  assert.equal((await row(r.id)).delivery_state,'outcome_unknown')
  await query('delete from reminders');r=await add();sends=0;outcome='ok';failFinish=true
  assert.equal((await handler.GET(req())).status,503);await handler.GET(req());assert.equal(sends,1,'DB failure after send never retries')
  assert.equal((await row(r.id)).delivery_state,'outcome_unknown')
  await query('delete from reminders');r=await add();sends=0;failFinish=false;cancelDuringConsent=true
  await handler.GET(req());assert.equal(sends,0)
  await query('delete from reminders');r=await add();cancelDuringConsent=false;consent=true
  await handler.GET(req());assert.equal(sends,0);assert.equal((await row(r.id)).delivery_state,'suppressed')
  assert.equal((await handler.GET(new Request('https://fixture.invalid'))).status,401)
  await db.close()
  console.log('Delivery reliability: SQL leases, recurrence rollback, stale fencing, concurrency, cancellation, consent, crash/DB failure, unknown no-retry passed')
}
main().catch(e=>{console.error(e);process.exitCode=1})
