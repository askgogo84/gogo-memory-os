-- AskGogo Memory: Important people/entities v1
-- Purpose: learn frequently mentioned people/entities from reminders and user messages.
-- Safe to run multiple times.

create extension if not exists pgcrypto;

-- Extract a useful person/entity from reminder-style text.
-- Examples:
--   "Call Dr Gautami" -> "Dr Gautami"
--   "Follow up with Srini" -> "Srini"
--   "Call Get Graduates and get appointment" -> "Get Graduates"
--   "Pay electricity bill" -> "Electricity bill"
create or replace function public.memory_twin_entity_from_text(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  v_text text := trim(coalesce(p_text, ''));
  v_lower text := lower(trim(coalesce(p_text, '')));
  v_entity text;
begin
  if length(v_text) = 0 then
    return null;
  end if;

  -- Remove common reminder prefixes.
  v_text := regexp_replace(v_text, '^\s*(remind me|reminder|set reminder|set an alarm|alarm)\s+', '', 'i');
  v_text := regexp_replace(v_text, '^\s*(tomorrow|today|day after tomorrow|next week|next month)\s+', '', 'i');
  v_text := regexp_replace(v_text, '^\s*(at|on|by)\s+\d{1,2}(:\d{2})?\s*(am|pm)?\s+', '', 'i');
  v_text := regexp_replace(v_text, '^\s*to\s+', '', 'i');

  -- Strong patterns.
  if v_lower ~ '(^|[^a-z0-9])(call|phone|ring|dial)([^a-z0-9]|$)' then
    v_entity := regexp_replace(v_text, '^.*?\b(call|phone|ring|dial)\s+', '', 'i');
    v_entity := regexp_replace(v_entity, '\s+(and|to|for|about|regarding|re)\s+.*$', '', 'i');
  elsif v_lower ~ '(^|[^a-z0-9])(follow[ -]?up|chase|check with|ping)([^a-z0-9]|$)' then
    v_entity := regexp_replace(v_text, '^.*?\b(follow[ -]?up with|follow[ -]?up|chase|check with|ping)\s+', '', 'i');
    v_entity := regexp_replace(v_entity, '\s+(and|to|for|about|regarding|re)\s+.*$', '', 'i');
  elsif v_lower ~ '(^|[^a-z0-9])(meet|meeting with|sync with|discussion with)([^a-z0-9]|$)' then
    v_entity := regexp_replace(v_text, '^.*?\b(meeting with|meet|sync with|discussion with)\s+', '', 'i');
    v_entity := regexp_replace(v_entity, '\s+(and|to|for|about|regarding|re)\s+.*$', '', 'i');
  elsif v_lower ~ '(^|[^a-z0-9])(pay|payment|bill|invoice)([^a-z0-9]|$)' then
    v_entity := regexp_replace(v_text, '^.*?\b(pay|payment for|bill for|invoice for)\s+', '', 'i');
    v_entity := regexp_replace(v_entity, '\s+(and|to|for|about|regarding|re)\s+.*$', '', 'i');
  else
    return null;
  end if;

  -- Clean noise.
  v_entity := trim(coalesce(v_entity, ''));
  v_entity := regexp_replace(v_entity, '["“”‘’]', '', 'g');
  v_entity := regexp_replace(v_entity, '\s+', ' ', 'g');
  v_entity := regexp_replace(v_entity, '[\.,;:!]+$', '', 'g');

  -- Keep short, useful entities only.
  if length(v_entity) < 2 or length(v_entity) > 60 then
    return null;
  end if;

  -- Avoid useless entities.
  if lower(v_entity) in ('me', 'myself', 'someone', 'them', 'him', 'her', 'it', 'this', 'that', 'appointment', 'meeting') then
    return null;
  end if;

  -- Title case-ish output. initcap works well enough for v1.
  return initcap(v_entity);
end;
$$;

-- Reuse/replace merge helper so contacts are deduped and counted.
create or replace function public.memory_twin_merge_count_array(p_existing jsonb, p_value text)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_existing jsonb := coalesce(p_existing, '[]'::jsonb);
  v_result jsonb;
begin
  if p_value is null or length(trim(p_value)) = 0 then
    return v_existing;
  end if;

  with expanded as (
    select
      coalesce(item->>'value', item->>'name', item->>'label') as value,
      greatest(coalesce((item->>'count')::int, 1), 1) as count,
      coalesce(item->>'last_seen', now()::text) as last_seen
    from jsonb_array_elements(v_existing) item
    where coalesce(item->>'value', item->>'name', item->>'label') is not null

    union all

    select trim(p_value), 1, now()::text
  ), grouped as (
    select
      value,
      sum(count)::int as count,
      max(last_seen) as last_seen
    from expanded
    where value is not null and trim(value) <> ''
    group by lower(value), value
    order by sum(count) desc, max(last_seen) desc
    limit 10
  )
  select coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', count, 'last_seen', last_seen)), '[]'::jsonb)
  into v_result
  from grouped;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- Upgrade conversation trigger to learn entities from text.
create or replace function public.memory_twin_log_conversation_event()
returns trigger
language plpgsql
security definer
as $$
declare
  v_memory_enabled boolean := true;
  v_task_type text;
  v_entity text;
begin
  if new.telegram_id is null or new.role <> 'user' then
    return new;
  end if;

  perform public.ensure_memory_twin_user(new.telegram_id);

  select coalesce(memory_enabled, true)
  into v_memory_enabled
  from public.user_consent_settings
  where telegram_id = new.telegram_id;

  if coalesce(v_memory_enabled, true) = false then
    return new;
  end if;

  v_task_type := public.memory_twin_task_type(new.content);
  v_entity := public.memory_twin_entity_from_text(new.content);

  insert into public.user_behavior_events (telegram_id, event_type, event_payload, source)
  values (
    new.telegram_id,
    'message_received',
    jsonb_build_object(
      'text', coalesce(new.content, ''),
      'length', length(coalesce(new.content, '')),
      'task_type', v_task_type,
      'entity', v_entity,
      'conversation_created_at', new.created_at
    ),
    'whatsapp'
  );

  update public.user_memory_profile
  set
    frequent_tasks = public.memory_twin_merge_count_array(frequent_tasks, v_task_type),
    frequent_contacts = public.memory_twin_merge_count_array(frequent_contacts, v_entity),
    last_updated = now()
  where telegram_id = new.telegram_id;

  return new;
end;
$$;

-- Upgrade reminder trigger to learn entities from reminder message.
create or replace function public.memory_twin_log_reminder_event()
returns trigger
language plpgsql
security definer
as $$
declare
  v_memory_enabled boolean := true;
  v_time_label text;
  v_task_type text;
  v_entity text;
begin
  if new.telegram_id is null then
    return new;
  end if;

  perform public.ensure_memory_twin_user(new.telegram_id);

  select coalesce(memory_enabled, true)
  into v_memory_enabled
  from public.user_consent_settings
  where telegram_id = new.telegram_id;

  if coalesce(v_memory_enabled, true) = false then
    return new;
  end if;

  v_time_label := to_char(new.remind_at at time zone 'Asia/Kolkata', 'HH12:MI AM');
  v_task_type := public.memory_twin_task_type(new.message);
  v_entity := public.memory_twin_entity_from_text(new.message);

  insert into public.user_behavior_events (telegram_id, event_type, event_payload, source)
  values (
    new.telegram_id,
    'reminder_created',
    jsonb_build_object(
      'message', coalesce(new.message, ''),
      'remindAtIso', new.remind_at,
      'hour', v_time_label,
      'task_type', v_task_type,
      'entity', v_entity,
      'is_recurring', coalesce(new.is_recurring, false),
      'recurring_pattern', new.recurring_pattern
    ),
    case when new.whatsapp_to is not null then 'whatsapp' else 'telegram' end
  );

  update public.user_memory_profile
  set
    common_times = public.memory_twin_merge_count_array(common_times, v_time_label),
    frequent_tasks = public.memory_twin_merge_count_array(frequent_tasks, v_task_type),
    frequent_contacts = public.memory_twin_merge_count_array(frequent_contacts, v_entity),
    last_updated = now()
  where telegram_id = new.telegram_id;

  return new;
end;
$$;

-- Recreate triggers.
drop trigger if exists trg_memory_twin_conversation_event on public.conversations;
create trigger trg_memory_twin_conversation_event
after insert on public.conversations
for each row
execute function public.memory_twin_log_conversation_event();

drop trigger if exists trg_memory_twin_reminder_event on public.reminders;
create trigger trg_memory_twin_reminder_event
after insert on public.reminders
for each row
execute function public.memory_twin_log_reminder_event();

-- Backfill frequent_contacts from recent reminders.
with rebuilt_entities as (
  select
    telegram_id,
    jsonb_agg(
      jsonb_build_object(
        'value', entity,
        'count', entity_count,
        'last_seen', last_seen
      )
      order by entity_count desc, last_seen desc
    ) as frequent_contacts
  from (
    select
      telegram_id,
      public.memory_twin_entity_from_text(message) as entity,
      count(*)::int as entity_count,
      max(created_at)::text as last_seen
    from public.reminders
    where telegram_id is not null
      and created_at >= now() - interval '90 days'
      and public.memory_twin_entity_from_text(message) is not null
    group by telegram_id, public.memory_twin_entity_from_text(message)
  ) s
  group by telegram_id
)
update public.user_memory_profile p
set
  frequent_contacts = coalesce(r.frequent_contacts, '[]'::jsonb),
  last_updated = now()
from rebuilt_entities r
where p.telegram_id = r.telegram_id;

-- Verification query you can run after this file:
-- select public.memory_twin_entity_from_text('Call Dr Gautami'), public.memory_twin_entity_from_text('Follow up with Srini'), public.memory_twin_entity_from_text('Pay electricity bill');
