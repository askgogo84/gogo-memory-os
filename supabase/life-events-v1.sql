-- Universal Life Event Engine v1
-- Converts inbound tickets/documents/appointments into durable lifecycle objects.
-- No client-side access. Server routes use the service-role client and scope by telegram_id.

create table if not exists life_events (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  event_type text not null check (event_type in ('travel','event','appointment','reservation','purchase','delivery','bill','subscription','application','document','other')),
  subtype text not null default 'other',
  source text not null default 'unknown',
  title text not null check (char_length(title) between 1 and 240),
  provider text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  location text,
  confirmation_ref text,
  lifecycle_state text not null default 'captured' check (lifecycle_state in ('captured','planned','watching','waiting_approval','in_progress','completed','cancelled','expired')),
  participants jsonb not null default '[]'::jsonb,
  preferences_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  dedupe_key text not null,
  next_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_id, dedupe_key)
);

create index if not exists life_events_user_time_idx on life_events (telegram_id, start_at desc nulls last, updated_at desc);
create index if not exists life_events_due_idx on life_events (lifecycle_state, next_action_at) where next_action_at is not null;

create table if not exists life_event_actions (
  id uuid primary key default gen_random_uuid(),
  life_event_id uuid not null references life_events(id) on delete cascade,
  telegram_id text not null,
  action_key text not null,
  action_type text not null check (action_type in ('remember','prepare','monitor','notify','calendar_draft','browser_prepare','email_watch','approval','complete')),
  capability text not null check (capability in ('memory','files','email','calendar','browser','contacts','travel','payments')),
  title text not null,
  due_at timestamptz,
  requires_approval boolean not null default false,
  irreversible boolean not null default false,
  status text not null default 'queued' check (status in ('queued','ready','waiting_approval','running','completed','blocked','cancelled','skipped')),
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (life_event_id, action_key)
);

create index if not exists life_event_actions_due_idx on life_event_actions (status, due_at) where status in ('queued','ready');
create index if not exists life_event_actions_user_idx on life_event_actions (telegram_id, updated_at desc);

