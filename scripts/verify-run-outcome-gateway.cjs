const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto')
const {PGlite}=require('@electric-sql/pglite')
async function main(){
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table reminders(id uuid primary key default gen_random_uuid(),telegram_id bigint,chat_id bigint,
    whatsapp_to text,message text,remind_at timestamptz,sent boolean default false,created_at timestamptz default now(),
    is_recurring boolean,recurring_pattern text,timezone text,nudge_count integer,followup_started_at timestamptz,
    fail_attempts integer default 0,last_failed_at timestamptz,sent_at timestamptz,twilio_sid text,delivery_status text);
    create table followups(id uuid primary key default gen_random_uuid(),whatsapp_id text,contact_name text,context text,
      check_at timestamptz,status text default 'pending',created_at timestamptz default now());
    create table agent_runs(id uuid primary key default gen_random_uuid(),telegram_id text,type text,source text,
      status text,updated_at timestamptz default now(),metadata_json jsonb default '{}'::jsonb);
    create table conversations(id uuid primary key default gen_random_uuid(),telegram_id bigint,role text,content text,created_at timestamptz default now());`)
  await db.exec(fs.readFileSync('supabase/reminder-insert-idempotency-20260915.sql','utf8'))
  await db.exec(fs.readFileSync('supabase/migrations/20260925110046_reminder_delivery_leases.sql','utf8'))
  await db.exec(fs.readFileSync('supabase/migrations/20260925111441_delivery_callback_inbox.sql','utf8'))
  await db.exec(fs.readFileSync('supabase/migrations/20260925112633_notification_delivery_jobs.sql','utf8'))
  await db.exec(fs.readFileSync('supabase/migrations/20260925114402_followup_delivery_owner.sql','utf8'))
  await db.exec(fs.readFileSync('supabase/migrations/20260925115445_delivery_monitoring.sql','utf8'))
  await db.exec(fs.readFileSync('supabase/migrations/20260925172132_delivery_retry_boundaries.sql','utf8'))
  await db.exec(fs.readFileSync('supabase/migrations/20260925180012_delivery_health_details.sql','utf8'))
  await db.exec(fs.readFileSync('supabase/migrations/20261007044858_comparison_result_delivery.sql','utf8'))
  await db.exec(fs.readFileSync('supabase/migrations/20261007052139_comparison_delivery_due_queue.sql','utf8'))
  await db.exec(fs.readFileSync('supabase/migrations/20261007091720_web_comparison_chat_delivery.sql','utf8'))
  const query = async (sql, params = []) => (await db.query(sql, params)).rows
  const rpc = async (name,args) => {
    const rows = await query(`select * from ${name}(${Object.keys(args).map((k,i)=>k+' => $'+(i+1)).join(',')})`,Object.values(args))
    return ['claim_reminder_delivery','due_followup_deliveries','due_run_outcome_deliveries'].includes(name) ? rows : rows[0]?.[name]
  }

await db.exec(`alter table agent_runs add column title text,add column summary text,add column error text,add column completed_at timestamptz;
create table users(telegram_id bigint primary key,whatsapp_id text,timezone text);
create table reminder_optout(owner_telegram_id bigint,recipient_whatsapp_id text);
insert into users values(1,'+15555550100','UTC'),(2,'+15555550200','UTC');`)
const migrations=fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('_run_outcome_gateway.sql')).sort()
assert.equal(migrations.length,1,'one reviewed gateway migration')
await db.exec(fs.readFileSync('supabase/migrations/'+migrations[0],'utf8'))
let passed=0;const failed=[]
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name)}catch(e){failed.push(name+': '+e.message);console.error('FAIL '+name)}}
const daylight='Etc/GMT'+(new Date().getUTCHours()-12>=0?'+':'')+(new Date().getUTCHours()-12)
await query('update users set timezone=$1',[daylight])
const add=async(meta={outcome_notice_requested:true},status='completed',owner='1')=>(await query('insert into agent_runs(telegram_id,type,status,title,summary,metadata_json,completed_at) values($1,'autonomous',$2,'Synthetic task','Verified fixture',$3,now()) returning *',[owner,status,meta]))[0]
const key=r=>'run_outcome/'+r.id+'/whatsapp'
const claim=(r,t,owner=Number(r.telegram_id))=>rpc('claim_run_outcome_delivery',{p_key:key(r),p_owner:owner,p_token:t})
const snapshot=r=>({status:r.status,title:r.title,summary:r.summary,error:r.error,outcome_state:r.metadata_json.outcome_state??null,reconciliation_required:r.metadata_json.reconciliation_required===true})
const begin=(r,t,target='+15555550100',snap=snapshot(r))=>rpc('begin_run_outcome_delivery',{p_key:key(r),p_token:t,p_target:target,p_snapshot:snap})
const job=async r=>(await query('select * from notification_deliveries where delivery_key=$1',[key(r)]))[0]
await test('new source accepted by existing receipt ledger',async()=>{const r=await add();assert.equal(await claim(r,crypto.randomUUID()),true);assert.equal((await job(r)).source,'run_outcome')})
await test('atomic bridge fences old JSON sender',async()=>{const r=await add(),t=crypto.randomUUID();assert.equal(await claim(r,t),true);assert.equal((await query('select metadata_json from agent_runs where id=$1',[r.id]))[0].metadata_json.outcome_notice_claim_id,t);assert.equal((await query(`update agent_runs set metadata_json=metadata_json||'{"old_sender":true}' where id=$1 and metadata_json->>'outcome_notice_claimed_at' is null returning id`,[r.id])).length,0)})
await test('legacy ambiguous claim never enrolled',async()=>{const r=await add({outcome_notice_requested:true,outcome_notice_claimed_at:'2020-01-01T00:00:00Z'});assert.equal(await claim(r,crypto.randomUUID()),false)})
await test('live response without explicit durable request never enrolled',async()=>{const r=await add({});assert.equal(await claim(r,crypto.randomUUID()),false)})
await test('owner and self-notifying exclusions',async()=>{let r=await add();assert.equal(await claim(r,crypto.randomUUID(),2),false);await query(`update agent_runs set type='secure_browser' where id=$1`,[r.id]);assert.equal(await claim(r,crypto.randomUUID()),false)})
await test('unstarted crash recovers and fences previous worker',async()=>{const r=await add(),old=crypto.randomUUID(),next=crypto.randomUUID();assert.equal(await claim(r,old),true);await query(`update notification_deliveries set lease_until=now()-interval '1 second' where delivery_key=$1`,[key(r)]);assert.equal(await claim(r,next),true);assert.equal(await begin(r,old),false);assert.equal(await begin(r,next),true)})
await test('started unknown cannot be reclaimed or retried',async()=>{const r=await add(),t=crypto.randomUUID();await claim(r,t);assert.equal(await begin(r,t),true);assert.equal((await job(r)).state,'outcome_unknown');await query(`update notification_deliveries set lease_until=now()-interval '1 day' where delivery_key=$1`,[key(r)]);assert.equal(await claim(r,crypto.randomUUID()),false);assert.equal(await rpc('retry_notification_delivery',{p_key:key(r),p_token:t}),false)})
await test('definite rejection uses existing bounded backoff',async()=>{const r=await add(),t=crypto.randomUUID();await claim(r,t);await begin(r,t);assert.equal(await rpc('retry_notification_delivery',{p_key:key(r),p_token:t,p_definite:true}),true);assert.equal((await job(r)).state,'pending');assert.equal(await claim(r,crypto.randomUUID()),false);await query('update notification_deliveries set retry_at=now() where delivery_key=$1',[key(r)]);assert.equal(await claim(r,crypto.randomUUID()),true)})
await test('quiet deferral consumes no attempts and excludes due scan',async()=>{const r=await add(),t=crypto.randomUUID();await claim(r,t);assert.equal(await rpc('defer_notification_delivery',{p_key:key(r),p_token:t,p_until:new Date(Date.now()+3600000).toISOString()}),true);assert.equal((await job(r)).attempts,0);assert.equal((await rpc('due_run_outcome_deliveries',{p_limit:200})).some(x=>x.run_id===r.id),false)})
await test('stale token cannot defer current claim',async()=>{const r=await add(),t=crypto.randomUUID();await claim(r,t);assert.equal(await rpc('defer_notification_delivery',{p_key:key(r),p_token:crypto.randomUUID(),p_until:new Date(Date.now()+3600000).toISOString()}),false)})
await test('changed owner recipient blocks begin',async()=>{const r=await add(),t=crypto.randomUUID();await claim(r,t);await query(`update users set whatsapp_id='+15555550999' where telegram_id=1`);assert.equal(await begin(r,t),false);await query(`update users set whatsapp_id='+15555550100' where telegram_id=1`)})
await test('changed outcome snapshot blocks stale Done text',async()=>{const r=await add(),t=crypto.randomUUID();await claim(r,t);await query(`update agent_runs set status='outcome_unknown',metadata_json=metadata_json||'{"outcome_state":"unknown","reconciliation_required":true}' where id=$1`,[r.id]);assert.equal(await begin(r,t),false)})
await test('STOP preference rechecked at begin',async()=>{const r=await add(),t=crypto.randomUUID();await claim(r,t);await query(`insert into reminder_optout values(1,'+15555550100')`);assert.equal(await begin(r,t),false);await query('delete from reminder_optout')})
await test('accepted remains distinct from delivered; receipt reconciles unknown',async()=>{const r=await add(),t=crypto.randomUUID();await claim(r,t);await begin(r,t);const sid='SM'+crypto.randomUUID();await rpc('record_delivery_receipt',{p_sid:sid,p_status:'accepted',p_verified:false,p_token:t,p_chunk:1,p_chunks:1});await rpc('reconcile_delivery_receipt',{p_sid:sid});assert.equal((await job(r)).state,'provider_accepted');await rpc('record_delivery_receipt',{p_sid:sid,p_status:'delivered',p_verified:true,p_token:t,p_chunk:1,p_chunks:1});await rpc('reconcile_delivery_receipt',{p_sid:sid});assert.equal((await job(r)).state,'delivered');assert.equal(await claim(r,crypto.randomUUID()),false)})
await test('stale-close marker merges existing metadata atomically',async()=>{const r=await add({preserve:'fixture'},'running');await query(`update agent_runs set status='failed',error='stale_run_recovered' where id=$1`,[r.id]);const meta=(await query('select metadata_json from agent_runs where id=$1',[r.id]))[0].metadata_json;assert.equal(meta.preserve,'fixture');assert.equal(meta.outcome_notice_requested,true)})
await test('service-only RPC permissions',async()=>{for(const role of ['anon','authenticated'])assert.equal((await query(`select has_function_privilege($1,'public.claim_run_outcome_delivery(text,bigint,uuid)','EXECUTE') as allowed`,[role]))[0].allowed,false)})
console.log('Run outcome SQL groups: '+passed+'/'+(passed+failed.length));await db.close();if(failed.length)throw Error(failed.join('\n'))
}
main().catch(e=>{console.error(e);process.exitCode=1})
