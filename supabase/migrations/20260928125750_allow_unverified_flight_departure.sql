-- Retain flight identity when a printed local clock cannot be verified.
-- Existing rows and access policies are unchanged. Apply before deploying the writer.
alter table public.travel_tickets alter column depart_at drop not null;
alter table public.travel_tickets add constraint travel_ticket_departure_known_unless_flight
  check (depart_at is not null or type = 'flight');


-- Unknown-time flights need atomic uniqueness too (ordinary NULL timestamps
-- are distinct). Match the writer's strong printed-leg and fallback identities.
create unique index travel_tickets_unverified_strong_identity_idx
on public.travel_tickets (telegram_id, type, pnr, flight_no, date_label, leg_index, from_city, to_city) nulls not distinct
where depart_at is null and type = 'flight'
  and coalesce(pnr, '') <> '' and coalesce(flight_no, '') <> '' and coalesce(date_label, '') <> '';
create unique index travel_tickets_unverified_fallback_identity_idx
on public.travel_tickets (telegram_id, type, from_city, to_city, date_label, depart_local, flight_no, pnr) nulls not distinct
where depart_at is null and type = 'flight'
  and (coalesce(pnr, '') = '' or coalesce(flight_no, '') = '' or coalesce(date_label, '') = '');

-- Install correction propagation on all deployments, including those previously
-- relying on the backfill bridge. Existing source-linked lifecycles are reused.
create or replace function gogo_promote_travel_ticket_to_life_event()
returns trigger
language plpgsql
security definer
set search_path = public
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
  v_preparation_run_ids uuid[] := array[]::uuid[];
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
    update agent_activity set metadata_json=metadata_json||'{"notificationState":"cancelled"}'::jsonb where event_type='life_event_status_changed' and metadata_json->>'life_event_id'=v_event_id::text and metadata_json->>'notificationState'='pending';
    with invalidated as (update agent_runs r set status='failed',error='flight_schedule_changed',
      summary='This preparation used an old flight schedule. Gogo will prepare the corrected itinerary again.',updated_at=now()
      where r.telegram_id=new.telegram_id::text and r.status in ('paused','queued','running','waiting_approval')
        and exists(select 1 from life_event_actions a where a.life_event_id=v_event_id and a.action_type='browser_prepare'
          and (r.id::text=coalesce(a.payload_json->>'browserRunId',a.payload_json->>'runId') or (r.metadata_json->>'life_event_action_id'=a.id::text and r.metadata_json->>'life_event_id'=v_event_id::text))) returning r.id)
    select coalesce(array_agg(id),array[]::uuid[]) into v_preparation_run_ids from invalidated;
    update life_event_actions set status='queued',
      payload_json=(payload_json-'browserRunId'-'runId'-'approvalId'-'blockedReason'-'authReason')||jsonb_build_object('supersededPreparationRunId',coalesce((select r.id::text from agent_runs r where r.id=any(v_preparation_run_ids) and (r.id::text=coalesce(life_event_actions.payload_json->>'browserRunId',life_event_actions.payload_json->>'runId') or r.metadata_json->>'life_event_action_id'=life_event_actions.id::text) order by r.updated_at desc limit 1),payload_json->>'browserRunId',payload_json->>'runId',payload_json->>'supersededPreparationRunId')),
      updated_at=now() where life_event_id=v_event_id and action_type='browser_prepare' and status in ('blocked','running');
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
revoke all on function gogo_promote_travel_ticket_to_life_event() from public, anon, authenticated;

drop trigger if exists travel_ticket_promote_life_event on travel_tickets;
create trigger travel_ticket_promote_life_event
after insert or update on travel_tickets
for each row execute function gogo_promote_travel_ticket_to_life_event();


create or replace function public.gogo_fence_life_event_schedule()
returns trigger language plpgsql set search_path = public as $$
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
revoke all on function public.gogo_fence_life_event_schedule() from public, anon, authenticated;
drop trigger if exists life_event_schedule_fence on public.life_event_actions;
create trigger life_event_schedule_fence before update on public.life_event_actions
for each row execute function public.gogo_fence_life_event_schedule();


