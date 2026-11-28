-- Draft migration: operator-configured, per-run and per-scope IST calendar-month budgets.
-- No defaults that enable spending. The service role may reserve and settle, not raise caps.
begin;
create table public.gogo_governed_policies (
  scope_kind text not null check(scope_kind in ('personal','workspace')),
  scope_id text not null,
  enabled boolean not null default false,
  valid_until timestamptz not null,
  run_seconds integer not null check(run_seconds between 1 and 600),
  run_cost_micros bigint not null check(run_cost_micros between 0 and 9007199254740991),
  run_tokens bigint not null check(run_tokens between 0 and 9007199254740991),
  run_model_calls integer not null check(run_model_calls between 0 and 100000),
  run_tool_calls integer not null check(run_tool_calls between 0 and 100000),
  month_cost_micros bigint not null check(month_cost_micros between 0 and 9007199254740991),
  month_tokens bigint not null check(month_tokens between 0 and 9007199254740991),
  month_model_calls bigint not null check(month_model_calls between 0 and 10000000),
  month_tool_calls bigint not null check(month_tool_calls between 0 and 10000000),
  -- Row-lock privilege only; service_role cannot change any substantive policy.
  lock_pad boolean not null default false check(lock_pad=false),
  primary key(scope_kind,scope_id),
  check ((scope_kind='personal' and scope_id ~ '^-?[1-9][0-9]{0,18}$') or
    (scope_kind='workspace' and scope_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
);
create table public.gogo_governed_runs (
  scope_kind text not null,
  scope_id text not null,
  run_id text not null check(run_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  actor_id text not null check(actor_id ~ '^-?[1-9][0-9]{0,18}$'),
  period_start date not null,
  deadline_at timestamptz not null,
  max_cost_micros bigint not null check(max_cost_micros between 0 and 9007199254740991),
  max_tokens bigint not null check(max_tokens between 0 and 9007199254740991),
  max_model_calls integer not null check(max_model_calls between 0 and 100000),
  max_tool_calls integer not null check(max_tool_calls between 0 and 100000),
  charged_cost_micros numeric(30,0) not null default 0 check(charged_cost_micros>=0),
  charged_tokens numeric(30,0) not null default 0 check(charged_tokens>=0),
  model_calls integer not null default 0 check(model_calls>=0),
  tool_calls integer not null default 0 check(tool_calls>=0),
  breached boolean not null default false,
  overrun boolean not null default false,
  primary key(scope_kind,scope_id,run_id),
  foreign key(scope_kind,scope_id) references public.gogo_governed_policies(scope_kind,scope_id) on delete restrict,
  check(scope_kind<>'personal' or scope_id=actor_id)
);
create index gogo_governed_period_idx on public.gogo_governed_runs(scope_kind,scope_id,period_start);
create table public.gogo_governed_attempts (
  scope_kind text not null, scope_id text not null, run_id text not null,
  attempt_id text not null check(attempt_id ~ '^[A-Za-z0-9_:-]{1,160}$'),
  kind text not null check(kind in ('model','tool')),
  reserved_cost_micros bigint not null check(reserved_cost_micros>=0),
  reserved_tokens bigint not null check(reserved_tokens>=0),
  actual_cost_micros bigint check(actual_cost_micros>=0),
  actual_tokens bigint check(actual_tokens>=0),
  state text not null default 'reserved' check(state in ('reserved','settled','unknown')),
  reserved_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  reconciliation_ref text,
  primary key(scope_kind,scope_id,run_id,attempt_id),
  foreign key(scope_kind,scope_id,run_id) references public.gogo_governed_runs(scope_kind,scope_id,run_id) on delete restrict
);
create index gogo_governed_pending_idx on public.gogo_governed_attempts(scope_kind,scope_id,run_id) where state in ('reserved','unknown');
alter table public.gogo_governed_policies enable row level security;
alter table public.gogo_governed_runs enable row level security;
alter table public.gogo_governed_attempts enable row level security;
revoke all on public.gogo_governed_policies,public.gogo_governed_runs,public.gogo_governed_attempts from public,anon,authenticated,service_role;
grant select on public.gogo_governed_policies to service_role;
grant update(lock_pad) on public.gogo_governed_policies to service_role;
grant select,insert,update on public.gogo_governed_runs,public.gogo_governed_attempts to service_role;

create function public.gogo_open_governed_run(p_scope_kind text,p_scope_id text,p_run_id text,p_actor_id text)
returns text language plpgsql security invoker set search_path='' as $$
declare
  pol public.gogo_governed_policies%rowtype;
  t timestamptz;
  m date;
begin
  if p_scope_kind is null or p_scope_kind not in ('personal','workspace') or p_scope_id is null or
    p_actor_id is null or p_actor_id !~ '^-?[1-9][0-9]{0,18}$' or
    p_run_id is null or p_run_id !~ '^[A-Za-z0-9_-]{1,128}$' or
    (p_scope_kind='personal' and p_scope_id is distinct from p_actor_id) then return 'invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_scope_kind||':'||p_scope_id,0));
  t:=clock_timestamp();
  m:=date_trunc('month',t at time zone 'Asia/Kolkata')::date;
  select * into pol from public.gogo_governed_policies where scope_kind=p_scope_kind and scope_id=p_scope_id for share;
  if not found or not pol.enabled or pol.valid_until<=t then return 'unavailable'; end if;
  insert into public.gogo_governed_runs(scope_kind,scope_id,run_id,actor_id,period_start,deadline_at,max_cost_micros,max_tokens,max_model_calls,max_tool_calls)
    values(p_scope_kind,p_scope_id,p_run_id,p_actor_id,m,
    least(t+make_interval(secs=>pol.run_seconds),pol.valid_until,((m+interval '1 month') at time zone 'Asia/Kolkata')),
    pol.run_cost_micros,pol.run_tokens,pol.run_model_calls,pol.run_tool_calls) on conflict do nothing;
  if not found then return 'duplicate'; end if;
  return 'opened';
end $$;

create function public.gogo_reserve_governed_attempt(
  p_scope_kind text,p_scope_id text,p_run_id text,p_actor_id text,p_attempt_id text,
  p_kind text,p_cost_micros bigint,p_tokens bigint
) returns text language plpgsql security invoker set search_path='' as $$
declare
  r public.gogo_governed_runs%rowtype;
  pol public.gogo_governed_policies%rowtype;
  totals record;
begin
  if p_scope_kind is null or p_scope_kind not in ('personal','workspace') or p_scope_id is null or
    p_kind is null or p_kind not in ('model','tool') or p_attempt_id is null or
    p_attempt_id !~ '^[A-Za-z0-9_:-]{1,160}$' or p_cost_micros is null or p_tokens is null or
    p_cost_micros not between 0 and 9007199254740991 or p_tokens not between 0 and 9007199254740991 then return 'invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_scope_kind||':'||p_scope_id,0));
  select * into pol from public.gogo_governed_policies where scope_kind=p_scope_kind and scope_id=p_scope_id for share;
  if not found or not pol.enabled or pol.valid_until<=clock_timestamp() then return 'unavailable'; end if;
  select * into r from public.gogo_governed_runs where scope_kind=p_scope_kind and scope_id=p_scope_id and run_id=p_run_id and actor_id=p_actor_id for update;
  if not found then return 'unavailable'; end if;
  if r.breached then return 'breach'; end if;
  if r.deadline_at<=clock_timestamp() or r.period_start<>date_trunc('month',clock_timestamp() at time zone 'Asia/Kolkata')::date then return 'deadline'; end if;
  -- Pending attempts never refund automatically. Unresolved outcomes in prior months also block.
  if exists(select 1 from public.gogo_governed_attempts a join public.gogo_governed_runs z using(scope_kind,scope_id,run_id)
    where a.scope_kind=p_scope_kind and a.scope_id=p_scope_id and (a.state='unknown' or (a.state='reserved' and z.deadline_at<=clock_timestamp()))) then return 'unresolved'; end if;
  if exists(select 1 from public.gogo_governed_attempts where scope_kind=p_scope_kind and scope_id=p_scope_id and run_id=p_run_id and attempt_id=p_attempt_id) then return 'duplicate'; end if;
  select coalesce(sum(charged_cost_micros),0) as cost,coalesce(sum(charged_tokens),0) as tokens,
    coalesce(sum(model_calls),0) as models,coalesce(sum(tool_calls),0) as tools,coalesce(bool_or(overrun),false) as breached
    into totals from public.gogo_governed_runs where scope_kind=p_scope_kind and scope_id=p_scope_id and period_start=r.period_start;
  if totals.breached then return 'breach'; end if;
  if (p_kind='model' and (r.model_calls>=least(r.max_model_calls,pol.run_model_calls) or totals.models>=pol.month_model_calls))
    or (p_kind='tool' and (r.tool_calls>=least(r.max_tool_calls,pol.run_tool_calls) or totals.tools>=pol.month_tool_calls)) then return 'steps'; end if;
  if r.charged_cost_micros+p_cost_micros>least(r.max_cost_micros,pol.run_cost_micros) or totals.cost+p_cost_micros>pol.month_cost_micros then return 'cost'; end if;
  if r.charged_tokens+p_tokens>least(r.max_tokens,pol.run_tokens) or totals.tokens+p_tokens>pol.month_tokens then return 'tokens'; end if;
  insert into public.gogo_governed_attempts(scope_kind,scope_id,run_id,attempt_id,kind,reserved_cost_micros,reserved_tokens)
    values(p_scope_kind,p_scope_id,p_run_id,p_attempt_id,p_kind,p_cost_micros,p_tokens);
  update public.gogo_governed_runs set charged_cost_micros=charged_cost_micros+p_cost_micros,
    charged_tokens=charged_tokens+p_tokens,model_calls=model_calls+(p_kind='model')::integer,tool_calls=tool_calls+(p_kind='tool')::integer
    where scope_kind=p_scope_kind and scope_id=p_scope_id and run_id=p_run_id;
  return 'reserved';
end $$;

-- Invoker-only internal settlement; receipt-based reconciliation remains operator-only.
create function public.gogo_finish_governed_attempt(
  p_scope_kind text,p_scope_id text,p_run_id text,p_actor_id text,p_attempt_id text,
  p_cost_micros bigint,p_tokens bigint,p_receipt_ref text
) returns text language plpgsql security invoker set search_path='' as $$
declare
  r public.gogo_governed_runs%rowtype;
  a public.gogo_governed_attempts%rowtype;
  exceeded boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_scope_kind||':'||p_scope_id,0));
  select * into r from public.gogo_governed_runs where scope_kind=p_scope_kind and scope_id=p_scope_id and run_id=p_run_id and actor_id=p_actor_id for update;
  if not found then return 'unavailable'; end if;
  select * into a from public.gogo_governed_attempts where scope_kind=p_scope_kind and scope_id=p_scope_id and run_id=p_run_id and attempt_id=p_attempt_id;
  if not found then return 'unavailable'; end if;
  if p_receipt_ref is not null then
    if current_user in ('service_role','anon','authenticated') then return 'unavailable'; end if;
    if p_receipt_ref !~ '^[A-Za-z0-9_:.@/-]{1,200}$' or (a.state<>'unknown' and not(a.state='reserved' and r.deadline_at<=clock_timestamp()))
      or p_cost_micros is null or p_tokens is null or p_cost_micros not between 0 and 9007199254740991 or p_tokens not between 0 and 9007199254740991 then return 'invalid'; end if;
  elsif a.state<>'reserved' then return 'duplicate'; end if;
  if p_cost_micros is null or p_tokens is null or p_cost_micros not between 0 and 9007199254740991 or p_tokens not between 0 and 9007199254740991 then
    update public.gogo_governed_attempts set state='unknown',settled_at=clock_timestamp()
      where scope_kind=p_scope_kind and scope_id=p_scope_id and run_id=p_run_id and attempt_id=p_attempt_id;
    update public.gogo_governed_runs set breached=true where scope_kind=p_scope_kind and scope_id=p_scope_id and run_id=p_run_id;
    return 'unknown';
  end if;
  exceeded:=p_cost_micros>a.reserved_cost_micros or p_tokens>a.reserved_tokens;
  update public.gogo_governed_attempts set state='settled',actual_cost_micros=p_cost_micros,actual_tokens=p_tokens,
    settled_at=clock_timestamp(),reconciliation_ref=p_receipt_ref
    where scope_kind=p_scope_kind and scope_id=p_scope_id and run_id=p_run_id and attempt_id=p_attempt_id;
  update public.gogo_governed_runs set charged_cost_micros=charged_cost_micros-a.reserved_cost_micros+p_cost_micros,
    charged_tokens=charged_tokens-a.reserved_tokens+p_tokens,breached=breached or exceeded,overrun=overrun or exceeded
    where scope_kind=p_scope_kind and scope_id=p_scope_id and run_id=p_run_id;
  if exceeded then return 'breach'; end if;
  return 'settled';
end $$;
create function public.gogo_settle_governed_attempt(
  p_scope_kind text,p_scope_id text,p_run_id text,p_actor_id text,p_attempt_id text,p_cost_micros bigint,p_tokens bigint
) returns text language sql security invoker set search_path='' as $$
  select public.gogo_finish_governed_attempt(p_scope_kind,p_scope_id,p_run_id,p_actor_id,p_attempt_id,p_cost_micros,p_tokens,null);
$$;
revoke all on function public.gogo_open_governed_run(text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.gogo_reserve_governed_attempt(text,text,text,text,text,text,bigint,bigint) from public,anon,authenticated,service_role;
revoke all on function public.gogo_finish_governed_attempt(text,text,text,text,text,bigint,bigint,text) from public,anon,authenticated,service_role;
revoke all on function public.gogo_settle_governed_attempt(text,text,text,text,text,bigint,bigint) from public,anon,authenticated,service_role;
grant execute on function public.gogo_open_governed_run(text,text,text,text) to service_role;
grant execute on function public.gogo_reserve_governed_attempt(text,text,text,text,text,text,bigint,bigint) to service_role;
grant execute on function public.gogo_finish_governed_attempt(text,text,text,text,text,bigint,bigint,text) to service_role;
grant execute on function public.gogo_settle_governed_attempt(text,text,text,text,text,bigint,bigint) to service_role;
-- Verified provider ceilings, configured by the operator, never by the model.
create table public.gogo_governed_model_prices (
  model text primary key check(model ~ '^[A-Za-z0-9_.:-]{1,150}$'),
  max_total_tokens bigint not null check(max_total_tokens between 1 and 9007199254740991),
  micros_per_token bigint not null check(micros_per_token between 1 and 9007199254740991),
  valid_until timestamptz not null,
  verified_source text not null check(length(trim(verified_source)) between 1 and 300)
);
alter table public.gogo_governed_model_prices enable row level security;
revoke all on public.gogo_governed_model_prices from public,anon,authenticated,service_role;
grant select on public.gogo_governed_model_prices to service_role;
-- Exact bounded search shapes, with independent operator-reviewed ceilings.
create table public.gogo_governed_search_prices (
  operation text primary key check(operation in ('tavily.basic.v1','serper.search.v1','parallel.fast.v1')),
  max_cost_micros bigint not null check(max_cost_micros between 1 and 9007199254740991),
  valid_until timestamptz not null,
  verified_source text not null check(length(trim(verified_source)) between 1 and 300)
);
alter table public.gogo_governed_search_prices enable row level security;
revoke all on public.gogo_governed_search_prices from public,anon,authenticated,service_role;
grant select on public.gogo_governed_search_prices to service_role;
-- Reviewed descriptive revisions only: executable code and capability gates stay
-- in the static registry. Independent receipts are operator-owned and immutable
-- to the app's service role. The app cannot fabricate a test or security receipt.
create table public.gogo_skill_revisions (
  id uuid primary key default gen_random_uuid(),
  scope_kind text not null,
  scope_id text not null,
  skill_id text not null check(skill_id ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){1,3}$'),
  version text not null check(version ~ '^(0|[1-9][0-9]{0,7})\.(0|[1-9][0-9]{0,7})\.(0|[1-9][0-9]{0,7})$'),
  base_digest text not null check(base_digest ~ '^[0-9a-f]{64}$'),
  static_digest text not null check(static_digest ~ '^[0-9a-f]{64}$'),
  revision_digest text not null check(revision_digest ~ '^[0-9a-f]{64}$'),
  build_sha text not null check(build_sha ~ '^[0-9a-f]{40}$'),
  title text not null check(length(trim(title)) between 1 and 100),
  purpose text not null check(length(trim(purpose)) between 1 and 240),
  author_id text not null check(author_id ~ '^[A-Za-z0-9_:.@/-]{1,200}$'),
  evidence_refs text[] not null check(cardinality(evidence_refs) between 1 and 20),
  summary text not null check(length(trim(summary)) between 1 and 1000),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(scope_kind,scope_id,skill_id,version),
  unique(scope_kind,scope_id,skill_id,id),
  foreign key(scope_kind,scope_id) references public.gogo_governed_policies(scope_kind,scope_id) on delete restrict
);
create table public.gogo_skill_revision_receipts (
  revision_id uuid not null references public.gogo_skill_revisions(id) on delete restrict,
  review_kind text not null check(review_kind in ('test','security')),
  reviewer_id text not null check(reviewer_id ~ '^[A-Za-z0-9_:.@/-]{1,200}$'),
  receipt_ref text not null check(receipt_ref ~ '^[A-Za-z0-9_:.@/-]{1,200}$'),
  revision_digest text not null check(revision_digest ~ '^[0-9a-f]{64}$'),
  build_sha text not null check(build_sha ~ '^[0-9a-f]{40}$'),
  valid_until timestamptz not null,
  primary key(revision_id,review_kind)
);
create table public.gogo_skill_active (
  scope_kind text not null, scope_id text not null, skill_id text not null,
  revision_id uuid,
  generation bigint not null check(generation between 1 and 9007199254740991),
  active_digest text not null check(active_digest ~ '^[0-9a-f]{64}$'),
  build_sha text not null check(build_sha ~ '^[0-9a-f]{40}$'),
  changed_at timestamptz not null default clock_timestamp(),
  primary key(scope_kind,scope_id,skill_id),
  foreign key(scope_kind,scope_id) references public.gogo_governed_policies(scope_kind,scope_id) on delete restrict,
  foreign key(scope_kind,scope_id,skill_id,revision_id) references public.gogo_skill_revisions(scope_kind,scope_id,skill_id,id) on delete restrict
);
create table public.gogo_skill_review_events (
  id uuid primary key default gen_random_uuid(),
  scope_kind text not null, scope_id text not null, skill_id text not null,
  actor_id text not null, action text not null check(action in ('publish','rollback')),
  generation bigint not null, old_digest text not null, new_digest text not null,
  revision_id uuid, build_sha text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  unique(scope_kind,scope_id,skill_id,generation)
);
alter table public.gogo_skill_revisions enable row level security;
alter table public.gogo_skill_revision_receipts enable row level security;
alter table public.gogo_skill_active enable row level security;
alter table public.gogo_skill_review_events enable row level security;
revoke all on public.gogo_skill_revisions,public.gogo_skill_revision_receipts,public.gogo_skill_active,public.gogo_skill_review_events from public,anon,authenticated,service_role;
grant select on public.gogo_skill_revisions,public.gogo_skill_revision_receipts to service_role;
grant select,insert,update on public.gogo_skill_active to service_role;
grant select,insert on public.gogo_skill_review_events to service_role;

-- Atomic version pointer and audit. The authenticated server checks scope
-- and reconstructs the complete definition digest from its static registry;
-- this RPC rechecks actor role, policy, CAS, and independent receipts.
create function public.gogo_change_skill_revision(
  p_scope_kind text,p_scope_id text,p_actor_id text,p_skill_id text,p_action text,
  p_revision_id uuid,p_expected_generation bigint,p_expected_digest text,p_static_digest text,p_build_sha text
) returns text language plpgsql security invoker set search_path='' as $$
declare
  pol public.gogo_governed_policies%rowtype;
  ptr public.gogo_skill_active%rowtype;
  rev public.gogo_skill_revisions%rowtype;
  t public.gogo_skill_revision_receipts%rowtype;
  s public.gogo_skill_revision_receipts%rowtype;
  role_value text;
  gen bigint:=0;
  digest text;
  new_digest text;
begin
  if p_scope_kind is null or p_scope_kind not in ('personal','workspace') or p_scope_id is null or
    p_actor_id is null or p_actor_id !~ '^-?[1-9][0-9]{0,18}$' or p_skill_id is null or p_skill_id !~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){1,3}$' or
    p_action is null or p_action not in ('publish','rollback') or p_expected_generation is null or p_expected_generation not between 0 and 9007199254740990 or
    p_expected_digest is null or p_expected_digest !~ '^[0-9a-f]{64}$' or p_static_digest is null or p_static_digest !~ '^[0-9a-f]{64}$' or
    p_build_sha is null or p_build_sha !~ '^[0-9a-f]{40}$' or ((p_action='publish') is distinct from (p_revision_id is not null)) then return 'invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('skill:'||p_scope_kind||':'||p_scope_id||':'||p_skill_id,0));
  select * into pol from public.gogo_governed_policies where scope_kind=p_scope_kind and scope_id=p_scope_id for share;
  if not found or not pol.enabled or pol.valid_until<=clock_timestamp() then return 'unavailable'; end if;
  -- The member/active access rows are checked in the mutation transaction,
  -- not inferred from an earlier UI role or a model instruction.
  perform 1 from public.users where telegram_id::text=p_actor_id and access_status='active' for share;
  if not found then return 'forbidden'; end if;
  if p_scope_kind='personal' then
    if p_scope_id<>p_actor_id then return 'forbidden'; end if;
  else
    select role::text into role_value from public.workspace_members where workspace_id::text=p_scope_id and telegram_id::text=p_actor_id for share;
    if not found or role_value not in ('owner','admin') then return 'forbidden'; end if;
  end if;
  select * into ptr from public.gogo_skill_active where scope_kind=p_scope_kind and scope_id=p_scope_id and skill_id=p_skill_id for update;
  if found then gen:=ptr.generation; digest:=ptr.active_digest; else digest:=p_static_digest; end if;
  if gen<>p_expected_generation or digest<>p_expected_digest then return 'stale'; end if;
  if p_action='publish' then
    select * into rev from public.gogo_skill_revisions where id=p_revision_id and scope_kind=p_scope_kind and scope_id=p_scope_id and skill_id=p_skill_id;
    if not found or rev.expires_at<=clock_timestamp() or rev.author_id=p_actor_id or rev.base_digest<>digest or rev.static_digest<>p_static_digest or rev.build_sha<>p_build_sha then return 'unreviewed'; end if;
    select * into t from public.gogo_skill_revision_receipts where revision_id=rev.id and review_kind='test';
    if not found then return 'unreviewed'; end if;
    select * into s from public.gogo_skill_revision_receipts where revision_id=rev.id and review_kind='security';
    if not found then return 'unreviewed'; end if;
    if t.valid_until<=clock_timestamp() or s.valid_until<=clock_timestamp() or
      t.revision_digest<>rev.revision_digest or s.revision_digest<>rev.revision_digest or
      t.build_sha<>p_build_sha or s.build_sha<>p_build_sha or
      t.reviewer_id=s.reviewer_id or t.reviewer_id=rev.author_id or s.reviewer_id=rev.author_id or
      t.reviewer_id=p_actor_id or s.reviewer_id=p_actor_id or t.receipt_ref=s.receipt_ref then return 'unreviewed'; end if;
    new_digest:=rev.revision_digest;
  else
    if gen=0 or ptr.revision_id is null then return 'no_active_revision'; end if;
    new_digest:=p_static_digest;
  end if;
  insert into public.gogo_skill_active(scope_kind,scope_id,skill_id,revision_id,generation,active_digest,build_sha)
    values(p_scope_kind,p_scope_id,p_skill_id,p_revision_id,gen+1,new_digest,p_build_sha)
    on conflict(scope_kind,scope_id,skill_id) do update set revision_id=excluded.revision_id,generation=excluded.generation,
      active_digest=excluded.active_digest,build_sha=excluded.build_sha,changed_at=clock_timestamp();
  insert into public.gogo_skill_review_events(scope_kind,scope_id,skill_id,actor_id,action,generation,old_digest,new_digest,revision_id,build_sha)
    values(p_scope_kind,p_scope_id,p_skill_id,p_actor_id,p_action,gen+1,digest,new_digest,p_revision_id,p_build_sha);
  return 'changed';
end $$;
revoke all on function public.gogo_change_skill_revision(text,text,text,text,text,uuid,bigint,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.gogo_change_skill_revision(text,text,text,text,text,uuid,bigint,text,text,text) to service_role;

-- Privacy-preserving quarantine audit only. The rejected directive and its
-- source content are deliberately NOT copied into a new memory store. Retain
-- no raw text, content hash, URL, external message ID or inferred facts.
create table public.gogo_memory_block_events (
  id uuid primary key default gen_random_uuid(),
  scope_kind text not null, scope_id text not null,
  origin text not null check(origin in ('model','email','web','document','tool')),
  reason text not null check(reason in ('untrusted_directive','secret_rejected','missing_authority')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '7 days'),
  foreign key(scope_kind,scope_id) references public.gogo_governed_policies(scope_kind,scope_id) on delete restrict
);
create index gogo_memory_block_scope_idx on public.gogo_memory_block_events(scope_kind,scope_id,created_at);
alter table public.gogo_memory_block_events enable row level security;
revoke all on public.gogo_memory_block_events from public,anon,authenticated,service_role;
grant select,insert,delete on public.gogo_memory_block_events to service_role;
commit;
