-- Admin console v1 (21 Oct 2026). Spec: docs/admin-console/README.md
-- Project: qenhjcooyecmatwducpu. Idempotent; safe to re-run.
-- Every table here is service-role only: RLS on, no policies, anon/authenticated revoked,
-- explicit grant to service_role (Supabase 30 Oct 2026 change).

-- 1. Access status on existing users. Everyone who already has a row keeps access.
alter table public.users add column if not exists access_status text not null default 'active';
alter table public.users add column if not exists access_changed_at timestamptz;
alter table public.users add column if not exists access_changed_by text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_access_status_check') then
    alter table public.users add constraint users_access_status_check check (access_status in ('active','blocked'));
  end if;
end $$;

-- 2. Waitlist lifecycle. New WhatsApp numbers land here too (no email, no consent form).
alter table public.waitlist add column if not exists status text not null default 'waiting';
alter table public.waitlist add column if not exists approved_at timestamptz;
alter table public.waitlist add column if not exists approved_by text;
alter table public.waitlist add column if not exists blocked_at timestamptz;
alter table public.waitlist add column if not exists joined_at timestamptz;
alter table public.waitlist add column if not exists last_notified_at timestamptz;
alter table public.waitlist add column if not exists invite_status text;
alter table public.waitlist add column if not exists profile_name text;
alter table public.waitlist add column if not exists admin_note text;
alter table public.waitlist alter column email drop not null;
alter table public.waitlist alter column consent_version drop not null;
alter table public.waitlist alter column country drop not null;
alter table public.waitlist drop constraint if exists waitlist_country_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'waitlist_country_shape_check') then
    alter table public.waitlist add constraint waitlist_country_shape_check check (country is null or country ~ '^[A-Z]{2}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waitlist_status_check') then
    alter table public.waitlist add constraint waitlist_status_check check (status in ('waiting','invited','joined','blocked'));
  end if;
end $$;
-- Rows already invited by hand keep that state.
update public.waitlist set status = 'invited', approved_at = coalesce(approved_at, invited_at)
  where invited_at is not null and status = 'waiting';
create index if not exists waitlist_status_created_idx on public.waitlist (status, created_at desc);

