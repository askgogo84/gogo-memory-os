-- AskGogo Memory: Important people/entities v2
-- Fixes entity extraction so verbs are removed correctly.
-- Safe to run multiple times.

create extension if not exists pgcrypto;

create or replace function public.memory_twin_entity_from_text(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  v_text text := trim(coalesce(p_text, ''));
  v_lower text;
  v_entity text;
begin
  if length(v_text) = 0 then
    return null;
  end if;

  -- Remove common reminder/date/time prefixes.
  v_text := regexp_replace(v_text, '^\s*(remind me|reminder|set reminder|set an alarm|alarm)\s+', '', 'i');
  v_text := regexp_replace(v_text, '^\s*(tomorrow|today|day after tomorrow|next week|next month)\s+', '', 'i');
  v_text := regexp_replace(v_text, '^\s*(at|on|by)\s+\d{1,2}(:\d{2})?\s*(am|pm)?\s+', '', 'i');
  v_text := regexp_replace(v_text, '^\s*to\s+', '', 'i');
  v_text := trim(v_text);
  v_lower := lower(v_text);

  -- Call patterns.
  if v_lower ~ '^(call|phone|ring|dial)\s+' then
    v_entity := regexp_replace(v_text, '^\s*(call|phone|ring|dial)\s+', '', 'i');
    v_entity := regexp_replace(v_entity, '\s+(and|then|to|for|about|regarding|re|get|ask|check)\s+.*$', '', 'i');

  -- Follow-up patterns.
  elsif v_lower ~ '^(follow[ -]?up with|follow[ -]?up|chase|check with|ping)\s+' then
    v_entity := regexp_replace(v_text, '^\s*(follow[ -]?up with|follow[ -]?up|chase|check with|ping)\s+', '', 'i');
    v_entity := regexp_replace(v_entity, '\s+(and|then|to|for|about|regarding|re|get|ask|check)\s+.*$', '', 'i');

  -- Meeting patterns.
  elsif v_lower ~ '^(meeting with|meet|sync with|discussion with)\s+' then
    v_entity := regexp_replace(v_text, '^\s*(meeting with|meet|sync with|discussion with)\s+', '', 'i');
    v_entity := regexp_replace(v_entity, '\s+(and|then|to|for|about|regarding|re|get|ask|check)\s+.*$', '', 'i');

  -- Payment/bill patterns.
  elsif v_lower ~ '^(pay|payment for|bill for|invoice for)\s+' then
    v_entity := regexp_replace(v_text, '^\s*(pay|payment for|bill for|invoice for)\s+', '', 'i');
    v_entity := regexp_replace(v_entity, '\s+(and|then|to|for|about|regarding|re|get|ask|check)\s+.*$', '', 'i');

  else
    return null;
  end if;

  -- Clean noise.
  v_entity := trim(coalesce(v_entity, ''));
  v_entity := regexp_replace(v_entity, '["“”‘’]', '', 'g');
  v_entity := regexp_replace(v_entity, '\s+', ' ', 'g');
  v_entity := regexp_replace(v_entity, '[\.,;:!]+$', '', 'g');

  if length(v_entity) < 2 or length(v_entity) > 60 then
    return null;
  end if;

  if lower(v_entity) in ('me', 'myself', 'someone', 'them', 'him', 'her', 'it', 'this', 'that', 'appointment', 'meeting') then
    return null;
  end if;

  return initcap(v_entity);
end;
$$;

-- Backfill frequent_contacts from recent reminders with corrected extraction.
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

-- Clear stale verb-prefixed entities from profiles where no rebuilt rows exist.
update public.user_memory_profile
set frequent_contacts = coalesce((
  select jsonb_agg(item)
  from jsonb_array_elements(coalesce(frequent_contacts, '[]'::jsonb)) item
  where lower(coalesce(item->>'value', '')) not like 'call %'
    and lower(coalesce(item->>'value', '')) not like 'follow up %'
    and lower(coalesce(item->>'value', '')) not like 'pay %'
), '[]'::jsonb),
last_updated = now();

-- Verification query to run after this file:
-- select public.memory_twin_entity_from_text('Call Dr Gautami') as test_1, public.memory_twin_entity_from_text('Follow up with Srini') as test_2, public.memory_twin_entity_from_text('Pay electricity bill') as test_3;
