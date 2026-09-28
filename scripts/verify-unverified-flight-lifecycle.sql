-- Rollback-only regression: run against a database with travel/lifecycle tables.
begin;
create temporary table travel_tickets (like public.travel_tickets including defaults including constraints including indexes);
alter table pg_temp.travel_tickets alter column depart_at drop not null;

-- Unknown-time flights need atomic uniqueness too (ordinary NULL timestamps
-- are distinct). Match the writer's strong printed-leg and fallback identities.
create unique index travel_tickets_unverified_strong_identity_idx
on pg_temp.travel_tickets (telegram_id, type, pnr, flight_no, date_label, leg_index, from_city, to_city) nulls not distinct
where depart_at is null and type = 'flight'
  and coalesce(pnr, '') <> '' and coalesce(flight_no, '') <> '' and coalesce(date_label, '') <> '';
create unique index travel_tickets_unverified_fallback_identity_idx
on pg_temp.travel_tickets (telegram_id, type, from_city, to_city, date_label, depart_local, flight_no, pnr) nulls not distinct
where depart_at is null and type = 'flight'
  and (coalesce(pnr, '') = '' or coalesce(flight_no, '') = '' or coalesce(date_label, '') = '');

create temporary table life_events (like public.life_events including defaults including constraints including indexes);
create temporary table life_event_actions (like public.life_event_actions including defaults including constraints including indexes);
create temporary table agent_runs (like public.agent_runs including defaults including constraints including indexes);
create temporary table agent_activity (like public.agent_activity including defaults including constraints including indexes);
create temporary table agent_approvals (like public.agent_approvals including defaults including constraints including indexes);