-- 3. Admin members (in addition to ADMIN_WHATSAPP_NUMBERS, who are always owners).
create table if not exists public.admin_members (
  phone_e164 text primary key,
  name text not null,
  role text not null check (role in ('owner','operator','viewer')),
  active boolean not null default true,
  added_by text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

-- 4. Admin audit log (append-only from the app).
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_phone text,
  actor_name text,
  action text not null,
  target text,
  detail jsonb not null default '{}'::jsonb,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_action_idx on public.admin_audit_log (action, created_at desc);

-- 5. Usage cost events: every metered call, attributed to the person it served ('system' when none).
--    Separate from gogo_cost_events so the cost guard's budgets are not changed by metering.
create table if not exists public.admin_cost_events (
  id bigint generated always as identity primary key,
  telegram_id text not null default 'system',
  vendor text not null,
  category text not null,
  model text,
  units numeric(14,4) not null default 1,
  input_tokens integer,
  output_tokens integer,
  cost_inr numeric(14,4) not null default 0,
  cost_usd numeric(14,6),
  ok boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_cost_events_user_time_idx on public.admin_cost_events (telegram_id, created_at desc);
create index if not exists admin_cost_events_vendor_time_idx on public.admin_cost_events (vendor, created_at desc);
create index if not exists admin_cost_events_time_idx on public.admin_cost_events (created_at desc);

-- 6. Rate card used to price metered calls. Editable in the console; seeded values are estimates.
create table if not exists public.admin_rate_card (
  key text primary key,
  label text not null,
  unit text not null,
  usd_per_unit numeric(14,8),
  inr_per_unit numeric(14,6),
  note text,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.admin_rate_card (key, label, unit, usd_per_unit, inr_per_unit, note) values
  ('fx.usd_inr', 'US dollar to rupee', 'rate', null, 88, 'Estimate; edit to the month''s rate'),
  ('anthropic.haiku.input', 'Claude Haiku input', '1M tokens', 1.00, null, 'List price estimate'),
  ('anthropic.haiku.output', 'Claude Haiku output', '1M tokens', 5.00, null, 'List price estimate'),
  ('anthropic.sonnet.input', 'Claude Sonnet input', '1M tokens', 3.00, null, 'List price estimate'),
  ('anthropic.sonnet.output', 'Claude Sonnet output', '1M tokens', 15.00, null, 'List price estimate'),
  ('anthropic.opus.input', 'Claude Opus input', '1M tokens', 5.00, null, 'List price estimate'),
  ('anthropic.opus.output', 'Claude Opus output', '1M tokens', 25.00, null, 'List price estimate'),
  ('openai.mini.input', 'OpenAI mini models input', '1M tokens', 0.40, null, 'Estimate'),
  ('openai.mini.output', 'OpenAI mini models output', '1M tokens', 1.60, null, 'Estimate'),
  ('openai.default.input', 'OpenAI other models input', '1M tokens', 2.50, null, 'Estimate'),
  ('openai.default.output', 'OpenAI other models output', '1M tokens', 10.00, null, 'Estimate'),
  ('inception.mercury.input', 'Mercury input', '1M tokens', 0.25, null, 'Estimate'),
  ('inception.mercury.output', 'Mercury output', '1M tokens', 1.00, null, 'Estimate'),
  ('tavily.search', 'Tavily search', 'search', 0.008, null, 'Estimate'),
  ('serper.search', 'Serper search', 'search', 0.001, null, 'Estimate'),
  ('bolna.call', 'Bolna call placed', 'call', 0.10, null, 'Estimate per call; Bolna bills per minute'),
  ('browserbase.session', 'Browserbase session', 'session', 0.05, null, 'Estimate per session'),
  ('assemblyai.transcript', 'AssemblyAI transcript', 'request', 0.02, null, 'Estimate'),
  ('twilio.whatsapp.outbound', 'WhatsApp message sent', 'message', null, 0.35, 'Estimate incl. Meta fee'),
  ('resend.email', 'Email sent', 'email', 0, null, 'Free plan')
on conflict (key) do nothing;

-- 7. Tools and APIs register, and monthly costs (manual invoices or automatic pulls).
create table if not exists public.admin_tools (
  id text primary key,
  name text not null,
  tool_group text not null,
  does text not null,
  plan text,
  billing_source text not null default 'manual' check (billing_source in ('auto','metered','manual','free')),
  meter_vendor text,
  renews text,
  status text not null default 'running',
  sort integer not null default 100,
  updated_at timestamptz not null default now()
);
create table if not exists public.admin_tool_costs (
  id bigint generated always as identity primary key,
  tool_id text not null references public.admin_tools(id) on delete cascade,
  month date not null,
  amount_inr numeric(14,2) not null,
  amount_usd numeric(14,2),
  source text not null default 'manual' check (source in ('manual','auto')),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (tool_id, month, source)
);
insert into public.admin_tools (id, name, tool_group, does, plan, billing_source, meter_vendor, renews, status, sort) values
  ('anthropic', 'Anthropic Claude', 'AI models', 'Main brain: understands messages, plans tasks, writes answers, reads call outcomes', 'Pay per token', 'metered', 'anthropic', 'Monthly', 'running', 10),
  ('openai', 'OpenAI', 'AI models', 'Fallback model, image reading, voice notes, image generation', 'Pay per token', 'metered', 'openai', 'Monthly', 'running', 11),
  ('inception', 'Inception Mercury', 'AI models', 'Fast model for planning and routing', 'Pay per token', 'metered', 'inception', 'Monthly', 'running', 12),
  ('assemblyai', 'AssemblyAI', 'AI models', 'Transcribes meeting recordings and long voice notes', 'Pay per audio hour', 'metered', 'assemblyai', 'Prepaid', 'running', 13),
  ('twilio', 'Twilio WhatsApp', 'Messaging and voice', 'Every WhatsApp message in and out, plus Meta fees', 'Per message', 'auto', 'twilio', 'Prepaid balance', 'running', 20),
  ('bolna', 'Bolna', 'Messaging and voice', 'AI voice agent that phones venues to book', 'Per call minute', 'metered', 'bolna', 'Top up', 'running', 21),
  ('plivo', 'Plivo', 'Messaging and voice', 'The +91 80 6553 9020 number calls come from, and call minutes', 'Number rental plus per minute', 'manual', null, 'Monthly', 'running', 22),
  ('vercel', 'Vercel', 'Hosting and data', 'Runs the app, the WhatsApp webhook and the background jobs (Mumbai)', 'Pro plan plus usage', 'manual', null, 'Monthly', 'running', 30),
  ('supabase', 'Supabase', 'Hosting and data', 'Database and file storage', 'Pro plan', 'manual', null, 'Monthly', 'running', 31),
  ('browserbase', 'Browserbase', 'Hosting and data', 'Secure cloud browser for site sign-ins, price checks and bookings', 'Per browser minute', 'metered', 'browserbase', 'Monthly', 'running', 32),
  ('domain', 'askgogo.in domain', 'Hosting and data', 'Website and app domain', 'Yearly', 'manual', null, 'Yearly', 'running', 33),
  ('tavily', 'Tavily', 'Search and data', 'Web answers: prices, news, rates, opening hours', 'Search credits', 'metered', 'tavily', 'Monthly', 'running', 40),
  ('serper', 'Serper', 'Search and data', 'Google results and venue phone lookup', 'Search credits', 'metered', 'serper', 'Prepaid', 'running', 41),
  ('aerodatabox', 'AeroDataBox (RapidAPI)', 'Search and data', 'Flight status for check-in and departure reminders', 'Basic plan', 'free', null, null, 'free tier', 42),
  ('weatherapi', 'WeatherAPI', 'Search and data', 'Weather in briefings and answers', 'Free plan', 'free', null, null, 'free tier', 43),
  ('footballdata', 'Football-Data', 'Search and data', 'Scores and fixtures', 'Free plan', 'free', null, null, 'free tier', 44),
  ('google', 'Google Cloud', 'Connected apps', 'Gmail and Google Calendar sign-in for users', 'Free within quota', 'free', null, null, 'running', 50),
  ('swiggy', 'Swiggy MCP', 'Connected apps', 'Food, Instamart and Dineout', 'Free, needs developer access', 'free', null, null, 'awaiting access', 51),
  ('zomato', 'Zomato MCP', 'Connected apps', 'Food ordering', 'Not open to third-party apps', 'free', null, null, 'closed', 52),
  ('razorpay', 'Razorpay', 'Payments and email', 'Plan subscriptions and payments', '2% per payment', 'manual', null, 'Per payment', 'running', 60),
  ('resend', 'Resend', 'Payments and email', 'Sign-in and lifecycle emails', 'Free plan', 'free', 'resend', null, 'free tier', 61)
on conflict (id) do nothing;

-- 8. Background job heartbeats (written when a cron route is invoked).
create table if not exists public.cron_heartbeats (
  job text primary key,
  last_started_at timestamptz,
  runs_today integer not null default 0,
  day date
);

-- 9. Admin password attempts (lockout after 5 failures in 15 minutes).
create table if not exists public.admin_login_attempts (
  id bigint generated always as identity primary key,
  actor_phone text not null,
  ok boolean not null,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists admin_login_attempts_actor_idx on public.admin_login_attempts (actor_phone, created_at desc);

-- 10. Console settings (the admin password hash lives here; env ADMIN_CONSOLE_PASSWORD_HASH overrides).
create table if not exists public.admin_settings (
  key text primary key,
  value text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Grants and RLS
do $$
declare t text;
begin
  foreach t in array array['admin_members','admin_audit_log','admin_cost_events','admin_rate_card','admin_tools','admin_tool_costs','cron_heartbeats','admin_login_attempts','admin_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;

-- Heartbeat helper (atomic upsert with a per-day counter).
create or replace function public.admin_cron_heartbeat(p_job text)
returns void language sql security definer set search_path = public as $$
  insert into public.cron_heartbeats (job, last_started_at, runs_today, day)
  values (p_job, now(), 1, (now() at time zone 'Asia/Kolkata')::date)
  on conflict (job) do update set
    last_started_at = now(),
    runs_today = case when public.cron_heartbeats.day = (now() at time zone 'Asia/Kolkata')::date then public.cron_heartbeats.runs_today + 1 else 1 end,
    day = (now() at time zone 'Asia/Kolkata')::date;
$$;
revoke all on function public.admin_cron_heartbeat(text) from public, anon, authenticated;
grant execute on function public.admin_cron_heartbeat(text) to service_role;

-- Aggregates for the console (PostgREST returns at most 1000 rows, so totals are computed here).
create or replace function public.admin_cost_by_user(p_since timestamptz)
returns table (telegram_id text, cost_inr numeric, events bigint, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select telegram_id, sum(cost_inr), count(*), max(created_at) from public.admin_cost_events
  where created_at >= p_since group by telegram_id order by 2 desc;
$$;
create or replace function public.admin_cost_by_vendor(p_since timestamptz, p_telegram_id text default null)
returns table (vendor text, category text, cost_inr numeric, events bigint, input_tokens bigint, output_tokens bigint)
language sql stable security definer set search_path = public as $$
  select vendor, category, sum(cost_inr), count(*), coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0)
  from public.admin_cost_events
  where created_at >= p_since and (p_telegram_id is null or telegram_id = p_telegram_id)
  group by vendor, category order by 3 desc;
$$;
create or replace function public.admin_cost_by_day(p_since timestamptz, p_telegram_id text default null)
returns table (day date, cost_inr numeric, events bigint)
language sql stable security definer set search_path = public as $$
  select (created_at at time zone 'Asia/Kolkata')::date, sum(cost_inr), count(*)
  from public.admin_cost_events
  where created_at >= p_since and (p_telegram_id is null or telegram_id = p_telegram_id)
  group by 1 order by 1;
$$;
create or replace function public.admin_message_counts(p_since timestamptz)
returns table (telegram_id text, messages bigint, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select telegram_id::text, count(*), max(created_at) from public.conversations
  where role = 'user' and created_at >= p_since group by 1;
$$;
create or replace function public.admin_run_counts(p_since timestamptz)
returns table (telegram_id text, type text, status text, runs bigint)
language sql stable security definer set search_path = public as $$
  select telegram_id::text, type, status, count(*) from public.agent_runs
  where started_at >= p_since group by 1, 2, 3;
$$;
do $$
declare f text;
begin
  foreach f in array array['admin_cost_by_user(timestamptz)','admin_cost_by_vendor(timestamptz,text)','admin_cost_by_day(timestamptz,text)','admin_message_counts(timestamptz)','admin_run_counts(timestamptz)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

create or replace function public.admin_meter_failures(p_since timestamptz)
returns table (vendor text, category text, failures bigint, calls bigint, last_failure timestamptz)
language sql stable security definer set search_path = public as $$
  select vendor, category, count(*) filter (where not ok), count(*), max(created_at) filter (where not ok)
  from public.admin_cost_events where created_at >= p_since group by 1, 2 order by 3 desc;
$$;
revoke all on function public.admin_meter_failures(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_meter_failures(timestamptz) to service_role;
