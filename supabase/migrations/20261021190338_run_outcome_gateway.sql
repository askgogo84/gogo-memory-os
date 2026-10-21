begin;
set local lock_timeout='5s';
alter table public.notification_deliveries drop constraint notification_deliveries_source_check;
alter table public.notification_deliveries add constraint notification_deliveries_source_check
 check(source in ('briefing','followup','price_comparison','travel_research','watch_alert','run_outcome'));
-- Marks claims made by this bridge, never inferred from an aged legacy JSON intent.
alter table public.notification_deliveries add column run_outcome_bridge boolean not null default false;

create function public.mark_stale_run_outcome_request() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.status='running' and new.status='failed' and new.error='stale_run_recovered'
   and new.type is distinct from 'secure_browser' and coalesce(new.metadata_json->>'plan_type','')<>'secure_browser' then
   new.metadata_json:=coalesce(new.metadata_json,'{}'::jsonb)||'{"outcome_notice_requested":true}'::jsonb;
 end if;
 return new;
end $$;
create trigger stale_run_outcome_request before update on public.agent_runs
 for each row execute function public.mark_stale_run_outcome_request();

create function public.claim_run_outcome_delivery(p_key text,p_owner bigint,p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare r public.agent_runs; j public.notification_deliveries; run_id text:=split_part(p_key,'/',2);
begin
 if p_owner is null or p_token is null or p_key<>'run_outcome/'||run_id||'/whatsapp' then return false; end if;
 -- Run -> ledger lock order is shared by claim and begin. Marker trigger never locks ledger.
 select * into r from public.agent_runs where id::text=run_id for update;
 if not found or r.telegram_id::text is distinct from p_owner::text or r.status not in ('completed','failed','outcome_unknown')
   or r.completed_at is null or r.metadata_json->'outcome_notice_requested' is distinct from 'true'::jsonb
   or r.type='secure_browser' or coalesce(r.metadata_json->>'plan_type','')='secure_browser'
   or r.metadata_json->>'outcome_notified_at' is not null or r.metadata_json->>'notified'='true' then return false; end if;
 select * into j from public.notification_deliveries where delivery_key=p_key for update;
 if (r.metadata_json->>'outcome_notice_claimed_at' is not null or r.metadata_json->>'outcome_notice_claim_id' is not null)
   and not (coalesce(j.run_outcome_bridge,false) and j.source='run_outcome' and j.owner_id=p_owner
     and j.send_started_at is null and j.provider_id is null and j.state in ('pending','claimed')) then return false; end if;
 insert into public.notification_deliveries(delivery_key,source,owner_id,channel,due_at)
   values(p_key,'run_outcome',p_owner,'whatsapp',r.completed_at) on conflict do nothing;
 update public.notification_deliveries set state='claimed',claim_token=p_token,
   lease_until=clock_timestamp()+interval '90 seconds',run_outcome_bridge=true,updated_at=clock_timestamp()
   where delivery_key=p_key and owner_id=p_owner and source='run_outcome' and channel='whatsapp'
   and due_at<=clock_timestamp() and (retry_at is null or retry_at<=clock_timestamp()) and send_started_at is null
   and (state='pending' or (state='claimed' and lease_until<clock_timestamp()));
 if not found then return false; end if;
 -- Old deployments use IS NULL on this field, so they cannot independently send.
 update public.agent_runs set metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object(
   'outcome_notice_claimed_at',clock_timestamp(),'outcome_notice_claim_id',p_token::text) where id=r.id;
 return true;
end $$;

create function public.begin_run_outcome_delivery(p_key text,p_token uuid,p_target text,p_snapshot jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare r public.agent_runs; j public.notification_deliveries; u public.users; hour integer; actual jsonb;
begin
 select * into r from public.agent_runs where id::text=split_part(p_key,'/',2) for update;
 if not found then return false; end if;
 select * into j from public.notification_deliveries where delivery_key=p_key and claim_token=p_token
   and source='run_outcome' and run_outcome_bridge and state='claimed' and send_started_at is null
   and lease_until>clock_timestamp() for update;
 if not found or r.telegram_id::text is distinct from j.owner_id::text or r.status not in ('completed','failed','outcome_unknown')
   or r.metadata_json->'outcome_notice_requested' is distinct from 'true'::jsonb
   or r.metadata_json->>'outcome_notice_claim_id' is distinct from p_token::text
   or r.metadata_json->>'outcome_notified_at' is not null or r.metadata_json->>'notified'='true'
   or r.type='secure_browser' or coalesce(r.metadata_json->>'plan_type','')='secure_browser' then return false; end if;
 actual:=jsonb_build_object('status',r.status,'title',r.title,'summary',r.summary,'error',r.error,
   'outcome_state',r.metadata_json->'outcome_state','reconciliation_required',coalesce(r.metadata_json->'reconciliation_required'='true'::jsonb,false));
 if actual is distinct from p_snapshot then return false; end if;
 select * into u from public.users where telegram_id=j.owner_id for share;
 if not found or u.whatsapp_id is distinct from p_target or coalesce(p_target,'')='' then return false; end if;
 if exists(select 1 from public.reminder_optout where owner_telegram_id=j.owner_id
   and regexp_replace(recipient_whatsapp_id,'[^0-9]','','g')=regexp_replace(p_target,'[^0-9]','','g')) then return false; end if;
 hour:=extract(hour from clock_timestamp() at time zone coalesce(nullif(u.timezone,''),'Asia/Kolkata'));
 if hour<7 or hour>=22 then return false; end if;
 update public.notification_deliveries set state='outcome_unknown',send_started_at=clock_timestamp(),updated_at=clock_timestamp()
   where delivery_key=p_key;
 return true;
end $$;

create function public.defer_notification_delivery(p_key text,p_token uuid,p_until timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_until is null or p_until<=clock_timestamp() or p_until>clock_timestamp()+interval '25 hours' then return false; end if;
 update public.notification_deliveries set state='pending',retry_at=p_until,claim_token=null,lease_until=null,updated_at=clock_timestamp()
   where delivery_key=p_key and claim_token=p_token and state='claimed' and send_started_at is null and lease_until>clock_timestamp();
 return found;
end $$;

create function public.due_run_outcome_deliveries(p_limit integer default 10) returns table(run_id uuid,owner_id text)
language sql security invoker set search_path='' as $$
 select r.id,r.telegram_id::text from public.agent_runs r
 left join public.notification_deliveries j on j.delivery_key='run_outcome/'||r.id::text||'/whatsapp'
 where r.status in ('completed','failed','outcome_unknown') and r.completed_at<=clock_timestamp()
 and r.metadata_json->'outcome_notice_requested'='true'::jsonb
 and coalesce(r.type,'')<>'secure_browser' and coalesce(r.metadata_json->>'plan_type','')<>'secure_browser'
 and r.metadata_json->>'outcome_notified_at' is null and coalesce(r.metadata_json->>'notified','false')<>'true'
 and ((r.metadata_json->>'outcome_notice_claimed_at' is null and r.metadata_json->>'outcome_notice_claim_id' is null)
   or (j.run_outcome_bridge and j.source='run_outcome' and j.owner_id::text=r.telegram_id::text
     and j.send_started_at is null and j.provider_id is null and j.state in ('pending','claimed')))
 and (j.delivery_key is null or (j.source='run_outcome' and j.owner_id::text=r.telegram_id::text and j.channel='whatsapp'
   and j.send_started_at is null and (j.retry_at is null or j.retry_at<=clock_timestamp())
   and (j.state='pending' or (j.state='claimed' and j.lease_until<clock_timestamp()))))
 order by r.completed_at,r.id limit least(greatest(p_limit,1),50)
$$;

-- Preserve the existing follow-up source guard. Run outcomes require the stricter RPC above.
create or replace function public.begin_notification_delivery(p_key text,p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare job public.notification_deliveries; source_row public.followups;
begin
 select * into job from public.notification_deliveries where delivery_key=p_key and claim_token=p_token
   and state='claimed' and lease_until>clock_timestamp() for update;
 if not found or job.source='run_outcome' then return false; end if;
 if job.source='followup' then
   select * into source_row from public.followups where id::text=split_part(p_key,'/',2) for update;
   if not found or source_row.owner_id is distinct from job.owner_id or source_row.status<>'pending' or source_row.check_at>clock_timestamp() then
     update public.notification_deliveries set state='cancelled',lease_until=null,updated_at=clock_timestamp() where delivery_key=p_key;
     return false;
   end if;
 end if;
 update public.notification_deliveries set state='outcome_unknown',send_started_at=clock_timestamp(),updated_at=clock_timestamp() where delivery_key=p_key;
 return true;
end $$;
-- Compatibility flags are repairable projections, never the delivery authority.
create function public.reconcile_run_outcome_notice_flags(p_limit integer default 10) returns integer
language plpgsql security invoker set search_path='' as $$
declare item record; n integer:=0;
begin
 for item in select r.id,j.accepted_at,j.provider_id from public.agent_runs r
   join public.notification_deliveries j on j.delivery_key='run_outcome/'||r.id::text||'/whatsapp'
   where j.source='run_outcome' and j.owner_id::text=r.telegram_id::text and j.run_outcome_bridge
   and j.state in ('provider_accepted','delivered','read') and j.provider_id is not null
   and r.metadata_json->>'outcome_notified_at' is null
   order by r.completed_at,r.id limit least(greatest(p_limit,1),50) for update of r skip locked loop
   update public.agent_runs set metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object(
     'outcome_notified_at',coalesce(item.accepted_at,clock_timestamp()),'outcome_notice_provider_id',item.provider_id) where id=item.id;
   n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.reconcile_run_outcome_notice_flags(integer) from public,anon,authenticated;
grant execute on function public.reconcile_run_outcome_notice_flags(integer) to service_role;

revoke all on function public.mark_stale_run_outcome_request(),public.claim_run_outcome_delivery(text,bigint,uuid),
 public.begin_run_outcome_delivery(text,uuid,text,jsonb),public.defer_notification_delivery(text,uuid,timestamptz),
 public.due_run_outcome_deliveries(integer) from public,anon,authenticated;
grant execute on function public.mark_stale_run_outcome_request(),public.claim_run_outcome_delivery(text,bigint,uuid),
 public.begin_run_outcome_delivery(text,uuid,text,jsonb),public.defer_notification_delivery(text,uuid,timestamptz),
 public.due_run_outcome_deliveries(integer) to service_role;
commit;
