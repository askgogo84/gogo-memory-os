# Backend Schema — AskGogo First-Message Onboarding

**Track:** Onboarding (doc 5 of 6)
**Status:** Draft for review
**Date:** 10 Aug 2026
**Reads with:** `TRD-02` §3

---

## 1. Scope

This doc is short because the change genuinely is small: two columns on an
existing table, one backfill, no new tables, no new indexes.

The risk in this track is not schema complexity. It is the **backfill** — §4.

## 2. Changes

Target: `public.users` on Supabase project **`qenhjcooyecmatwducpu`**
("Whatsapp Bot"). Not `yazpphublutdodahfwvr` — check the ref in the URL bar
before pressing Run.

| Column | Type | Null | Purpose |
|---|---|---|---|
| `onboarding_stage` | `text` | yes | State machine value. `null` means never onboarded |
| `onboarding_started_at` | `timestamptz` | yes | When the welcome was sent. Analytics only |

Permitted values for `onboarding_stage`: `welcomed`, `capability_sent`,
`first_action_done`, `complete`.

**No CHECK constraint.** A bad value would otherwise throw on write, and every
write in this flow must fail open. Validation belongs in application code, where
an unexpected value degrades to "skip onboarding" rather than erroring.

**No index.** The column is only ever read as part of the existing user-row
fetch, keyed on the phone number, which is already indexed. Adding an index on a
low-cardinality column read only by primary key would cost writes and buy
nothing.

## 3. Migration

New file `supabase/onboarding-v1.sql`, additive and idempotent, matching the
house style of `reminder-delivery-truth-v1.sql`:

```sql
-- AskGogo onboarding state — safe to re-run
alter table public.users
  add column if not exists onboarding_stage      text,
  add column if not exists onboarding_started_at timestamptz;
```

Confirming SELECT — **run this and see two rows before any code ships**:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'users'
  and column_name in ('onboarding_stage','onboarding_started_at')
order by column_name;
-- expect exactly 2 rows:
--   onboarding_stage      | text
--   onboarding_started_at | timestamp with time zone
```

The standing rule is migration-first, confirm with a SELECT, never trust
"migration applied". It was violated once on 10 Aug — Stage 2a code shipped
against columns that did not exist, and only the env gate being off prevented a
repeat-delivery loop. Do not repeat that here.

## 4. The backfill — the dangerous part

Immediately after the migration confirms, and **before `ONBOARDING_ENABLED` is
ever set**:

```sql
update public.users
set onboarding_stage = 'complete'
where onboarding_stage is null;
```

Confirm it took:

```sql
select onboarding_stage, count(*)
from public.users
group by onboarding_stage;
-- expect one row: complete | <total user count>
-- expect ZERO rows with a null stage
```

**Why this is the highest-risk step in the entire track.** Every existing
AskGogo user has a null stage until this runs. If the feature gate is enabled
before the backfill, the next message from each of them triggers a welcome —
and each of those is a business-initiated message against a 250/24h cap on a
number whose display name is currently in review. That is a mass unsolicited
send from a sender already under scrutiny.

Sequence is not negotiable: **migrate → confirm → backfill → confirm → deploy
with gate off → enable gate.**

## 5. Rollback

| Level | Action | Effect |
|---|---|---|
| Behaviour | Unset `ONBOARDING_ENABLED`, redeploy | Flow stops immediately. Columns retain values. No code change |
| Schema | `alter table public.users drop column onboarding_stage, drop column onboarding_started_at;` | Full revert. Only if abandoning the track |

Behaviour-level rollback is the one to reach for. The columns are inert when the
gate is off.

## 6. What is deliberately not stored

- **No email address.** Capture happens entirely through the existing dashboard
  magic-link path, which already stores it. Nothing about email is written from
  the WhatsApp side.
- **No copy of the messages sent.** They are reconstructible from the state and
  the copy file.
- **No per-example tracking** of which of the five prompts a user picked. Useful
  later for measuring activation, but it is a second table and it is not needed
  to ship v1. Deferred deliberately.

## 7. Metric queries

Once live, the PRD's success metrics come from:

```sql
-- activation: new users reaching a first real action
select
  count(*) filter (where onboarding_stage in ('first_action_done','complete'))::float
  / nullif(count(*), 0) as activation_rate
from public.users
where onboarding_started_at > now() - interval '7 days';
```

```sql
-- funnel drop-off by stage
select onboarding_stage, count(*)
from public.users
where onboarding_started_at is not null
group by onboarding_stage
order by 1;
```

The second query is the more useful one — it shows exactly where new users stop,
which is what the copy iterates against.
