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
  }, process: { env }, console, URL, Date, Intl, Request, Response, Buffer, AbortSignal,
    fetch: mocks.fetch || (()=>{throw Error('Unexpected network call in fixture')}) })
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
  await db.exec(fs.readFileSync('supabase/migrations/20260925111441_delivery_callback_inbox.sql','utf8'))
  await db.exec(fs.readFileSync('supabase/migrations/20260925112633_notification_delivery_jobs.sql','utf8'))
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
  // Signed callback boundary: durable before ACK, matching before SID persistence,
  // chunk completeness and monotonic evidence under delayed/out-of-order events.
  const twilio=require('twilio')
  const callbackHelpers=load('lib/services/delivery-callback.ts',{'./reminder-delivery':{deliveryRpc:rpc}})
  let inboxFail=false,reconcileFail=false
  const callback=load('app/api/webhooks/twilio-status/route.ts',{
    twilio:{default:twilio},'@/lib/services/delivery-callback':callbackHelpers,
    '@/lib/services/reminder-delivery':{deliveryRpc:(name,args)=>{
      if(inboxFail&&name==='ingest_delivery_callback')throw Error('fixture inbox outage')
      if(reconcileFail&&name==='reconcile_delivery_receipt')throw Error('fixture processing outage')
      return rpc(name,args)
    }}
  },{TWILIO_AUTH_TOKEN:'fixture-token',TWILIO_STATUS_CALLBACK_URL:'https://fixture.invalid/callback'})
  const post=async(sid,status,token,chunk=1,chunks=1,bad=false)=>{
    const url=callbackHelpers.deliveryCallbackUrl('https://fixture.invalid/callback',token,chunk,chunks)
    const params={MessageSid:sid,MessageStatus:status}
    const signature=bad?'bad':twilio.getExpectedTwilioSignature('fixture-token',url,params)
    return callback.POST(new Request(url,{method:'POST',headers:{'x-twilio-signature':signature},body:new URLSearchParams(params)}))
  }
  await query('delete from reminders');r=await add();t=crypto.randomUUID();await claim(r,t);await begin(r,t)
  assert.equal((await post('SMfirst','delivered',t,1,2,true)).status,403)
  assert.equal((await query('select * from delivery_callback_inbox')).length,0)
  inboxFail=true;assert.equal((await post('SMfirst','delivered',t,1,2)).status,503);inboxFail=false
  reconcileFail=true;assert.equal((await post('SMfirst','delivered',t,1,2)).status,200);reconcileFail=false
  assert.equal((await query('select * from delivery_callback_inbox')).length,1)
  await rpc('reconcile_delivery_callbacks',{})
  assert.equal((await row(r.id)).delivery_state,'outcome_unknown','one delivered chunk does not verify two')
  assert.equal((await post('SMsecond','read',t,2,2)).status,200)
  assert.equal((await row(r.id)).delivery_state,'delivered')
  await post('SMfirst','read',t,1,2);assert.equal((await row(r.id)).delivery_state,'read')
  await post('SMfirst','queued',t,1,2);await post('SMsecond','failed',t,2,2)
  assert.equal((await row(r.id)).delivery_state,'read','late failures/acceptance cannot regress read')
  await rpc('finish_reminder_delivery',{p_id:r.id,p_token:t,p_state:'provider_accepted',p_sid:'SMsecond'})
  assert.equal((await row(r.id)).delivery_state,'read','late acceptance write cannot regress callback')
  const count=(await query('select * from delivery_callback_inbox')).length
  await post('SMfirst','read',t,1,2)
  assert.equal((await query('select * from delivery_callback_inbox')).length,count,'callback replay deduplicated')
  await post('SMearly','delivered')
  await rpc('reconcile_delivery_callbacks',{})
  r=await add();await query("update reminders set twilio_sid='SMearly',sent=true,delivery_state='provider_accepted' where id=$1",[r.id])
  await query("update delivery_callback_inbox set retry_at=now() where provider_sid='SMearly'")
  await rpc('reconcile_delivery_callbacks',{})
  assert.equal((await row(r.id)).delivery_state,'delivered','unmatched early legacy callback survives until SID write')
  await assert.rejects(rpc('record_delivery_receipt',{p_sid:'fake',p_status:'delivered',p_verified:false}),/acceptance_cannot/)
  r=await add();t=crypto.randomUUID();await claim(r,t);await begin(r,t)
  await rpc('finish_reminder_delivery',{p_id:r.id,p_token:t,p_state:'provider_accepted',p_sid:'SMold-snooze'})
  await query("update reminders set sent=false,remind_at=now()+interval '10 minutes' where id=$1",[r.id])
  assert.equal((await row(r.id)).delivery_state,'pending','legacy snooze re-arms a consumed reminder')
  assert.equal((await row(r.id)).twilio_sid,null)
  await post('SMold-snooze','delivered',t)
  assert.equal((await row(r.id)).delivery_state,'pending','old callback cannot complete rescheduled occurrence')
  // Shared notification protocol is exercised with actual PostgreSQL RPCs.
  const notifications=load('lib/services/notification-delivery.ts',{
    './reminder-delivery':{deliveryRpc:rpc},'./delivery-state':states,'@/lib/supabase-admin':{supabaseAdmin:adapter}
  })
  let notifySends=0
  const notify=(key,overrides={})=>notifications.deliverNotification({key,source:'briefing',owner:1,channel:'whatsapp',due:new Date().toISOString(),
    prepare:async()=>{},ready:async()=>true,send:async()=>{notifySends++;return 'SM-'+key},deadline:Date.now()+10000,...overrides})
  const notificationsRace=await Promise.all([notify('race'),notify('race')])
  assert.equal(notifySends,1);assert.ok(notificationsRace.includes('provider_accepted'))
  await notify('cancel',{ready:async()=>false});assert.equal(notifySends,1)
  await notify('timeout',{send:async()=>{notifySends++;throw Error('ambiguous')}})
  await notify('timeout');assert.equal(notifySends,2,'notification ambiguous outcome cannot retry')
  const failedLegacy=await notify('legacy-log-failure',{accepted:async()=>{throw Error('legacy persistence failed')}})
  assert.notEqual(failedLegacy,'provider_accepted');await notify('legacy-log-failure');assert.equal(notifySends,3)
  const job=(await query("select * from notification_deliveries where delivery_key='race'"))[0]
  await post('SM-race','delivered',job.claim_token)
  assert.equal((await query("select state from notification_deliveries where delivery_key='race'"))[0].state,'delivered')
  // Actual briefing route paginates beyond the old 150-user cap, including negative
  // legacy IDs, catches up later today, and propagates final preferences into ready.
  let scanCursor=null,seen=[],disabled=false
  const users=Array.from({length:161},(_,i)=>({telegram_id:i-80,name:'Fixture',whatsapp_id:'+15555550100',briefing_enabled:true,briefing_time:'00:00'}))
  const briefingDb={from(table){let after=-Infinity,id=null,payload,write=false;const q={
    select:()=>q,or:()=>q,order:()=>q,limit:()=>q,gt:(k,v)=>{after=v;return q},eq:(k,v)=>{if(k==='telegram_id')id=v;return q},maybeSingle:()=>q,
    upsert:p=>{write=true;payload=p;return q},then(resolve,reject){
      if(table==='delivery_scan_cursors'){if(write)scanCursor=payload.cursor_value;return Promise.resolve({data:scanCursor===null?null:{cursor_value:scanCursor}}).then(resolve,reject)}
      if(table==='memories')return Promise.resolve({data:[]}).then(resolve,reject)
      const data=id!==null?{...users.find(u=>u.telegram_id===id),briefing_enabled:!disabled}:users.filter(u=>u.telegram_id>after).slice(0,50)
      return Promise.resolve({data}).then(resolve,reject)
    }};return q}}
  const briefing=load('app/api/cron/daily-briefings/route.ts',{
    '@/lib/security/cron-auth':{isCronAuthorized:()=>true},'@/lib/whatsapp':{},
    '@/lib/services/notification-delivery':{reconcileBriefingEmailReceipts:async()=>0,deliverNotification:async p=>{seen.push(p.owner);assert.equal(await p.ready(),!disabled);return 'skipped'}},
    '@/lib/bot/handlers/reminder-optout':{isSuppressed:async()=>false},'@/lib/supabase-admin':{supabaseAdmin:briefingDb},
    '@/lib/bot/handlers/morning-briefing':{},'@/lib/bot/handlers/throwback':{},'@/lib/email/resend':{},'@/lib/email/daily-brief':{},'@/lib/email/daily-brief-unsubscribe':{}
  })
  assert.equal((await briefing.GET(req())).status,200);assert.equal(seen.length,161);assert.ok(seen.includes(-80))
  seen=[];disabled=true;await briefing.GET(req());assert.equal(seen.length,161)
  const mailKey='email-receipt',mailToken=crypto.randomUUID()
  await rpc('claim_notification_delivery',{p_key:mailKey,p_source:'briefing',p_owner:1,p_channel:'email',p_due:new Date().toISOString(),p_token:mailToken})
  await rpc('begin_notification_delivery',{p_key:mailKey,p_token:mailToken})
  await rpc('finish_notification_delivery',{p_key:mailKey,p_token:mailToken,p_state:'provider_accepted',p_provider_id:'resend:fixture-email'})
  let mailEvent='sent',mailId='fixture-email'
  const mailDb={from(){let update=false;const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,
    update:()=>{update=true;return q},then(resolve,reject){return Promise.resolve({data:update?null:[{delivery_key:mailKey,provider_id:'resend:fixture-email',claim_token:mailToken}]}).then(resolve,reject)}};return q}}
  const mailWorker=load('lib/services/notification-delivery.ts',{
    './reminder-delivery':{deliveryRpc:rpc},'./delivery-state':states,'@/lib/supabase-admin':{supabaseAdmin:mailDb},
    fetch:async()=>new Response(JSON.stringify({id:mailId,last_event:mailEvent}))
  })
  await mailWorker.reconcileBriefingEmailReceipts(Date.now()+10000)
  assert.equal((await query('select state from notification_deliveries where delivery_key=$1',[mailKey]))[0].state,'provider_accepted')
  mailEvent='delivered';mailId='wrong-id';assert.equal(await mailWorker.reconcileBriefingEmailReceipts(Date.now()+10000),1)
  assert.equal((await query('select state from notification_deliveries where delivery_key=$1',[mailKey]))[0].state,'provider_accepted')
  mailId='fixture-email';await mailWorker.reconcileBriefingEmailReceipts(Date.now()+10000)
  assert.equal((await query('select state from notification_deliveries where delivery_key=$1',[mailKey]))[0].state,'delivered')
  await db.close()
  console.log('Delivery reliability: SQL leases, recurrence rollback, stale fencing, concurrency, cancellation, consent, crash/DB failure, unknown no-retry passed')
}
main().catch(e=>{console.error(e);process.exitCode=1})