-- Durable, revision-bound publication: all visible database effects commit together.
create table if not exists public.boarding_pass_outbox (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  life_event_id uuid not null references public.life_events(id) on delete cascade,
  action_id uuid not null references public.life_event_actions(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  schedule_revision text,
  status text not null default 'pending' check(status in ('pending','claimed','sent','failed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (action_id,schedule_revision)
);
alter table public.boarding_pass_outbox enable row level security;
drop policy if exists boarding_pass_outbox_service_only on public.boarding_pass_outbox;
create policy boarding_pass_outbox_service_only on public.boarding_pass_outbox for all to service_role using(true) with check(true);
create index if not exists boarding_pass_outbox_event_idx on public.boarding_pass_outbox(life_event_id);
create index if not exists boarding_pass_outbox_run_idx on public.boarding_pass_outbox(run_id);

revoke all on public.boarding_pass_outbox from public,anon,authenticated;
grant all on public.boarding_pass_outbox to service_role;
create index if not exists boarding_pass_outbox_pending_idx on public.boarding_pass_outbox(created_at) where status='pending';

create or replace function public.gogo_publish_boarding_pass(p_action_id uuid,p_event_id uuid,p_telegram_id text,p_revision text,p_boarding_pass jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
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
revoke all on function public.gogo_publish_boarding_pass(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.gogo_publish_boarding_pass(uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.gogo_claim_boarding_pass_notice(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
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
revoke all on function public.gogo_claim_boarding_pass_notice(uuid) from public,anon,authenticated;
grant execute on function public.gogo_claim_boarding_pass_notice(uuid) to service_role;

-- Monitor publication uses the activity row as a durable notification outbox.
create index if not exists agent_activity_monitor_notice_idx on public.agent_activity(created_at)
  where event_type='life_event_status_changed' and metadata_json->>'notificationState'='pending';
create or replace function public.gogo_publish_lifecycle_monitor(p_action_id uuid,p_event_id uuid,p_telegram_id text,p_revision text,p_fingerprint text,p_text text,p_url text,p_cadence integer,p_terminal_label text,p_resume_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare e life_events%rowtype; a life_event_actions%rowtype; previous text; publish boolean; terminal boolean; rid uuid; meta jsonb; summary text;
begin
 select * into e from life_events where id=p_event_id and telegram_id=p_telegram_id for update;
 if not found then raise exception 'life_event_schedule_changed' using errcode='40001';end if;
 select * into a from life_event_actions where id=p_action_id and life_event_id=e.id and telegram_id=p_telegram_id for update;
 if not found or a.action_type<>'monitor' or a.status<>'running'
   or a.payload_json->>'scheduleRevision' is distinct from p_revision
   or e.metadata_json->>'ticketScheduleRevision' is distinct from p_revision
   or e.lifecycle_state in ('completed','cancelled','expired') then
   raise exception 'life_event_schedule_changed' using errcode='40001';
 end if;
 previous=coalesce(a.payload_json->>'lastFingerprint','');
 terminal=previous<>'' and p_terminal_label is not null;
 publish=previous<>'' and (previous<>p_fingerprint or terminal);
 summary=case when terminal then e.title||': provider status is now '||p_terminal_label||'.' else e.title||': the provider status page changed.' end;
 meta=jsonb_build_object('plan_type','life_event_integration','life_event_id',e.id,'life_event_action_id',a.id,'action_key',a.action_key,'scheduleRevision',p_revision,'fingerprint',p_fingerprint,'monitor_url',p_url,'lifecycle_terminal',p_terminal_label,'recordedAt',now());
 if p_resume_run_id is not null then
   update agent_runs set status='completed',progress=100,error=null,summary='Gogo resumed the same provider monitor and verified the current page.',completed_at=now(),updated_at=now()
   where id=p_resume_run_id and telegram_id=p_telegram_id and metadata_json->>'life_event_action_id'=a.id::text returning id into rid;
   if rid is null then raise exception 'monitor_resume_run_mismatch';end if;
 end if;
 if publish then
   if rid is null then
     insert into agent_runs(telegram_id,type,capability,status,title,summary,progress,why,source,metadata_json,completed_at)
     values(p_telegram_id,'life_event',a.capability,'completed','Gogo · '||left(e.title,150),left(summary,1200),100,'Background Gogo verified a provider status update.','background_life_event',meta,now()) returning id into rid;
   end if;
   insert into agent_activity(telegram_id,run_id,event_type,message,metadata_json)
     values(p_telegram_id,rid,'life_event_status_changed',left(summary,900),meta||jsonb_build_object('notificationState','pending'));
   update life_events set lifecycle_state=case when terminal then 'completed' else 'watching' end,
     metadata_json=metadata_json||jsonb_build_object('lifecycleMonitor',jsonb_build_object('url',p_url,'fingerprint',p_fingerprint,'checkedAt',now(),'terminal',p_terminal_label,'statusText',left(p_text,800),'scheduleRevision',p_revision)),updated_at=now() where id=e.id;
 end if;
 update life_event_actions set status=case when terminal then 'completed' else 'ready' end,
   due_at=case when terminal then due_at else now()+make_interval(mins=>greatest(1,least(p_cadence,1440))) end,
   payload_json=payload_json||jsonb_build_object('lastFingerprint',p_fingerprint,'lastCheckedAt',now(),'lastStatusText',left(p_text,800),'monitorUrl',p_url,'terminal',case when terminal then p_terminal_label else null end),updated_at=now() where id=a.id;
 return jsonb_build_object('status',case when terminal then 'completed' else 'deferred' end,'runId',rid);
end $$;
revoke all on function public.gogo_publish_lifecycle_monitor(uuid,uuid,text,text,text,text,text,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.gogo_publish_lifecycle_monitor(uuid,uuid,text,text,text,text,text,integer,text,uuid) to service_role;

create or replace function public.gogo_claim_monitor_notice(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare notice agent_activity%rowtype; e life_events%rowtype; a life_event_actions%rowtype;
begin
 select * into notice from agent_activity where id=p_id and event_type='life_event_status_changed';
 if not found then return null;end if;
 select * into e from life_events where id::text=notice.metadata_json->>'life_event_id' and telegram_id=notice.telegram_id for update;
 select * into a from life_event_actions where id::text=notice.metadata_json->>'life_event_action_id' and telegram_id=notice.telegram_id and life_event_id=e.id for update;
 select * into notice from agent_activity where id=p_id for update;
 if notice.metadata_json->>'notificationState' is distinct from 'pending' then return null;end if;
 if e.id is null or a.id is null or e.lifecycle_state in ('cancelled','expired')
   or e.metadata_json->>'ticketScheduleRevision' is distinct from notice.metadata_json->>'scheduleRevision'
   or a.payload_json->>'scheduleRevision' is distinct from notice.metadata_json->>'scheduleRevision'
   or a.payload_json->>'lastFingerprint' is distinct from notice.metadata_json->>'fingerprint' then
   update agent_activity set metadata_json=metadata_json||'{"notificationState":"cancelled"}'::jsonb where id=p_id;
   return null;
 end if;
 update agent_activity set metadata_json=metadata_json||'{"notificationState":"claimed"}'::jsonb where id=p_id;
 return jsonb_build_object('id',notice.id,'telegramId',notice.telegram_id,'runId',notice.run_id,'lifeEventId',e.id,'metadata',notice.metadata_json);
end $$;
revoke all on function public.gogo_claim_monitor_notice(uuid) from public,anon,authenticated;
grant execute on function public.gogo_claim_monitor_notice(uuid) to service_role;
