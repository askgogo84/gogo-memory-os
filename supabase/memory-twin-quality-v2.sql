-- AskGogo Memory Twin quality upgrade v2
-- Purpose: improve learned task categories and clean duplicate profile arrays.
-- Safe to run multiple times.

create extension if not exists pgcrypto;

create or replace function public.memory_twin_task_type(p_text text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_text, '')) ~ '\b(call|phone|ring|dial)\b' then 'call'
    when lower(coalesce(p_text, '')) ~ '\b(follow\s?up|follow-up|chase|check with|ping)\b' then 'follow-up'
    when lower(coalesce(p_text, '')) ~ '\b(meeting|meet|sync|discussion|call with|standup)\b' then 'meeting'
    when lower(coalesce(p_text, '')) ~ '\b(pay|payment|bill|emi|rent|invoice|recharge|transfer)\b' then 'payment'
    when lower(coalesce(p_text, '')) ~ '\b(doctor|dr\.?|hospital|medicine|tablet|health|clinic|appointment)\b' then 'health'
    when lower(coalesce(p_text, '')) ~ '\b(expense|spent|paid|cost|receipt)\b' then 'expense'
    when lower(coalesce(p_text, '')) ~ '\b(note|remember|save)\b' then 'note'
    when lower(coalesce(p_text, '')) ~ '\b(briefing|summary|plan my day|today)\b' then 'briefing'
    else 'general'
  end;
$$;

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

create or replace function public.memory_twin_log_conversation_event()
returns trigger
language plpgsql
security definer
as $$
declare
  v_memory_enabled boolean := true;
  v_task_type text;
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

  insert into public.user_behavior_events (telegram_id, event_type, event_payload, source)
  values (
    new.telegram_id,
    'message_received',
    jsonb_build_object(
      'text', coalesce(new.content, ''),
      'length', length(coalesce(new.content, '')),
      'task_type', v_task_type,
      'conversation_created_at', new.created_at
    ),
    'whatsapp'
  );

  update public.user_memory_profile
  set
    frequent_tasks = public.memory_twin_merge_count_array(frequent_tasks, v_task_type),
    last_updated = now()
  where telegram_id = new.telegram_id;

  return new;
end;
$$;

create or replace function public.memory_twin_log_reminder_event()
returns trigger
language plpgsql
security definer
as $$
declare
  v_memory_enabled boolean := true;
  v_time_label text;
  v_task_type text;
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

  insert into public.user_behavior_events (telegram_id, event_type, event_payload, source)
  values (
    new.telegram_id,
    'reminder_created',
    jsonb_build_object(
      'message', coalesce(new.message, ''),
      'remindAtIso', new.remind_at,
      'hour', v_time_label,
      'task_type', v_task_type,
      'is_recurring', coalesce(new.is_recurring, false),
      'recurring_pattern', new.recurring_pattern
    ),
    case when new.whatsapp_to is not null then 'whatsapp' else 'telegram' end
  );

  update public.user_memory_profile
  set
    common_times = public.memory_twin_merge_count_array(common_times, v_time_label),
    frequent_tasks = public.memory_twin_merge_count_array(frequent_tasks, v_task_type),
    last_updated = now()
  where telegram_id = new.telegram_id;

  return new;
end;
$$;

-- Recreate triggers to point at upgraded functions.
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

-- Clean existing duplicate arrays for all profiles.
update public.user_memory_profile
set
  common_times = coalesce((
    with expanded as (
      select coalesce(item->>'value', item->>'name', item->>'label') as value,
             greatest(coalesce((item->>'count')::int, 1), 1) as count,
             coalesce(item->>'last_seen', now()::text) as last_seen
      from jsonb_array_elements(coalesce(common_times, '[]'::jsonb)) item
      where coalesce(item->>'value', item->>'name', item->>'label') is not null
    ), grouped as (
      select value, sum(count)::int as count, max(last_seen) as last_seen
      from expanded
      group by lower(value), value
      order by sum(count) desc, max(last_seen) desc
      limit 10
    )
    select jsonb_agg(jsonb_build_object('value', value, 'count', count, 'last_seen', last_seen)) from grouped
  ), '[]'::jsonb),
  frequent_tasks = coalesce((
    with expanded as (
      select coalesce(item->>'value', item->>'name', item->>'label') as value,
             greatest(coalesce((item->>'count')::int, 1), 1) as count,
             coalesce(item->>'last_seen', now()::text) as last_seen
      from jsonb_array_elements(coalesce(frequent_tasks, '[]'::jsonb)) item
      where coalesce(item->>'value', item->>'name', item->>'label') is not null
    ), grouped as (
      select value, sum(count)::int as count, max(last_seen) as last_seen
      from expanded
      group by lower(value), value
      order by sum(count) desc, max(last_seen) desc
      limit 10
    )
    select jsonb_agg(jsonb_build_object('value', value, 'count', count, 'last_seen', last_seen)) from grouped
  ), '[]'::jsonb),
  last_updated = now();
