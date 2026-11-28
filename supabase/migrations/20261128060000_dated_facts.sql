-- Owner-applied migration. Facts are entered explicitly in one personal or team scope.
begin;

create table public.dated_fact_topics (
  id uuid primary key default gen_random_uuid(),
  personal_owner text,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  topic text not null check (length(topic) between 1 and 100 and topic = lower(trim(topic))),
  check (num_nonnulls(personal_owner, workspace_id) = 1),
  unique (personal_owner, topic),
  unique (workspace_id, topic)
);
create table public.dated_fact_revisions (
  id uuid primary key,
  topic_id uuid not null references public.dated_fact_topics(id) on delete cascade,
  sequence_no bigint generated always as identity unique,
  author_id text not null,
  effective_on date not null,
  recorded_at timestamptz not null default clock_timestamp(),
  answer text not null check (length(trim(answer)) between 1 and 1000),
  source_label text not null check (length(trim(source_label)) between 1 and 180)
);
create index dated_fact_effective on public.dated_fact_revisions(topic_id, effective_on desc, sequence_no desc);
create index dated_fact_head on public.dated_fact_revisions(topic_id, sequence_no desc);
-- Retain only opaque mutation IDs after deletion. A delayed retry cannot resurrect forgotten data.
create table public.dated_fact_requests (id uuid primary key);
alter table public.dated_fact_requests enable row level security;
revoke all on public.dated_fact_requests from public, anon, authenticated;
grant select, insert on public.dated_fact_requests to service_role;

create table public.dated_fact_questions (
  viewer_id text not null,
  topic_id uuid not null references public.dated_fact_topics(id) on delete cascade,
  primary key (viewer_id, topic_id)
);

alter table public.dated_fact_topics enable row level security;
alter table public.dated_fact_revisions enable row level security;
alter table public.dated_fact_questions enable row level security;
revoke all on public.dated_fact_topics, public.dated_fact_revisions, public.dated_fact_questions from public, anon, authenticated;
grant select, insert, delete on public.dated_fact_topics, public.dated_fact_questions to service_role;
grant select, insert on public.dated_fact_revisions to service_role;
grant usage on sequence public.dated_fact_revisions_sequence_no_seq to service_role;

-- Never accept the actor from a request body. The server supplies the authenticated identity.
-- Lock membership through the transaction so a change of role is ordered against the read/write.
create function public.dated_fact_access(p_actor text, p_workspace uuid, p_edit boolean)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_role text;
begin
  if p_actor is null or p_actor !~ '^-?[1-9][0-9]{0,18}$' then raise exception 'fact_forbidden'; end if;
  if p_workspace is not null then
    select role into v_role from public.workspace_members
      where workspace_id = p_workspace and telegram_id = p_actor for share;
    if v_role is null or v_role not in ('owner','admin','member','viewer') or
       (p_edit and v_role not in ('owner','admin')) then raise exception 'fact_forbidden'; end if;
  end if;
end $$;

create function public.read_dated_facts(p_actor text, p_workspace uuid, p_topic text, p_day date,
  p_known_at timestamptz default null)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  perform public.dated_fact_access(p_actor, p_workspace, false);
  select coalesce(jsonb_agg(row_data order by row_data->>'topic'), '[]'::jsonb) into result
  from (
    select jsonb_build_object('id', t.id, 'topic', t.topic, 'head', head.id, 'following', q.topic_id is not null,
      'revision', case when r.id is null then null else jsonb_build_object('id', r.id, 'answer', r.answer,
      'source', r.source_label, 'effectiveOn', r.effective_on, 'recordedAt', r.recorded_at) end) row_data
    from public.dated_fact_topics t
    join lateral (select id from public.dated_fact_revisions where topic_id=t.id order by sequence_no desc limit 1) head on true
    left join public.dated_fact_questions q on q.topic_id=t.id and q.viewer_id=p_actor
    left join lateral (select * from public.dated_fact_revisions where topic_id=t.id and effective_on <= p_day
      and recorded_at <= least(coalesce(p_known_at, statement_timestamp()), statement_timestamp())
      order by effective_on desc, sequence_no desc limit 1) r on true
    where ((p_workspace is null and t.personal_owner=p_actor) or t.workspace_id=p_workspace)
      and ((p_topic is null and q.topic_id is not null) or t.topic=p_topic)
  ) rows;
  return result;
end $$;

create function public.write_dated_fact(p_actor text, p_workspace uuid, p_topic text, p_action text,
  p_expected uuid, p_request uuid, p_day date, p_answer text, p_source text)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
