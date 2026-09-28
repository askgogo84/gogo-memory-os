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
    v_timing_changed := old.depart_at is distinct from new.depart_at or v_previous_checkin_at is distinct from v_checkin_at;
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
    update life_event_actions set
      payload_json=payload_json||jsonb_build_object('scheduleRevision',gen_random_uuid()::text)
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