-- Existing WhatsApp ticket ingestion already writes travel_tickets. Promote those
-- inserts automatically so PDFs/images immediately become durable Gogo missions
-- without changing the proven ticket parser/reminder path.
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
  v_key := md5(concat_ws('|', new.telegram_id::text, new.type, coalesce(new.pnr,''), coalesce(new.flight_no,''), coalesce(new.train_no,''), coalesce(new.event_name,''), new.depart_at::text));
  v_checkin_at := case when new.type = 'flight' then new.depart_at - interval '24 hours' else null end;

  insert into life_events (
    telegram_id,event_type,subtype,source,title,provider,start_at,end_at,timezone,location,
    confirmation_ref,lifecycle_state,participants,metadata_json,source_refs,dedupe_key,next_action_at
  ) values (
    new.telegram_id::text,v_type,new.type,new.source,v_title,v_provider,new.depart_at,new.arrive_at,new.depart_tz,v_location,
    new.pnr,'planned',to_jsonb(coalesce(new.passengers,array[]::text[])),
    jsonb_build_object('travel_ticket_id',new.id,'flight_no',new.flight_no,'train_no',new.train_no,'seat',new.seat,'raw',coalesce(new.raw,'{}'::jsonb)),
    jsonb_build_array(jsonb_build_object('kind','travel_ticket','id',new.id,'source',new.source)),
    v_key,
    case when new.type='flight' then v_checkin_at else new.depart_at - interval '3 hours' end
  )
  on conflict (telegram_id,dedupe_key) do update set
    title=excluded.title, provider=excluded.provider, start_at=excluded.start_at, end_at=excluded.end_at,
    timezone=excluded.timezone, location=excluded.location, confirmation_ref=excluded.confirmation_ref,
    participants=excluded.participants, metadata_json=excluded.metadata_json, source_refs=excluded.source_refs,
    lifecycle_state='planned', next_action_at=excluded.next_action_at, updated_at=now()
  returning id into v_event_id;

  insert into life_event_actions (life_event_id,telegram_id,action_key,action_type,capability,title,due_at,requires_approval,irreversible,payload_json)
  values (v_event_id,new.telegram_id::text,'remember','remember','memory','Keep this ticket and its source context together',null,false,false,jsonb_build_object('travel_ticket_id',new.id))
  on conflict (life_event_id,action_key) do update set updated_at=now();

  if new.type = 'flight' then
    insert into life_event_actions (life_event_id,telegram_id,action_key,action_type,capability,title,due_at,requires_approval,irreversible,payload_json)
    values
      (v_event_id,new.telegram_id::text,'prepare-web-checkin','browser_prepare','browser','Prepare airline web check-in',v_checkin_at,false,false,jsonb_build_object('pnr',new.pnr,'flight_no',new.flight_no,'prepare_only',true)),
      (v_event_id,new.telegram_id::text,'checkin-submit-approval','approval','travel','Ask before airline check-in is submitted',v_checkin_at,true,true,jsonb_build_object('approval_type','booking','never_auto_submit',true)),
      (v_event_id,new.telegram_id::text,'watch-boarding-pass-email','email_watch','email','Watch connected email for boarding pass or check-in confirmation',v_checkin_at,false,false,jsonb_build_object('read_only',true,'pnr',new.pnr)),
      (v_event_id,new.telegram_id::text,'departure-readiness','notify','travel','Prepare for departure',new.depart_at - interval '3 hours',false,false,jsonb_build_object('from',new.from_city,'to',new.to_city)),
      (v_event_id,new.telegram_id::text,'travel-disruption-watch','monitor','travel','Watch for meaningful flight changes',new.depart_at - interval '24 hours',false,false,jsonb_build_object('notify_only_on_material_change',true))
    on conflict (life_event_id,action_key) do update set due_at=excluded.due_at,payload_json=excluded.payload_json,updated_at=now();
  elsif new.type = 'event' then
    insert into life_event_actions (life_event_id,telegram_id,action_key,action_type,capability,title,due_at,requires_approval,irreversible,payload_json)
    values
      (v_event_id,new.telegram_id::text,'event-calendar-draft','calendar_draft','calendar','Prepare calendar entry for this event',null,true,false,jsonb_build_object('mutation','create_event','approval_required',true)),
      (v_event_id,new.telegram_id::text,'event-readiness','prepare','travel','Prepare venue, travel and ticket readiness',new.depart_at - interval '3 hours',false,false,jsonb_build_object('venue',new.venue)),
      (v_event_id,new.telegram_id::text,'event-change-watch','monitor','browser','Watch for meaningful event timing or venue changes',new.depart_at - interval '24 hours',false,false,jsonb_build_object('notify_only_on_material_change',true))
    on conflict (life_event_id,action_key) do update set due_at=excluded.due_at,payload_json=excluded.payload_json,updated_at=now();
  else
    insert into life_event_actions (life_event_id,telegram_id,action_key,action_type,capability,title,due_at,requires_approval,irreversible,payload_json)
    values (v_event_id,new.telegram_id::text,'departure-readiness','notify','travel','Prepare for departure',new.depart_at - interval '3 hours',false,false,jsonb_build_object('from',new.from_city,'to',new.to_city))
    on conflict (life_event_id,action_key) do update set due_at=excluded.due_at,payload_json=excluded.payload_json,updated_at=now();
  end if;

  return new;
end;
$$;

drop trigger if exists travel_ticket_promote_life_event on travel_tickets;
create trigger travel_ticket_promote_life_event
after insert or update on travel_tickets
for each row execute function gogo_promote_travel_ticket_to_life_event();

alter table life_events enable row level security;
alter table life_event_actions enable row level security;