declare t uuid; head uuid; replay public.dated_fact_revisions%rowtype;
begin
  if p_action is null or p_action not in ('save','forget','follow','unfollow') then raise exception 'fact_invalid'; end if;
  perform public.dated_fact_access(p_actor, p_workspace, p_action in ('save','forget'));
  -- Includes first creation, when there is no topic row to lock.
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_workspace::text, p_actor) || '/' || p_topic, 0));
  select id into t from public.dated_fact_topics where topic=p_topic and
    ((p_workspace is null and personal_owner=p_actor) or workspace_id=p_workspace);
  if p_action in ('follow','unfollow') then
    if t is null or not exists (select 1 from public.dated_fact_revisions where topic_id=t and id=p_expected)
      then raise exception 'fact_conflict'; end if;
    if p_action='follow' then
      insert into public.dated_fact_questions values(p_actor,t) on conflict do nothing;
    else delete from public.dated_fact_questions where viewer_id=p_actor and topic_id=t; end if;
    return;
  end if;
  if p_action='save' then
    select * into replay from public.dated_fact_revisions where id=p_request;
    if found then
      if replay.topic_id=t and replay.author_id=p_actor and replay.effective_on=p_day
        and replay.answer=p_answer and replay.source_label=p_source then return; end if;
      raise exception 'fact_conflict';
    end if;
    insert into public.dated_fact_requests values (p_request) on conflict do nothing;
    if not found then raise exception 'fact_conflict'; end if;
  end if;
  select id into head from public.dated_fact_revisions where topic_id=t order by sequence_no desc limit 1;
  if head is distinct from p_expected then raise exception 'fact_conflict'; end if;
  if p_action='forget' then
    if t is null then raise exception 'fact_conflict'; end if;
    delete from public.dated_fact_topics where id=t;
    return;
  end if;
  if t is null then
    insert into public.dated_fact_topics(personal_owner, workspace_id, topic)
      values(case when p_workspace is null then p_actor end, p_workspace, p_topic) returning id into t;
  end if;
  insert into public.dated_fact_revisions(id,topic_id,author_id,effective_on,answer,source_label)
    values(p_request,t,p_actor,p_day,p_answer,p_source);
end $$;

-- Only followed references can feed reminders. Revocation, unfollow and deletion suppress delivery.
create function public.dated_fact_reminder(p_actor text, p_ref uuid, p_day date)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare t public.dated_fact_topics%rowtype; result jsonb;
begin
  select f.* into t from public.dated_fact_topics f
    join public.dated_fact_questions q on q.topic_id=f.id and q.viewer_id=p_actor
    where f.id=p_ref and (f.personal_owner=p_actor or exists (
      select 1 from public.workspace_members m where m.workspace_id=f.workspace_id and m.telegram_id=p_actor));
  if not found then return null; end if;
  result := public.read_dated_facts(p_actor,t.workspace_id,t.topic,p_day)->0;
  if result->>'id' is distinct from p_ref::text or result->>'following' is distinct from 'true'
    or result->'revision' is null or result->'revision' = 'null'::jsonb then return null; end if;
  -- Team answers remain inside the authenticated workspace even when delivered via a reminder.
  if t.workspace_id is not null then return jsonb_build_object('workspace',t.workspace_id); end if;
  return jsonb_build_object('answer',result->'revision'->>'answer','source',result->'revision'->>'source',
    'effectiveOn',result->'revision'->>'effectiveOn');
end $$;

-- Owner-filtered, personal-only export. The caller paginates the view through PostgREST.
create view public.dated_fact_export with (security_invoker = true) as
  select t.personal_owner as telegram_id, r.id, t.topic, r.answer, r.source_label, r.recorded_at, r.effective_on
  from public.dated_fact_topics t join public.dated_fact_revisions r on r.topic_id=t.id
  where t.personal_owner is not null;
revoke all on public.dated_fact_export from public, anon, authenticated;
grant select on public.dated_fact_export to service_role;
revoke all on function public.dated_fact_reminder(text,uuid,date) from public, anon, authenticated;
grant execute on function public.dated_fact_reminder(text,uuid,date) to service_role;

revoke all on function public.dated_fact_access(text,uuid,boolean), public.read_dated_facts(text,uuid,text,date,timestamptz),
  public.write_dated_fact(text,uuid,text,text,uuid,uuid,date,text,text) from public, anon, authenticated;
grant execute on function public.dated_fact_access(text,uuid,boolean), public.read_dated_facts(text,uuid,text,date,timestamptz),
  public.write_dated_fact(text,uuid,text,text,uuid,uuid,date,text,text) to service_role;
commit;