-- Durable, revision-bound publication: all visible database effects commit together.
create temporary table boarding_pass_outbox (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  life_event_id uuid not null references pg_temp.life_events(id) on delete cascade,
  action_id uuid not null references pg_temp.life_event_actions(id) on delete cascade,
  run_id uuid not null references pg_temp.agent_runs(id) on delete cascade,
  schedule_revision text,
  status text not null default 'pending' check(status in ('pending','claimed','sent','failed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (action_id,schedule_revision)
);

create or replace function pg_temp.gogo_publish_boarding_pass(p_action_id uuid,p_event_id uuid,p_telegram_id text,p_revision text,p_boarding_pass jsonb)
returns uuid language plpgsql security invoker set search_path=pg_temp,public as $$
declare e life_events%rowtype; a life_event_actions%rowtype; v_run uuid; v_meta jsonb;
begin
  -- Use the same event-before-action lock order as ticket propagation.
  select * into e from life_events where id=p_event_id and telegram_id=p_telegram_id for update;
  if not found then raise exception 'life_event_schedule_changed' using errcode='40001';end if;
  select * into a from life_event_actions where id=p_action_id and life_event_id=p_event_id and telegram_id=p_telegram_id for update;
  if not found or a.action_type<>'email_watch' or a.action_key<>'watch-boarding-pass-email'
    or a.payload_json->>'scheduleRevision' is distinct from p_revision
    or e.metadata_json->>'ticketScheduleRevision' is distinct from p_revision
    or e.lifecycle_state in ('completed','cancelled','expired') then
    raise exception 'life_event_schedule_changed' using errcode='40001';
  end if;
  select run_id into v_run from boarding_pass_outbox where action_id=a.id and schedule_revision is not distinct from p_revision;
  if v_run is not null then return v_run;end if;
  if a.status<>'running' or coalesce(p_boarding_pass->>'gmailMessageId','')='' then
    raise exception 'life_event_schedule_changed' using errcode='40001';
  end if;
  update life_events set lifecycle_state='watching',metadata_json=metadata_json||jsonb_build_object('boardingPass',p_boarding_pass),
    source_refs=source_refs||jsonb_build_array(jsonb_build_object('source','gmail','gmailMessageId',p_boarding_pass->>'gmailMessageId','kind','boarding_pass_or_checkin_confirmation')),updated_at=now()
    where id=e.id;
  update life_event_actions set status='completed',payload_json=payload_json||jsonb_build_object('boardingPassDetected',true,'gmailMessageId',p_boarding_pass->>'gmailMessageId','completedAt',now()),updated_at=now() where id=a.id;
  v_meta=jsonb_build_object('plan_type','life_event_boarding_pass','life_event_id',e.id,'life_event_action_id',a.id,'action_key',a.action_key,'scheduleRevision',p_revision,'gmail_message_id',p_boarding_pass->>'gmailMessageId','recordedAt',now(),'scheduledDeparture',e.start_at);
  insert into agent_runs(telegram_id,type,capability,status,title,summary,progress,why,source,metadata_json,started_at,completed_at,updated_at)
    values(p_telegram_id,'life_event','email','completed','Gogo · '||left(e.title,140),'Boarding-pass/check-in evidence recorded from Gmail for the saved flight schedule.',100,'Background Gogo matched a connected Gmail message to a saved flight Life Event.','background_life_event',v_meta,now(),now(),now()) returning id into v_run;
  insert into agent_activity(telegram_id,run_id,event_type,message,metadata_json)
    values(p_telegram_id,v_run,'life_event_boarding_pass_found','Gogo recorded Gmail boarding-pass/check-in evidence for this flight schedule.',v_meta);
  insert into boarding_pass_outbox(telegram_id,life_event_id,action_id,run_id,schedule_revision)
    values(p_telegram_id,e.id,a.id,v_run,p_revision);
  return v_run;
end $$;

create or replace function pg_temp.gogo_claim_boarding_pass_notice(p_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_temp,public as $$
declare o boarding_pass_outbox%rowtype; e life_events%rowtype; a life_event_actions%rowtype;
begin
  select * into o from boarding_pass_outbox where id=p_id;
  if not found then return null;end if;
  select * into e from life_events where id=o.life_event_id for update;
  select * into a from life_event_actions where id=o.action_id for update;
  select * into o from boarding_pass_outbox where id=p_id for update;
  if o.status<>'pending' then return null;end if;
  if e.id is null or a.id is null or a.status<>'completed'
    or a.payload_json->>'scheduleRevision' is distinct from o.schedule_revision
    or e.metadata_json->>'ticketScheduleRevision' is distinct from o.schedule_revision
    or e.lifecycle_state in ('completed','cancelled','expired') then
    update boarding_pass_outbox set status='cancelled',updated_at=now() where id=o.id;
    return null;
  end if;
  update boarding_pass_outbox set status='claimed',updated_at=now() where id=o.id;
  return jsonb_build_object('id',o.id,'telegramId',o.telegram_id,'runId',o.run_id,'lifeEventId',o.life_event_id,'scheduleRevision',o.schedule_revision);
end $$;
create or replace function pg_temp.gogo_promote_travel_ticket_test()
returns trigger
language plpgsql
security invoker
set search_path = pg_temp, public
as $$
declare
  v_event_id uuid;
  v_type text;
  v_title text;
  v_provider text;
  v_location text;
  v_key text;
  v_checkin_at timestamptz;
  v_timing_changed boolean := false;
  v_previous_checkin_at timestamptz;
  v_existing_timed_actions uuid[] := array[]::uuid[];
begin
  v_type := case when new.type = 'event' then 'event' else 'travel' end;
  v_provider := case
    when new.type = 'flight' then new.airline
    when new.type = 'train' then new.train_name
    else null
  end;
  v_location := case
    when new.type = 'event' then new.venue
    else concat_ws(' → ', new.from_city, new.to_city)
  end;
  v_title := case
    when new.type = 'flight' then concat_ws(' ', coalesce(new.airline,'Flight'), new.flight_no, concat_ws(' → ',new.from_city,new.to_city))
    when new.type = 'train' then concat_ws(' ', coalesce(new.train_name,'Train'), new.train_no, concat_ws(' → ',new.from_city,new.to_city))
    else coalesce(new.event_name,'Event')
  end;
  v_key := 'travel-ticket:' || new.id::text;
  select id into v_event_id from life_events
    where telegram_id=new.telegram_id::text
      and (dedupe_key=v_key or metadata_json->>'travel_ticket_id'=new.id::text)
    order by (dedupe_key=v_key) desc, created_at asc limit 1;
  if v_event_id is not null then
    select coalesce(array_agg(id),array[]::uuid[]) into v_existing_timed_actions from life_event_actions where life_event_id=v_event_id and due_at is not null;
    -- Reuse the existing lifecycle and its action IDs when clocks are corrected.
    update life_event_actions set status='cancelled',updated_at=now()
      where life_event_id in (select id from life_events
        where telegram_id=new.telegram_id::text and metadata_json->>'travel_ticket_id'=new.id::text and id<>v_event_id)
        and status in ('queued','ready','waiting_approval','blocked') and coalesce(payload_json->>'scheduleCorrectionUncertain','false')<>'true';
    update life_events set lifecycle_state='cancelled',next_action_at=null,updated_at=now()
      where telegram_id=new.telegram_id::text and metadata_json->>'travel_ticket_id'=new.id::text and id<>v_event_id
        and lifecycle_state not in ('completed','cancelled','expired');
    update life_events set dedupe_key=v_key where id=v_event_id and telegram_id=new.telegram_id::text;
  end if;
  -- Mirror checkInOpensHours(code, false) from lib/services/airline-checkin.ts.
  v_checkin_at := case when new.type = 'flight' then new.depart_at - make_interval(hours =>
    case left(upper(regexp_replace(coalesce(new.flight_no,''),'[^a-zA-Z0-9]','','g')),2)
      when '6E' then 48 when 'AI' then 48 when 'IX' then 48 when 'QP' then 48
      when 'SG' then 48 when 'UK' then 48 when 'EK' then 48 when 'SQ' then 48
      when 'LH' then 23 else 24 end) else null end;

  if TG_OP='UPDATE' then
  v_previous_checkin_at := case when old.type = 'flight' then old.depart_at - make_interval(hours =>
    case left(upper(regexp_replace(coalesce(old.flight_no,''),'[^a-zA-Z0-9]','','g')),2)
      when '6E' then 48 when 'AI' then 48 when 'IX' then 48 when 'QP' then 48
      when 'SG' then 48 when 'UK' then 48 when 'EK' then 48 when 'SQ' then 48
      when 'LH' then 23 else 24 end) else null end;
    v_timing_changed := old.depart_at is distinct from new.depart_at or v_previous_checkin_at is distinct from v_checkin_at
      or (new.type='flight' and (old.pnr is distinct from new.pnr or old.flight_no is distinct from new.flight_no
        or old.airline is distinct from new.airline or old.from_city is distinct from new.from_city or old.to_city is distinct from new.to_city));
  end if;

  -- Check-in is an open window, not a missed one-shot alarm. Corrections to
  -- future flights whose window is already open should run preparation now.
  if v_timing_changed and new.type='flight' and new.depart_at>now() and v_checkin_at<now() then
    v_checkin_at := now();
  end if;

  insert into life_events (
    telegram_id,event_type,subtype,source,title,provider,start_at,end_at,timezone,location,
    confirmation_ref,lifecycle_state,participants,metadata_json,source_refs,dedupe_key,next_action_at
  ) values (
    new.telegram_id::text,v_type,new.type,new.source,v_title,v_provider,new.depart_at,new.arrive_at,new.depart_tz,v_location,
    new.pnr,case when new.depart_at is null then 'captured' else 'planned' end,to_jsonb(coalesce(new.passengers,array[]::text[])),
    jsonb_build_object('travel_ticket_id',new.id,'flight_no',new.flight_no,'train_no',new.train_no,'seat',new.seat,'raw',coalesce(new.raw,'{}'::jsonb))||case when v_timing_changed then jsonb_build_object('ticketScheduleRevision',gen_random_uuid()::text) else '{}'::jsonb end,
    jsonb_build_array(jsonb_build_object('kind','travel_ticket','id',new.id,'source',new.source)),
    v_key,
    case when new.type='flight' then v_checkin_at else new.depart_at - interval '3 hours' end
  )
  on conflict (telegram_id,dedupe_key) do update set
    title=excluded.title, provider=excluded.provider, start_at=excluded.start_at, end_at=excluded.end_at,
    timezone=excluded.timezone, location=excluded.location, confirmation_ref=excluded.confirmation_ref,
    participants=excluded.participants, metadata_json=life_events.metadata_json||excluded.metadata_json, source_refs=(select jsonb_agg(distinct ref) from jsonb_array_elements(life_events.source_refs||excluded.source_refs) as refs(ref)),
    lifecycle_state=case when life_events.lifecycle_state in ('completed','cancelled','expired') then life_events.lifecycle_state when excluded.start_at is null or life_events.lifecycle_state='captured' then excluded.lifecycle_state else life_events.lifecycle_state end, next_action_at=excluded.next_action_at, updated_at=now()
  returning id into v_event_id;

  if v_timing_changed then
    update agent_runs r set status='failed',error='flight_schedule_changed',
      summary='This paused preparation used an old flight schedule. Gogo will prepare the corrected itinerary again.',updated_at=now()
      where r.telegram_id=new.telegram_id::text and r.status in ('paused','queued','running','waiting_approval')
        and exists(select 1 from life_event_actions a where a.life_event_id=v_event_id and a.action_type='browser_prepare' and a.status='blocked'
          and (r.id::text=coalesce(a.payload_json->>'browserRunId',a.payload_json->>'runId') or (r.metadata_json->>'life_event_action_id'=a.id::text and r.metadata_json->>'life_event_id'=v_event_id::text)));
    update life_event_actions set status='queued',
      payload_json=(payload_json-'browserRunId'-'runId'-'approvalId'-'blockedReason'-'authReason')||jsonb_build_object('supersededPreparationRunId',coalesce(payload_json->>'browserRunId',payload_json->>'runId',payload_json->>'supersededPreparationRunId')),
      updated_at=now() where life_event_id=v_event_id and action_type='browser_prepare' and status='blocked';
    -- Old pending authorization cannot survive a changed itinerary.
    update agent_runs r set
      status=case when r.status in ('running','paused') then 'outcome_unknown' else 'failed' end,
      error='flight_schedule_changed',summary='Flight schedule changed. Previous check-in approval is expired; prepare and approve the corrected itinerary before any new submission.',updated_at=now()
      where r.telegram_id=new.telegram_id::text and r.status in ('queued','waiting_approval','running','paused')
        and exists(select 1 from agent_approvals ap join life_event_actions a on ap.execution_payload->>'lifeEventActionId'=a.id::text
          where ap.run_id=r.id and ap.telegram_id=r.telegram_id and ap.status in ('pending','approved')
            and a.life_event_id=v_event_id and a.action_key='checkin-submit-approval');
    update agent_approvals ap set status='expired',resolved_at=now(),resolution_note='Flight schedule changed; fresh preparation and approval required.'
      where ap.telegram_id=new.telegram_id::text and ap.status in ('pending','approved')
        and exists(select 1 from life_event_actions a where a.life_event_id=v_event_id and a.action_key='checkin-submit-approval' and ap.execution_payload->>'lifeEventActionId'=a.id::text);
    update life_event_actions set status='queued',payload_json=payload_json-'runId'-'approvalId',updated_at=now()
      where life_event_id=v_event_id and action_key='checkin-submit-approval' and status='waiting_approval';
    update life_events set lifecycle_state=case when new.depart_at is null then 'captured' else 'planned' end
      where id=v_event_id and lifecycle_state='waiting_approval';
    update boarding_pass_outbox set status='cancelled',updated_at=now() where life_event_id=v_event_id and status='pending';
    update life_event_actions set
      payload_json=payload_json||jsonb_build_object('scheduleRevision',(select metadata_json->>'ticketScheduleRevision' from life_events where id=v_event_id))
        ||case when status='running' and action_type not in ('notify','monitor','email_watch','browser_prepare') then '{"scheduleCorrectionUncertain":true,"reconciliationRequired":true}'::jsonb else '{}'::jsonb end,
      status=case when status='running' then case when action_type in ('notify','monitor','email_watch','browser_prepare') then 'queued' else 'blocked' end else status end,
      updated_at=now()
      where life_event_id=v_event_id and due_at is not null;
  end if;

  if exists(select 1 from life_events where id=v_event_id and lifecycle_state in ('completed','cancelled','expired')) then
    update life_events set next_action_at=null where id=v_event_id;
    update life_event_actions set status='cancelled',updated_at=now() where life_event_id=v_event_id and status in ('queued','ready','waiting_approval','blocked') and coalesce(payload_json->>'scheduleCorrectionUncertain','false')<>'true';
    return new;
  end if;


  insert into life_event_actions (life_event_id,telegram_id,action_key,action_type,capability,title,due_at,requires_approval,irreversible,payload_json)
  values (v_event_id,new.telegram_id::text,'remember','remember','memory','Keep this ticket and its source context together',null,false,false,jsonb_build_object('travel_ticket_id',new.id))
  on conflict (life_event_id,action_key) do update set updated_at=now();

  if new.depart_at is null then
    update life_event_actions set status='cancelled',payload_json=payload_json||'{"timing_unverified":true}'::jsonb,updated_at=now() where life_event_id=v_event_id and due_at is not null and status in ('queued','ready','waiting_approval','blocked') and coalesce(payload_json->>'scheduleCorrectionUncertain','false')<>'true';
    return new;
  end if;

  if new.type = 'flight' then
    insert into life_event_actions (life_event_id,telegram_id,action_key,action_type,capability,title,due_at,requires_approval,irreversible,payload_json)
    values
      (v_event_id,new.telegram_id::text,'prepare-web-checkin','browser_prepare','browser','Prepare airline web check-in',v_checkin_at,false,false,jsonb_build_object('pnr',new.pnr,'flight_no',new.flight_no,'prepare_only',true)),
      (v_event_id,new.telegram_id::text,'checkin-submit-approval','approval','travel','Ask before airline check-in is submitted',v_checkin_at,true,true,jsonb_build_object('approval_type','booking','never_auto_submit',true)),
      (v_event_id,new.telegram_id::text,'watch-boarding-pass-email','email_watch','email','Watch connected email for boarding pass or check-in confirmation',v_checkin_at,false,false,jsonb_build_object('read_only',true,'pnr',new.pnr)),
      (v_event_id,new.telegram_id::text,'departure-readiness','notify','travel','Prepare for departure',new.depart_at - interval '3 hours',false,false,jsonb_build_object('from',new.from_city,'to',new.to_city)),
      (v_event_id,new.telegram_id::text,'travel-disruption-watch','monitor','travel','Watch for meaningful flight changes',case when v_timing_changed and new.depart_at>now() then greatest(new.depart_at - interval '24 hours',now()) else new.depart_at - interval '24 hours' end,false,false,jsonb_build_object('notify_only_on_material_change',true))
    on conflict (life_event_id,action_key) do update set due_at=case when v_timing_changed then excluded.due_at else life_event_actions.due_at end,payload_json=(case when v_timing_changed and excluded.due_at>=now() then life_event_actions.payload_json-'timing_unverified'-'timing_elapsed' else life_event_actions.payload_json end)||excluded.payload_json,status=case when life_event_actions.status='completed' and v_timing_changed and excluded.due_at>=now() and life_event_actions.action_type in ('notify','monitor','email_watch','browser_prepare') then 'queued' when life_event_actions.status='cancelled' and v_timing_changed and excluded.due_at>=now() and (life_event_actions.payload_json->>'timing_unverified'='true' or life_event_actions.payload_json->>'timing_elapsed'='true') then 'queued' else life_event_actions.status end,updated_at=now();
  elsif new.type = 'event' then
    insert into life_event_actions (life_event_id,telegram_id,action_key,action_type,capability,title,due_at,requires_approval,irreversible,payload_json)
    values
      (v_event_id,new.telegram_id::text,'event-calendar-draft','calendar_draft','calendar','Prepare calendar entry for this event',null,true,false,jsonb_build_object('mutation','create_event','approval_required',true)),
      (v_event_id,new.telegram_id::text,'event-readiness','prepare','travel','Prepare venue, travel and ticket readiness',new.depart_at - interval '3 hours',false,false,jsonb_build_object('venue',new.venue)),
      (v_event_id,new.telegram_id::text,'event-change-watch','monitor','browser','Watch for meaningful event timing or venue changes',new.depart_at - interval '24 hours',false,false,jsonb_build_object('notify_only_on_material_change',true))
    on conflict (life_event_id,action_key) do update set due_at=case when v_timing_changed then excluded.due_at else life_event_actions.due_at end,payload_json=(case when v_timing_changed and excluded.due_at>=now() then life_event_actions.payload_json-'timing_unverified'-'timing_elapsed' else life_event_actions.payload_json end)||excluded.payload_json,status=case when life_event_actions.status='completed' and v_timing_changed and excluded.due_at>=now() and life_event_actions.action_type in ('notify','monitor','email_watch','browser_prepare') then 'queued' when life_event_actions.status='cancelled' and v_timing_changed and excluded.due_at>=now() and (life_event_actions.payload_json->>'timing_unverified'='true' or life_event_actions.payload_json->>'timing_elapsed'='true') then 'queued' else life_event_actions.status end,updated_at=now();
  else
    insert into life_event_actions (life_event_id,telegram_id,action_key,action_type,capability,title,due_at,requires_approval,irreversible,payload_json)
    values (v_event_id,new.telegram_id::text,'departure-readiness','notify','travel','Prepare for departure',new.depart_at - interval '3 hours',false,false,jsonb_build_object('from',new.from_city,'to',new.to_city))
    on conflict (life_event_id,action_key) do update set due_at=case when v_timing_changed then excluded.due_at else life_event_actions.due_at end,payload_json=(case when v_timing_changed and excluded.due_at>=now() then life_event_actions.payload_json-'timing_unverified'-'timing_elapsed' else life_event_actions.payload_json end)||excluded.payload_json,status=case when life_event_actions.status='completed' and v_timing_changed and excluded.due_at>=now() and life_event_actions.action_type in ('notify','monitor','email_watch','browser_prepare') then 'queued' when life_event_actions.status='cancelled' and v_timing_changed and excluded.due_at>=now() and (life_event_actions.payload_json->>'timing_unverified'='true' or life_event_actions.payload_json->>'timing_elapsed'='true') then 'queued' else life_event_actions.status end,updated_at=now();
  end if;

  update life_event_actions set payload_json=payload_json||jsonb_build_object('scheduleRevision',(select metadata_json->>'ticketScheduleRevision' from life_events where id=v_event_id))
  where life_event_id=v_event_id and due_at is not null
    and (select metadata_json->>'ticketScheduleRevision' from life_events where id=v_event_id) is not null
    and payload_json->>'scheduleRevision' is distinct from (select metadata_json->>'ticketScheduleRevision' from life_events where id=v_event_id);

  if v_timing_changed then
    update life_event_actions set payload_json=payload_json||jsonb_build_object(
      'excludedGmailMessageIds',coalesce(payload_json->'excludedGmailMessageIds','[]'::jsonb)||jsonb_build_array(payload_json->>'gmailMessageId',(select metadata_json#>>'{boardingPass,gmailMessageId}' from life_events where id=v_event_id)))
      where life_event_id=v_event_id and action_type='email_watch' and status='queued' and due_at>=now();
  end if;

  -- Corrected elapsed action times must not be picked up as due work.
  update life_event_actions set status='cancelled',payload_json=payload_json||'{"timing_elapsed":true}'::jsonb,updated_at=now()
    where life_event_id=v_event_id and due_at<now() and (new.depart_at<=now() or (v_timing_changed and id=any(v_existing_timed_actions))) and status in ('queued','ready','waiting_approval','blocked') and coalesce(payload_json->>'scheduleCorrectionUncertain','false')<>'true';
  update life_events set next_action_at=(select min(due_at) from life_event_actions where life_event_id=v_event_id and due_at>=now() and status in ('queued','ready'))
    where id=v_event_id;

  return new;
end;
$$;
create or replace function pg_temp.gogo_fence_life_event_schedule()
returns trigger language plpgsql set search_path = pg_temp, public as $$
begin
  -- Ticket propagation is a nested trigger. Direct worker writes must retain
  -- the schedule revision they claimed, including after another worker starts.
  if pg_trigger_depth()=1 and old.payload_json->>'scheduleRevision' is not null
    and old.payload_json->>'scheduleRevision' is distinct from new.payload_json->>'scheduleRevision' then
    raise exception 'life_event_schedule_changed' using errcode='40001';
  end if;
  return new;
end;
$$;
drop trigger if exists life_event_schedule_fence on pg_temp.life_event_actions;
create trigger life_event_schedule_fence before update on pg_temp.life_event_actions
for each row execute function pg_temp.gogo_fence_life_event_schedule();

create trigger ticket_test after insert or update on pg_temp.travel_tickets for each row execute function pg_temp.gogo_promote_travel_ticket_test();
insert into pg_temp.travel_tickets (telegram_id,type,pnr,flight_no,leg_index,from_city,to_city,depart_at,depart_tz,date_label,depart_local,source) values
(17,'flight','REGRESSION','XX222',0,'BLR','AUH',null,'','28 Sep 2040','10:00','pdf'),
(17,'flight','REGRESSION','XX222',1,'AUH','JFK',null,'','28 Sep 2040','14:00','pdf');
do $test$ begin
 if (select count(*) from pg_temp.life_events)<>2 then raise exception 'null legs collided';end if;
 if (select count(*) from pg_temp.life_event_actions where action_key<>'remember')<>0 then raise exception 'unverified timed actions';end if;
end $test$;

do $test$ begin
 begin
  insert into pg_temp.travel_tickets (telegram_id,type,pnr,flight_no,leg_index,from_city,to_city,depart_at,depart_tz,date_label,depart_local,source)
  values (17,'flight','REGRESSION','XX222',0,'BLR','AUH',null,'','28 Sep 2040','11:00','pdf');
  raise exception 'duplicate strong identity accepted';
 exception when unique_violation then null;
 end;
end $test$;

update pg_temp.life_events set dedupe_key='legacy:'||id::text;
update pg_temp.travel_tickets set depart_at='2040-09-28T04:30:00Z',depart_tz='Asia/Kolkata' where leg_index=0;
do $test$ begin
 if (select count(*) from pg_temp.life_events)<>2 then raise exception 'legacy event duplicated';end if;
 if (select count(*) from pg_temp.life_events where start_at='2040-09-28T04:30:00Z')<>1 then raise exception 'event time not corrected';end if;
end $test$;
update pg_temp.travel_tickets set depart_at=null where leg_index=0;
do $test$ begin
 if exists(select 1 from pg_temp.life_event_actions where due_at is not null and status='queued') then raise exception 'unknown time retained queued actions';end if;
end $test$;
update pg_temp.travel_tickets set depart_at='2040-09-28T04:30:00Z' where leg_index=0;
do $test$ begin
 if (select count(*) from pg_temp.life_event_actions where due_at is not null and status='queued')<>5 then raise exception 'timing correction did not resume actions';end if;
end $test$;
update pg_temp.life_events set lifecycle_state='cancelled' where start_at is null;
update pg_temp.travel_tickets set depart_at='2040-09-28T10:00:00Z',depart_tz='Asia/Dubai' where leg_index=1;
do $test$ begin
 if exists(select 1 from pg_temp.life_events e join pg_temp.life_event_actions a on a.life_event_id=e.id where e.lifecycle_state='cancelled' and a.status='queued') then raise exception 'cancelled trip queued actions';end if;
 if not exists(select 1 from pg_temp.life_events where lifecycle_state='cancelled' and next_action_at is null) then raise exception 'terminal state lost';end if;
end $test$;

insert into pg_temp.travel_tickets (telegram_id,type,from_city,to_city,depart_at,depart_tz,date_label,depart_local,source)
values (18,'flight','UNKNOWN A','UNKNOWN B',null,'','28 Sep 2040','10:00','pdf');
do $test$ begin
 begin
  insert into pg_temp.travel_tickets (telegram_id,type,from_city,to_city,depart_at,depart_tz,date_label,depart_local,source)
  values (18,'flight','UNKNOWN A','UNKNOWN B',null,'','28 Sep 2040','10:00','pdf');
  raise exception 'duplicate fallback identity accepted';
 exception when unique_violation then null;
 end;
end $test$;


insert into pg_temp.travel_tickets (telegram_id,type,pnr,from_city,to_city,depart_at,depart_tz,date_label,depart_local,source)
values (19,'flight','PNR-A','UNKNOWN A','UNKNOWN B',null,'','28 Sep 2040','10:00','pdf'),
(19,'flight','PNR-B','UNKNOWN A','UNKNOWN B',null,'','28 Sep 2040','10:00','pdf');
do $test$ begin
 if (select count(*) from pg_temp.travel_tickets where telegram_id=19)<>2 then raise exception 'distinct PNRs collided'; end if;
end $test$;

update pg_temp.travel_tickets set depart_at=now()-interval '2 days' where telegram_id=17 and leg_index=0;
do $test$ begin
 if exists(select 1 from pg_temp.life_event_actions a join pg_temp.life_events e on e.id=a.life_event_id where e.telegram_id='17' and a.due_at<=now() and a.status in ('queued','ready','waiting_approval','blocked')) then raise exception 'elapsed corrected actions remained executable';end if;
end $test$;

insert into pg_temp.travel_tickets (telegram_id,type,pnr,flight_no,from_city,to_city,depart_at,depart_tz,date_label,depart_local,source)
values (20,'flight','AIR-INDIA','AI123','DEL','BOM','2040-09-28T04:30:00Z','Asia/Kolkata','28 Sep 2040','10:00','pdf'),
(21,'flight','LUFTHANSA','LH123','FRA','JFK','2040-09-28T04:30:00Z','Europe/Berlin','28 Sep 2040','06:30','pdf');
do $test$ begin
 if not exists(select 1 from pg_temp.life_event_actions where telegram_id='20' and action_key='prepare-web-checkin' and due_at='2040-09-26T04:30:00Z') then raise exception '48h carrier lifecycle window lost';end if;
 if not exists(select 1 from pg_temp.life_event_actions where telegram_id='21' and action_key='prepare-web-checkin' and due_at='2040-09-27T05:30:00Z') then raise exception '23h carrier lifecycle window lost';end if;
end $test$;

insert into pg_temp.travel_tickets (telegram_id,type,pnr,flight_no,from_city,to_city,depart_at,depart_tz,date_label,depart_local,source)
values (22,'flight','OPEN-WINDOW','AI124','DEL','BOM',now()+interval '12 hours','Asia/Kolkata','28 Sep 2040','10:00','pdf');
update pg_temp.travel_tickets set passengers=array['Newly learned name'] where telegram_id=22;
do $test$ begin
 if not exists(select 1 from pg_temp.life_event_actions where telegram_id='22' and action_key='prepare-web-checkin' and status='queued' and due_at<=now()) then raise exception 'already-open initial capture was cancelled';end if;
end $test$;

update pg_temp.life_events set lifecycle_state='watching',metadata_json=metadata_json||'{"boardingPass":"retained"}'::jsonb,source_refs=source_refs||'[{"kind":"email","id":"retained-email"}]'::jsonb where telegram_id='22';
update pg_temp.life_event_actions set status='queued',due_at=now()+interval '1 hour',payload_json=payload_json||'{"runId":"retained-run","approvalId":"retained-approval","lastFingerprint":"retained-hash"}'::jsonb where telegram_id='22' and action_key='prepare-web-checkin';
update pg_temp.travel_tickets set seat='12A' where telegram_id=22;
do $test$ begin
 if not exists(select 1 from pg_temp.life_event_actions where telegram_id='22' and action_key='prepare-web-checkin' and status='queued' and due_at>now() and payload_json->>'runId'='retained-run' and payload_json->>'approvalId'='retained-approval') then raise exception 'worker resume state was overwritten';end if;
 if not exists(select 1 from pg_temp.life_events where telegram_id='22' and lifecycle_state='watching' and metadata_json->>'boardingPass'='retained' and source_refs @> '[{"kind":"email","id":"retained-email"}]'::jsonb) then raise exception 'lifecycle enriched memory was overwritten';end if;
end $test$;

insert into pg_temp.travel_tickets (telegram_id,type,pnr,flight_no,from_city,to_city,depart_at,depart_tz,date_label,depart_local,source)
values (23,'flight','NEWLY-VERIFIED','AI125','DEL','BOM',null,'','28 Sep 2040','10:00','pdf');
update pg_temp.travel_tickets set depart_at=now()+interval '12 hours',depart_tz='Asia/Kolkata' where telegram_id=23;
do $test$ begin
 if not exists(select 1 from pg_temp.life_event_actions where telegram_id='23' and action_key='prepare-web-checkin' and status='queued' and due_at<=now()) then raise exception 'newly verified open window was cancelled';end if;
end $test$;
update pg_temp.travel_tickets set depart_at=now()+interval '1 hour' where telegram_id=22;
update pg_temp.travel_tickets set seat='13A' where telegram_id=22;
do $test$ begin
 if not exists(select 1 from pg_temp.life_event_actions where telegram_id='22' and action_key='departure-readiness' and status='cancelled' and payload_json->>'timing_elapsed'='true') then raise exception 'metadata update requeued elapsed cancellation';end if;
end $test$;

update pg_temp.life_event_actions set status='completed' where telegram_id='23' and action_key in ('departure-readiness','checkin-submit-approval');
update pg_temp.travel_tickets set depart_at=now()+interval '5 days' where telegram_id=23;
do $test$ begin
 if not exists(select 1 from pg_temp.life_event_actions where telegram_id='23' and action_key='departure-readiness' and status='queued' and due_at>now()) then raise exception 'repeatable notification did not reschedule';end if;
 if not exists(select 1 from pg_temp.life_event_actions where telegram_id='23' and action_key='checkin-submit-approval' and status='completed') then raise exception 'completed approval was rearmed';end if;
end $test$;

update pg_temp.life_event_actions set status='completed',payload_json=payload_json||'{"gmailMessageId":"old-boarding-pass"}'::jsonb where telegram_id='23' and action_type='email_watch';
update pg_temp.life_events set metadata_json=metadata_json||'{"boardingPass":{"gmailMessageId":"old-boarding-pass"}}'::jsonb where telegram_id='23';
update pg_temp.travel_tickets set depart_at=now()+interval '6 days' where telegram_id=23;
do $test$ begin
 if not exists(select 1 from pg_temp.life_event_actions where telegram_id='23' and action_type='email_watch' and status='queued' and payload_json->'excludedGmailMessageIds' @> '["old-boarding-pass"]'::jsonb) then raise exception 'rearmed email watch did not exclude old boarding pass';end if;
end $test$;

update pg_temp.life_event_actions set status='completed' where telegram_id='23' and action_key in ('watch-boarding-pass-email','prepare-web-checkin');
update pg_temp.travel_tickets set depart_at=now()+interval '12 hours' where telegram_id=23;
do $test$ begin
 if (select count(*) from pg_temp.life_event_actions where telegram_id='23' and action_key in ('watch-boarding-pass-email','prepare-web-checkin') and status='queued' and due_at=now())<>2 then raise exception 'corrected open-window work was not runnable now';end if;
 if not exists(select 1 from pg_temp.life_event_actions where telegram_id='23' and action_type='email_watch' and payload_json->'excludedGmailMessageIds' @> '["old-boarding-pass"]'::jsonb) then raise exception 'open-window rearm lost old pass exclusion';end if;
 if not exists(select 1 from pg_temp.life_event_actions where telegram_id='23' and action_key='checkin-submit-approval' and status='completed') then raise exception 'completed approval was rearmed in open window';end if;
end $test$;

do $test$ declare stale_payload jsonb; action_id uuid; begin
 select id,payload_json into action_id,stale_payload from pg_temp.life_event_actions where telegram_id='23' and action_type='email_watch';
 update pg_temp.life_event_actions set status='running' where id=action_id;
 update pg_temp.travel_tickets set depart_at=now()+interval '8 days' where telegram_id=23;
 begin
   update pg_temp.life_event_actions set status='completed',payload_json=stale_payload where id=action_id;
   raise exception 'stale worker consumed corrected schedule';
 exception when serialization_failure then null;
 end;
 if not exists(select 1 from pg_temp.life_event_actions where id=action_id and status='queued' and payload_json->>'scheduleRevision' is distinct from stale_payload->>'scheduleRevision') then raise exception 'corrected action was not preserved';end if;
 -- Simulate a new worker claim before the old worker finishes (ABA).
 update pg_temp.life_event_actions set status='running' where id=action_id;
 begin
   update pg_temp.life_event_actions set status='ready',payload_json=stale_payload where id=action_id;
   raise exception 'stale deferred worker overwrote new claim';
 exception when serialization_failure then null;
 end;
end $test$;
do $test$ declare old_revision text; changed integer; begin
 select metadata_json->>'ticketScheduleRevision' into old_revision from pg_temp.life_events where telegram_id='23';
 update pg_temp.travel_tickets set depart_at=now()+interval '9 days' where telegram_id=23;
 update pg_temp.life_events set metadata_json=metadata_json||'{"boardingPass":{"gmailMessageId":"stale-worker-pass"}}'::jsonb
 where telegram_id='23' and metadata_json->>'ticketScheduleRevision' is not distinct from old_revision;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'stale email worker overwrote corrected event';end if;
 if exists(select 1 from pg_temp.life_event_actions a join pg_temp.life_events e on e.id=a.life_event_id where e.telegram_id='23' and a.due_at is not null and a.payload_json->>'scheduleRevision' is distinct from e.metadata_json->>'ticketScheduleRevision') then raise exception 'action and event schedule revisions disagree';end if;

 if exists(select 1 from pg_temp.life_events where telegram_id='23' and metadata_json->'boardingPass'->>'gmailMessageId'='stale-worker-pass') then raise exception 'stale boarding pass persisted';end if;
end $test$;
do $test$ declare aid uuid; eid uuid; rev text; rid uuid; oid uuid; before_runs integer; begin
 select id,life_event_id,payload_json->>'scheduleRevision' into aid,eid,rev from pg_temp.life_event_actions where telegram_id='23' and action_type='email_watch';
 update pg_temp.life_event_actions set status='running' where id=aid;
 select count(*) into before_runs from pg_temp.agent_runs;
 begin
  perform pg_temp.gogo_publish_boarding_pass(aid,eid,'23','stale','{"gmailMessageId":"invalid-pass"}'::jsonb);
  raise exception 'stale publication accepted';
 exception when serialization_failure then null;end;
 if (select count(*) from pg_temp.agent_runs)<>before_runs then raise exception 'stale run leaked';end if;
 rid=pg_temp.gogo_publish_boarding_pass(aid,eid,'23',rev,'{"gmailMessageId":"valid-pass"}'::jsonb);
 if not exists(select 1 from pg_temp.agent_activity where run_id=rid) or not exists(select 1 from pg_temp.boarding_pass_outbox where run_id=rid and status='pending') then raise exception 'atomic publication incomplete';end if;
 if pg_temp.gogo_publish_boarding_pass(aid,eid,'23',rev,'{"gmailMessageId":"valid-pass"}'::jsonb)<>rid then raise exception 'publication retry duplicated run';end if;
 if (select count(*) from pg_temp.agent_runs)<>before_runs+1 then raise exception 'publication duplicated';end if;
 select id into oid from pg_temp.boarding_pass_outbox where run_id=rid;
 update pg_temp.travel_tickets set depart_at=now()+interval '10 days' where telegram_id=23;
 if pg_temp.gogo_claim_boarding_pass_notice(oid) is not null then raise exception 'corrected notice was delivered';end if;
 if not exists(select 1 from pg_temp.boarding_pass_outbox where id=oid and status='cancelled') then raise exception 'corrected notice not cancelled';end if;
 begin
  perform pg_temp.gogo_publish_boarding_pass(aid,eid,'23',rev,'{"gmailMessageId":"late-old-pass"}'::jsonb);
  raise exception 'publication after correction accepted';
 exception when serialization_failure then null;end;
 select payload_json->>'scheduleRevision' into rev from pg_temp.life_event_actions where id=aid;
 update pg_temp.life_event_actions set status='running' where id=aid;
 rid=pg_temp.gogo_publish_boarding_pass(aid,eid,'23',rev,'{"gmailMessageId":"corrected-pass"}'::jsonb);
 select id into oid from pg_temp.boarding_pass_outbox where run_id=rid;
 if pg_temp.gogo_claim_boarding_pass_notice(oid) is null then raise exception 'current notice could not be claimed';end if;
 if pg_temp.gogo_claim_boarding_pass_notice(oid) is not null then raise exception 'claimed notice replayed';end if;
end $test$;
do $test$ declare aid uuid; eid uuid; rid uuid; apid uuid; begin
 select id,life_event_id into aid,eid from pg_temp.life_event_actions where telegram_id='23' and action_key='checkin-submit-approval';
 insert into pg_temp.agent_runs(telegram_id,type,capability,status,title,metadata_json) values('23','life_event','travel','waiting_approval','Review old itinerary',jsonb_build_object('plan_type','life_event_checkin','life_event_id',eid)) returning id into rid;
 insert into pg_temp.agent_approvals(telegram_id,run_id,action_type,title,description,risk_level,status,execution_payload)
 values('23',rid,'booking','Old check-in approval','Old schedule','high','pending',jsonb_build_object('lifeEventActionId',aid,'action','submit_web_checkin')) returning id into apid;
 update pg_temp.life_event_actions set status='waiting_approval',payload_json=payload_json||jsonb_build_object('runId',rid,'approvalId',apid) where id=aid;
 update pg_temp.life_event_actions set status='completed' where life_event_id=eid and action_key='prepare-web-checkin';
 update pg_temp.life_events set lifecycle_state='waiting_approval' where id=eid;
 update pg_temp.travel_tickets set depart_at=now()+interval '11 days' where telegram_id=23;
 if not exists(select 1 from pg_temp.agent_approvals where id=apid and status='expired') then raise exception 'old check-in approval remained usable';end if;
 if not exists(select 1 from pg_temp.agent_runs where id=rid and status='failed' and error='flight_schedule_changed') then raise exception 'old approval run remained actionable';end if;
 if not exists(select 1 from pg_temp.life_event_actions where id=aid and status='queued' and not payload_json ? 'approvalId' and not payload_json ? 'runId') then raise exception 'new schedule did not require a new approval';end if;
 if not exists(select 1 from pg_temp.life_event_actions where life_event_id=eid and action_key='prepare-web-checkin' and status='queued') then raise exception 'fresh preparation was not required';end if;
end $test$;
do $test$ declare aid uuid; eid uuid; rid uuid; begin
 select id,life_event_id into aid,eid from pg_temp.life_event_actions where telegram_id='23' and action_key='prepare-web-checkin';
 insert into pg_temp.agent_runs(telegram_id,type,capability,status,title,metadata_json) values('23','life_event','browser','paused','Old login preparation','{"handoff":{"releaseUrl":"https://fixture.invalid/release"}}'::jsonb) returning id into rid;
 update pg_temp.life_event_actions set status='blocked',payload_json=payload_json||jsonb_build_object('browserRunId',rid,'blockedReason','human_auth_required') where id=aid;
 update pg_temp.travel_tickets set depart_at=now()+interval '12 days' where telegram_id=23;
 if not exists(select 1 from pg_temp.agent_runs where id=rid and status='failed' and error='flight_schedule_changed') then raise exception 'old preparation run remains resumable';end if;
 if not exists(select 1 from pg_temp.life_event_actions where id=aid and status='queued' and payload_json->>'supersededPreparationRunId'=rid::text and not payload_json ? 'browserRunId') then raise exception 'blocked preparation did not requeue with cleanup reference';end if;
end $test$;
do $test$ declare aid uuid; eid uuid; old_revision text; begin
 select id,life_event_id,payload_json->>'scheduleRevision' into aid,eid,old_revision from pg_temp.life_event_actions where telegram_id='23' and action_key='prepare-web-checkin';
 update pg_temp.life_event_actions set status='blocked',payload_json=payload_json||'{"blockedReason":"missing_checkin_url_or_confirmation"}'::jsonb where id=aid;
 update pg_temp.travel_tickets set pnr='ENRICHED-PNR' where telegram_id=23;
 if not exists(select 1 from pg_temp.life_event_actions where id=aid and status='queued' and payload_json->>'scheduleRevision' is distinct from old_revision) then raise exception 'PNR enrichment did not retry blocked preparation';end if;
 select payload_json->>'scheduleRevision' into old_revision from pg_temp.life_event_actions where id=aid;
 update pg_temp.life_event_actions set status='completed' where id=aid;
 update pg_temp.travel_tickets set flight_no='AI999' where telegram_id=23;
 if not exists(select 1 from pg_temp.life_event_actions where id=aid and status='queued' and payload_json->>'scheduleRevision' is distinct from old_revision) then raise exception 'replacement flight without time change retained old preparation';end if;
end $test$;
do $test$ declare aid uuid; eid uuid; rid uuid; begin
 select id,life_event_id into aid,eid from pg_temp.life_event_actions where telegram_id='23' and action_key='prepare-web-checkin';
 insert into pg_temp.agent_runs(telegram_id,type,capability,status,title,metadata_json) values('23','life_event','browser','paused','Missing confirmation',jsonb_build_object('life_event_action_id',aid,'life_event_id',eid)) returning id into rid;
 update pg_temp.life_event_actions set status='blocked',payload_json=(payload_json-'browserRunId'-'runId')||'{"blockedReason":"missing_checkin_url_or_confirmation"}'::jsonb where id=aid;
 update pg_temp.travel_tickets set pnr='ENRICHED-AGAIN' where telegram_id=23;
 if not exists(select 1 from pg_temp.agent_runs where id=rid and status='failed') then raise exception 'unlinked missing-confirmation run was stranded';end if;
end $test$;
rollback;
select 'temporary trigger regressions passed; all changes rolled back' as result;
