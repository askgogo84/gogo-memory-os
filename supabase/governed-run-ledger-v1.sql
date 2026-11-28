-- Draft for owner-reviewed migration, not an applied migration.
-- Per-run limits; monthly/workspace-wide budget provisioning remains separate.
-- Only trusted service-role callers can provision budgets or invoke the RPCs.
begin;
create table public.gogo_governed_runs (
  scope_kind text not null check (scope_kind in ('personal','workspace')),
  scope_id text not null,
  run_id text not null check (run_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  actor_id text not null check (actor_id ~ '^-?[1-9][0-9]{0,18}$'),
  deadline_at timestamptz not null,
  max_cost_micros bigint not null check (max_cost_micros between 0 and 9007199254740991),
  max_tokens bigint not null check (max_tokens between 0 and 9007199254740991),
  max_model_calls integer not null check (max_model_calls between 0 and 100000),
  max_tool_calls integer not null check (max_tool_calls between 0 and 100000),
  charged_cost_micros bigint not null default 0 check (charged_cost_micros >= 0),
  charged_tokens bigint not null default 0 check (charged_tokens >= 0),
  model_calls integer not null default 0 check (model_calls >= 0),
  tool_calls integer not null default 0 check (tool_calls >= 0),
  breached boolean not null default false,
  primary key (scope_kind,scope_id,run_id),
  check ((scope_kind='personal' and scope_id=actor_id) or
    (scope_kind='workspace' and scope_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
);
create table public.gogo_governed_attempts (
  scope_kind text not null, scope_id text not null, run_id text not null,
  attempt_id text not null check (attempt_id ~ '^[A-Za-z0-9_:-]{1,160}$'),
  kind text not null check (kind in ('model','tool')),
  reserved_cost_micros bigint not null check (reserved_cost_micros >= 0),
  reserved_tokens bigint not null check (reserved_tokens >= 0),
  actual_cost_micros bigint check (actual_cost_micros >= 0),
  actual_tokens bigint check (actual_tokens >= 0),
  state text not null default 'reserved' check (state in ('reserved','settled','unknown')),
  reserved_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  primary key (scope_kind,scope_id,run_id,attempt_id),
  foreign key (scope_kind,scope_id,run_id) references public.gogo_governed_runs(scope_kind,scope_id,run_id) on delete restrict
);
alter table public.gogo_governed_runs enable row level security;
alter table public.gogo_governed_attempts enable row level security;
revoke all on public.gogo_governed_runs,public.gogo_governed_attempts from public,anon,authenticated;
grant select,insert,update on public.gogo_governed_runs,public.gogo_governed_attempts to service_role;

create function public.gogo_reserve_governed_attempt(
  p_scope_kind text,p_scope_id text,p_run_id text,p_actor_id text,p_attempt_id text,
  p_kind text,p_cost_micros bigint,p_tokens bigint
) returns text language plpgsql security invoker set search_path='' as $$
declare r public.gogo_governed_runs%rowtype;
begin
  if p_kind is null or p_kind not in ('model','tool') or p_attempt_id is null or
    p_attempt_id !~ '^[A-Za-z0-9_:-]{1,160}$' or p_cost_micros is null or p_tokens is null or
    p_cost_micros not between 0 and 9007199254740991 or p_tokens not between 0 and 9007199254740991 then
    return 'invalid';
  end if;
  select * into r from public.gogo_governed_runs where scope_kind=p_scope_kind and scope_id=p_scope_id
    and run_id=p_run_id and actor_id=p_actor_id for update;
  if not found then return 'unavailable'; end if;
  if r.breached then return 'breach'; end if;
  if r.deadline_at <= clock_timestamp() then return 'deadline'; end if;
  if exists (select 1 from public.gogo_governed_attempts where scope_kind=p_scope_kind and scope_id=p_scope_id
    and run_id=p_run_id and attempt_id=p_attempt_id) then return 'duplicate'; end if;
  if (p_kind='model' and r.model_calls>=r.max_model_calls) or
     (p_kind='tool' and r.tool_calls>=r.max_tool_calls) then return 'steps'; end if;
  if r.charged_cost_micros>r.max_cost_micros or p_cost_micros>r.max_cost_micros-r.charged_cost_micros then return 'cost'; end if;
  if r.charged_tokens>r.max_tokens or p_tokens>r.max_tokens-r.charged_tokens then return 'tokens'; end if;
  insert into public.gogo_governed_attempts(scope_kind,scope_id,run_id,attempt_id,kind,reserved_cost_micros,reserved_tokens)
    values(p_scope_kind,p_scope_id,p_run_id,p_attempt_id,p_kind,p_cost_micros,p_tokens);
  update public.gogo_governed_runs set charged_cost_micros=charged_cost_micros+p_cost_micros,
    charged_tokens=charged_tokens+p_tokens,model_calls=model_calls+(p_kind='model')::integer,
    tool_calls=tool_calls+(p_kind='tool')::integer
    where scope_kind=p_scope_kind and scope_id=p_scope_id and run_id=p_run_id;
  return 'reserved';
end $$;

create function public.gogo_settle_governed_attempt(
  p_scope_kind text,p_scope_id text,p_run_id text,p_actor_id text,p_attempt_id text,
  p_cost_micros bigint,p_tokens bigint
) returns text language plpgsql security invoker set search_path='' as $$
declare r public.gogo_governed_runs%rowtype;
declare a public.gogo_governed_attempts%rowtype;
begin
  select * into r from public.gogo_governed_runs where scope_kind=p_scope_kind and scope_id=p_scope_id
    and run_id=p_run_id and actor_id=p_actor_id for update;
  if not found then return 'unavailable'; end if;
  select * into a from public.gogo_governed_attempts where scope_kind=p_scope_kind and scope_id=p_scope_id
    and run_id=p_run_id and attempt_id=p_attempt_id;
  if not found then return 'unavailable'; end if;
  if a.state <> 'reserved' then return 'duplicate'; end if;
  -- No authoritative actual usage: keep the original charge and halt new attempts until reconciliation.
  if p_cost_micros is null or p_tokens is null or p_cost_micros not between 0 and 9007199254740991 or
    p_tokens not between 0 and 9007199254740991 then
    update public.gogo_governed_attempts set state='unknown',settled_at=clock_timestamp()
      where scope_kind=p_scope_kind and scope_id=p_scope_id and run_id=p_run_id and attempt_id=p_attempt_id;
    update public.gogo_governed_runs set breached=true where scope_kind=p_scope_kind and scope_id=p_scope_id and run_id=p_run_id;
    return 'unknown';
  end if;
  update public.gogo_governed_attempts set state='settled',actual_cost_micros=p_cost_micros,actual_tokens=p_tokens,settled_at=clock_timestamp()
    where scope_kind=p_scope_kind and scope_id=p_scope_id and run_id=p_run_id and attempt_id=p_attempt_id;
  update public.gogo_governed_runs set charged_cost_micros=charged_cost_micros-a.reserved_cost_micros+p_cost_micros,
    charged_tokens=charged_tokens-a.reserved_tokens+p_tokens,
    breached=breached or p_cost_micros>a.reserved_cost_micros or p_tokens>a.reserved_tokens
    where scope_kind=p_scope_kind and scope_id=p_scope_id and run_id=p_run_id;
  if p_cost_micros>a.reserved_cost_micros or p_tokens>a.reserved_tokens then return 'breach'; end if;
  return 'settled';
end $$;
revoke all on function public.gogo_reserve_governed_attempt(text,text,text,text,text,text,bigint,bigint) from public,anon,authenticated;
revoke all on function public.gogo_settle_governed_attempt(text,text,text,text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.gogo_reserve_governed_attempt(text,text,text,text,text,text,bigint,bigint) to service_role;
grant execute on function public.gogo_settle_governed_attempt(text,text,text,text,text,bigint,bigint) to service_role;
commit;
