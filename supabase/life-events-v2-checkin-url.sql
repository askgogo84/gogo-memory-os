-- Universal Life Event Engine v2 — verified airline check-in URL enrichment.
-- Keep the DB promotion trigger generic, but enrich the prepare-web-checkin action
-- only for airline URLs that are explicitly verified in lib/services/airline-checkin.ts.
-- Unknown/unverified airlines intentionally remain without checkInUrl and the
-- background executor pauses safely rather than guessing a deep link.

create or replace function gogo_verified_checkin_url(p_flight_no text)
returns text
language sql
immutable
as $$
  select case upper(substring(regexp_replace(coalesce(p_flight_no,''), '[^A-Za-z0-9]', '', 'g') from 1 for 2))
    when '6E' then 'https://www.goindigo.in/web-check-in.html'
    when 'AI' then 'https://www.airindia.com/in/en/manage/web-checkin.html'
    when 'IX' then 'https://www.airindiaexpress.com/checkin-home'
    when 'EY' then 'https://www.etihad.com/en/manage/check-in'
    else null
  end;
$$;

create or replace function gogo_enrich_life_event_checkin_url()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flight_no text;
  v_url text;
begin
  if new.action_key <> 'prepare-web-checkin' then
    return new;
  end if;

  select nullif(metadata_json->>'flight_no','')
    into v_flight_no
    from life_events
    where id = new.life_event_id
      and telegram_id = new.telegram_id
      and event_type = 'travel'
      and subtype = 'flight';

  if v_flight_no is null then
    v_flight_no := nullif(new.payload_json->>'flight_no','');
  end if;
  v_url := gogo_verified_checkin_url(v_flight_no);

  if v_url is not null and coalesce(new.payload_json->>'checkInUrl','') = '' then
    new.payload_json := coalesce(new.payload_json,'{}'::jsonb) || jsonb_build_object(
      'checkInUrl', v_url,
      'checkInUrlVerified', true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists life_event_checkin_url_enrich on life_event_actions;
create trigger life_event_checkin_url_enrich
before insert or update of payload_json, action_key on life_event_actions
for each row execute function gogo_enrich_life_event_checkin_url();

-- Backfill existing promoted flights so already-forwarded tickets can enter the
-- same lifecycle without being forwarded again.
update life_event_actions a
set payload_json = coalesce(a.payload_json,'{}'::jsonb) || jsonb_build_object(
      'checkInUrl', gogo_verified_checkin_url(coalesce(e.metadata_json->>'flight_no', a.payload_json->>'flight_no')),
      'checkInUrlVerified', true
    ),
    updated_at = now()
from life_events e
where a.life_event_id = e.id
  and a.telegram_id = e.telegram_id
  and a.action_key = 'prepare-web-checkin'
  and e.event_type = 'travel'
  and e.subtype = 'flight'
  and coalesce(a.payload_json->>'checkInUrl','') = ''
  and gogo_verified_checkin_url(coalesce(e.metadata_json->>'flight_no', a.payload_json->>'flight_no')) is not null;
