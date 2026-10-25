# AskGogo — Meter Backend Schema
*Doc 2 of 3. Target DB: `qenhjcooyecmatwducpu` ("Whatsapp Bot") — **not** `yazpphublutdodahfwvr`. Check the Supabase URL bar before every Run.*

---

## 0. Migration discipline (non-negotiable)

Claude Code cannot run DDL. Every statement below is hand-applied in the Supabase SQL editor, and **every one is confirmed with a SELECT that returns the object** before any code is written against it. "Migration applied" has been asserted before it actually ran on this project — do not trust the assertion.

---

## 1. `user_plans` — who is on what

```sql
create table if not exists user_plans (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  whatsapp_to text,
  plan_code text not null default 'free',      -- free | lite | starter | pro | pro_annual
  razorpay_subscription_id text,
  status text not null default 'active',        -- active | past_due | cancelled
  calendar_trial_started_at timestamptz,        -- for the 7-day free calendar trial
  period_start timestamptz not null default now(),
  period_end timestamptz,                       -- null for free
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_plans_telegram_id_uniq on user_plans (telegram_id);
create index if not exists user_plans_whatsapp_to_idx on user_plans (whatsapp_to);
```

**Confirm:** `select * from user_plans limit 1;`

Every existing user is backfilled to `plan_code='free'` in the same session — a user with no row must be treated as free, never as blocked.

---

## 2. `plan_limits` — allowances as data, not code

Allowances live in a table so they can be tuned without a deploy. Code reads this table; it never hardcodes a number.

```sql
create table if not exists plan_limits (
  plan_code text primary key,
  ai_actions_per_day int not null,
  documents_per_month int not null,
  friend_contacts_max int not null,
  reminders_per_day_fair_use int not null,
  calendars_max int not null,
  updated_at timestamptz not null default now()
);

insert into plan_limits
  (plan_code, ai_actions_per_day, documents_per_month, friend_contacts_max, reminders_per_day_fair_use, calendars_max)
values
  ('free',        5,   3,   0,  20, 0),
  ('lite',       25,  15,   5,  30, 1),
  ('starter',    50,  40,  10,  50, 2),
  ('pro',       150, 200,  20,  50, 9),
  ('pro_annual',150, 200,  20,  50, 9)
on conflict (plan_code) do update set
  ai_actions_per_day = excluded.ai_actions_per_day,
  documents_per_month = excluded.documents_per_month,
  friend_contacts_max = excluded.friend_contacts_max,
  reminders_per_day_fair_use = excluded.reminders_per_day_fair_use,
  calendars_max = excluded.calendars_max,
  updated_at = now();
```

`documents_per_month = 200` on Pro is the fair-use expression of "unlimited" — the UI says Unlimited, the table holds a real ceiling. `calendars_max = 9` likewise stands for "multi".

**Confirm:** `select * from plan_limits order by ai_actions_per_day;` → 5 rows.

---

## 3. `usage_events` — the ledger

Append-only. One row per billable action. This is the audit trail; the counters are derived from it, never stored as a mutable integer that can drift.

```sql
create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  whatsapp_to text,
  counter text not null,          -- ai_action | document
  action text not null,           -- web_search | translate | ask | image_classify | brief_on_demand
                                  -- | ticket_parse | statement_parse | receipt_parse
  surface text not null default 'whatsapp',   -- whatsapp | dashboard
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_lookup_idx
  on usage_events (telegram_id, counter, created_at desc);
```

**Confirm:** `select * from usage_events limit 1;`

**Retention:** rows older than 13 months can be rolled into a monthly summary later. Not now — do not build the rollup until the table is large enough to need it.

---

## 4. Counter queries (the only two that matter)

**AI actions used today (IST day window):**

```sql
select count(*) from usage_events
where telegram_id = $1
  and counter = 'ai_action'
  and created_at >= (date_trunc('day', (now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata');
```

**Documents used this month (IST month window):**

```sql
select count(*) from usage_events
where telegram_id = $1
  and counter = 'document'
  and created_at >= (date_trunc('month', (now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata');
```

The IST day-window expression is the same pattern already used by the reminder-limit fix — reuse it, do not reinvent it.

---

## 5. Friend contacts — a ceiling, not a ledger

Friend contacts are counted live against whatever table already holds friend-reminder contacts. No new table. The check is `count(active contacts) < plan_limits.friend_contacts_max`, run at contact-add time only.

If no such table exists yet, friend reminders are out of scope for this track and the counter ships as a no-op returning 0 — the plan_limits column stays, unused, until that feature lands.

---

## 6. What is NOT in this schema

- **No `reminders` changes.** Reminders are unmetered. No column, no check, no meter import anywhere in the reminder creation or send path. The fair-use ceiling is enforced by counting existing reminder rows for the IST day at creation time only — reusing the plan-aware cap logic already shipped for the Founder Pro fix.
- **No CreditIQ counters.** Those live in `yazpphublutdodahfwvr` and are read over HTTP. Never mirror them here — a mirrored counter is a counter that drifts.
- **No credit-wallet / balance column.** Counters are derived from the ledger. A stored balance is a bug waiting for a race condition.

---

## 7. Migration order

1. `user_plans` → confirm with SELECT → backfill existing users to `free` → confirm count.
2. `plan_limits` → confirm 5 rows.
3. `usage_events` → confirm with SELECT.
4. Only then write code.

Each step is its own SQL Run in `qenhjcooyecmatwducpu`, verified before the next.
