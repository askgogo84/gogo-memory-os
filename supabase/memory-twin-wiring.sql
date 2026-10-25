-- AskGogo Memory Twin v1 safe wiring
-- Run this in Supabase SQL Editor after supabase/memory-twin.sql.
-- This does not change existing bot behavior. It only mirrors existing activity into Memory Twin tables.

create extension if not exists pgcrypto;

-- 1) Ensure consent/profile rows exist for a user
create or replace function public.ensure_memory_twin_user(p_telegram_id bigint)
returns void
language plpgsql
security definer
as $$
begin
  if p_telegram_id is null then
    return;
  end if;

  insert into public.user_consent_settings (telegram_id, memory_enabled, proactive_suggestions_enabled)
  values (p_telegram_id, true, true)
  on conflict (telegram_id) do nothing;

  insert into public.user_memory_profile (telegram_id, timezone, communication_style)
  values (p_telegram_id, 'Asia/Kolkata', 'warm, concise, helpful')
  on conflict (telegram_id) do nothing;
end;
$$;

-- 2) Log user conversations into Memory Twin events
create or replace function public.memory_twin_log_conversation_event()
returns trigger
language plpgsql
security definer
as $$
declare
  v_memory_enabled boolean := true;
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

  insert into public.user_behavior_events (telegram_id, event_type, event_payload, source)
  values (
    new.telegram_id,
    'message_received',
    jsonb_build_object(
      'text', coalesce(new.content, ''),
      'length', length(coalesce(new.content, '')),
      'conversation_created_at', new.created_at
    ),
    'whatsapp'
  );

  update public.user_memory_profile
  set
    preferred_name = coalesce(preferred_name, null),
    frequent_tasks = (
      select jsonb_agg(item order by (item->>'count')::int desc)
      from (
        select item
        from jsonb_array_elements(
          coalesce(frequent_tasks, '[]'::jsonb) ||
          jsonb_build_array(jsonb_build_object(
            'value',
            case
              when lower(coalesce(new.content, '')) like '%call%' then 'call'
              when lower(coalesce(new.content, '')) like '%follow%' then 'follow-up'
              when lower(coalesce(new.content, '')) like '%meeting%' then 'meeting'
              when lower(coalesce(new.content, '')) like '%expense%' or lower(coalesce(new.content, '')) like '%spent%' then 'expense'
              when lower(coalesce(new.content, '')) like '%briefing%' then 'briefing'
              when lower(coalesce(new.content, '')) like '%note%' then 'note'
              else 'general'
            end,
            'count', 1,
            'last_seen', now()
          ))
        ) item
        limit 10
      ) s
    ),
    last_updated = now()
  where telegram_id = new.telegram_id;

  return new;
end;
$$;

drop trigger if exists trg_memory_twin_conversation_event on public.conversations;
create trigger trg_memory_twin_conversation_event
after insert on public.conversations
for each row
execute function public.memory_twin_log_conversation_event();

-- 3) Log created reminders into Memory Twin events
create or replace function public.memory_twin_log_reminder_event()
returns trigger
language plpgsql
security definer
as $$
declare
  v_memory_enabled boolean := true;
  v_time_label text;
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

  insert into public.user_behavior_events (telegram_id, event_type, event_payload, source)
  values (
    new.telegram_id,
    'reminder_created',
    jsonb_build_object(
      'message', coalesce(new.message, ''),
      'remindAtIso', new.remind_at,
      'hour', v_time_label,
      'is_recurring', coalesce(new.is_recurring, false),
      'recurring_pattern', new.recurring_pattern
    ),
    case when new.whatsapp_to is not null then 'whatsapp' else 'telegram' end
  );

  update public.user_memory_profile
  set
    common_times = (
      select jsonb_agg(item)
      from (
        select item
        from jsonb_array_elements(
          jsonb_build_array(jsonb_build_object('value', v_time_label, 'count', 1, 'last_seen', now())) || coalesce(common_times, '[]'::jsonb)
        ) item
        limit 10
      ) s
    ),
    frequent_tasks = (
      select jsonb_agg(item)
      from (
        select item
        from jsonb_array_elements(
          jsonb_build_array(jsonb_build_object(
            'value',
            case
              when lower(coalesce(new.message, '')) like '%call%' then 'call'
              when lower(coalesce(new.message, '')) like '%follow%' then 'follow-up'
              when lower(coalesce(new.message, '')) like '%meeting%' then 'meeting'
              when lower(coalesce(new.message, '')) like '%pay%' then 'payment'
              when lower(coalesce(new.message, '')) like '%doctor%' or lower(coalesce(new.message, '')) like '%dr %' then 'health'
              else 'general'
            end,
            'count', 1,
            'last_seen', now()
          )) || coalesce(frequent_tasks, '[]'::jsonb)
        ) item
        limit 10
      ) s
    ),
    last_updated = now()
  where telegram_id = new.telegram_id;

  return new;
end;
$$;

drop trigger if exists trg_memory_twin_reminder_event on public.reminders;
create trigger trg_memory_twin_reminder_event
after insert on public.reminders
for each row
execute function public.memory_twin_log_reminder_event();

-- 4) Backfill profiles for existing users if users table exists
insert into public.user_memory_profile (telegram_id, preferred_name, timezone, communication_style)
select telegram_id, name, coalesce(timezone, 'Asia/Kolkata'), 'warm, concise, helpful'
from public.users
where telegram_id is not null
on conflict (telegram_id) do nothing;

insert into public.user_consent_settings (telegram_id, memory_enabled, proactive_suggestions_enabled)
select telegram_id, true, true
from public.users
where telegram_id is not null
on conflict (telegram_id) do nothing;
